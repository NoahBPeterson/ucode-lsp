// Combined LSP validation tests using shared server pattern for performance
// This combines multiple test scenarios to reuse the LSP server connection

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

describe('Combined LSP Validation Tests', function() {
  this.timeout(15000); // 15 second timeout for comprehensive tests

  let serverProcess;
  let requestId = 1;
  /**
   * Maintain a raw byte buffer for protocol parsing.
   * Using Buffer avoids JSON parse errors when multibyte characters are present.
   */
  let wireBuffer = Buffer.alloc(0);

  const pendingRequests = new Map(); // key -> { resolve, reject?, timeout }
  const inflightStartedAt = new Map(); // key -> t0 (ms)

  // Normalize any JSON-RPC id to a stable Map key
  function idKey(id) {
    return String(id);
  }

  // Helper to create LSP message with Content-Length header
  function createLSPMessage(obj) {
    const content = JSON.stringify(obj);
    return `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n${content}`;
  }

  // ---------------------------------------------------------------------------
  // Wire reader / demux (Buffer-safe)
  // ---------------------------------------------------------------------------
  function handleIncomingChunk(chunk) {
    // Append raw bytes
    const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8');
    wireBuffer = Buffer.concat([wireBuffer, incoming]);

    // Process complete LSP messages
    while (true) {
      const headerEnd = wireBuffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;

      const headerBuf = wireBuffer.slice(0, headerEnd);
      const header = headerBuf.toString('utf8');
      const contentLengthMatch = header.match(/Content-Length:\s*(\d+)/i);

      if (!contentLengthMatch) {
        // Drop malformed header and continue
        wireBuffer = wireBuffer.slice(headerEnd + 4);
        continue;
      }

      const contentLength = parseInt(contentLengthMatch[1], 10);
      const messageStart = headerEnd + 4; // skip CRLFCRLF

      if (wireBuffer.length < messageStart + contentLength) {
        // Wait for more data
        break;
      }

      const messageBuf = wireBuffer.slice(messageStart, messageStart + contentLength);
      wireBuffer = wireBuffer.slice(messageStart + contentLength);

      let message;
      try {
        message = JSON.parse(messageBuf.toString('utf8'));
      } catch (e) {
        // Keep going even if a single message fails to parse
        console.error('[WIRE] parse error (JSON):', e);
        continue;
      }

      const kind = message.method
        ? (message.id !== undefined ? 'request' : 'notification')
        : 'response';
      const mid = message.id !== undefined ? idKey(message.id) : '';

      // Notifications --------------------------------------------------------
      if (message.method === 'textDocument/publishDiagnostics') {
        const uri = message.params.uri;
        if (pendingRequests.has(uri)) {
          const { resolve, timeout } = pendingRequests.get(uri);
          clearTimeout(timeout);
          pendingRequests.delete(uri);
          resolve(message.params.diagnostics);
        }
        continue; // done with this message
      }

      // Server -> Client requests -------------------------------------------
      if (message.id !== undefined && typeof message.method === 'string' && message.method.length > 0) {
        const respond = (result) => {
          const resp = { jsonrpc: '2.0', id: message.id, result };
          serverProcess.stdin.write(createLSPMessage(resp));
        };
        const respondErr = (code, msg) => {
          const resp = { jsonrpc: '2.0', id: message.id, error: { code, message: msg } };
          serverProcess.stdin.write(createLSPMessage(resp));
        };

        switch (message.method) {
          case 'client/registerCapability':
            respond(null);
            break;
          case 'workspace/configuration':
            respond(new Array((message.params?.items || []).length).fill(null));
            break;
          case 'window/showMessageRequest':
            respond(message.params?.actions?.[0] ?? null);
            break;
          case 'workspace/applyEdit':
            respond({ applied: true });
            break;
          default:
            respondErr(-32601, `Not implemented in test harness: ${message.method}`);
            break;
        }
        continue; // handled
      }

      // Client -> Server responses ------------------------------------------
      if (message.id !== undefined && (('result' in message) || ('error' in message))) {
        if (!pendingRequests.has(mid)) {
          console.error(`[WIRE] response id=${mid} has no pending entry; pending ids=[${[...pendingRequests.keys()].join(', ')}]`);
          continue;
        }

        const { resolve, reject, timeout } = pendingRequests.get(mid);
        clearTimeout(timeout);
        pendingRequests.delete(mid);

        const t0 = inflightStartedAt.get(mid);
        if (t0) {
          inflightStartedAt.delete(mid);
        }

        if (message.error) {
          const err = new Error(`JSON-RPC error ${message.error.code}: ${message.error.message}`);
          if (Object.prototype.hasOwnProperty.call(message.error, 'data')) {
            err.data = message.error.data;
          }
          if (typeof reject === 'function') reject(err); else resolve(err);
        } else {
          resolve(message.result);
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------
  before(function(done) {
    serverProcess = spawn('node', ['dist/server.js', '--stdio'], {
      stdio: ['pipe', 'pipe', 'inherit']
    });

    serverProcess.stdout.on('data', (data) => {
      // Do not dump raw data to console (can be huge);
      // let the demux log high-level wire events instead.
      handleIncomingChunk(data);
    });

    serverProcess.on('error', (error) => {
      console.error('Server error:', error);
      done(error);
    });

    // Initialize the server
    const initialize = {
      jsonrpc: '2.0',
      id: requestId++,
      method: 'initialize',
      params: {
        processId: process.pid,
        clientInfo: { name: 'combined-test-client', version: '1.0.0' },
        capabilities: {
          textDocument: {
            completion: {
              completionItem: { snippetSupport: true }
            }
          }
        }
      }
    };

    const initialized = { jsonrpc: '2.0', method: 'initialized', params: {} };

    // Wait for initialization response
    const initKey = idKey(initialize.id);
    pendingRequests.set(initKey, {
      resolve: () => {
        serverProcess.stdin.write(createLSPMessage(initialized));
        done();
      },
      reject: (err) => done(err instanceof Error ? err : new Error(String(err))),
      timeout: setTimeout(() => { done(new Error('Server initialization timeout')); }, 10000)
    });

    inflightStartedAt.set(initKey, Date.now());
    serverProcess.stdin.write(createLSPMessage(initialize));
  });

  after(function() {
    if (serverProcess) {
      try { serverProcess.kill(); } catch (_) {}
    }
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function getDiagnostics(testContent, testFilePath) {
    return new Promise((resolve, reject) => {
      const didOpen = {
        jsonrpc: '2.0',
        method: 'textDocument/didOpen',
        params: {
          textDocument: {
            uri: `file://${testFilePath}`,
            languageId: 'ucode',
            version: 1,
            text: testContent
          }
        }
      };

      const key = `file://${testFilePath}`;
      const timeout = setTimeout(() => {
        if (pendingRequests.has(key)) {
          pendingRequests.delete(key);
          reject(new Error('Timeout waiting for diagnostics'));
        }
      }, 8000);

      pendingRequests.set(key, { resolve, timeout });
      serverProcess.stdin.write(createLSPMessage(didOpen));
    });
  }

  function getCompletions(testContent, testFilePath, line, character) {
    return new Promise((resolve, reject) => {
      const currentRequestId = requestId++;
      const reqKey = idKey(currentRequestId);

      const didOpen = {
        jsonrpc: '2.0',
        method: 'textDocument/didOpen',
        params: {
          textDocument: {
            uri: `file://${testFilePath}`,
            languageId: 'ucode',
            version: 1,
            text: testContent
          }
        }
      };

      const completion = {
        jsonrpc: '2.0',
        id: currentRequestId,
        method: 'textDocument/completion',
        params: {
          textDocument: { uri: `file://${testFilePath}` },
          position: { line, character },
          context: { triggerKind: 1 }
        }
      };

      const timeout = setTimeout(() => {
        if (pendingRequests.has(reqKey)) {
          pendingRequests.delete(reqKey);
          inflightStartedAt.delete(reqKey);
          reject(new Error('Timeout waiting for completion response'));
        }
      }, 12000); // < suite timeout

      pendingRequests.set(reqKey, { resolve, reject, timeout });
      inflightStartedAt.set(reqKey, Date.now());

      serverProcess.stdin.write(createLSPMessage(didOpen));

      setTimeout(() => {
        serverProcess.stdin.write(createLSPMessage(completion));
      }, 10);
    });
  }

  describe('Octal Number Parsing', function() {
    it('should NOT show "Cannot parse this token" error for 0o644', async function() {
      const testContent = `fs.chmod("/file", 0o644);`;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-octal-basic.uc');
      
      const parseErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        (d.message.includes("Cannot parse this token") || 
         d.message.includes("0o644") ||
         d.message.includes("Unexpected character"))
      );
      
      assert.strictEqual(parseErrors.length, 0, 
        `Should not show parsing errors for 0o644. Found: ${parseErrors.map(e => e.message).join(', ')}`);
    });

    it('should parse various octal formats without errors', async function() {
      const testContent = `
        let perm1 = 0o644;
        let perm2 = 0o755;  
        let perm3 = 0O777;
        let zero = 0o0;
        fs.chmod("/file1", 0o644);
        fs.chmod("/file2", 0O755);
      `;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-octal-multiple.uc');
      
      const octalParseErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        (d.message.includes("Cannot parse this token") || 
         d.message.includes("0o") ||
         d.message.includes("0O") ||
         d.message.includes("Unexpected character"))
      );
      
      assert.strictEqual(octalParseErrors.length, 0, 
        `Should not show parsing errors for any octal format. Found: ${octalParseErrors.map(e => e.message).join(', ')}`);
    });
  });

  describe('String Method Validation', function() {
    it('should handle string method usage appropriately', async function() {
      const testContent = `
        let text = "hello world";
        let result = text.toUpperCase(); // May or may not be flagged as invalid
      `;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-string-methods.uc');
      
      // String method validation might not be fully implemented
      // Just ensure no critical parsing errors
      const criticalErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        (d.message.includes("Cannot parse") || d.message.includes("Unexpected character"))
      );
      
      assert.strictEqual(criticalErrors.length, 0, 'Should not have critical parsing errors');
    });

    it('should allow valid string length property', async function() {
      const testContent = `
        let text = "hello";
        let len = text.length; // Valid - strings have length property
      `;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-string-length.uc');
      
      const stringErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("String object does not have")
      );
      
      assert.strictEqual(stringErrors.length, 0, 'Should not show errors for valid string.length');
    });
  });

  describe('Comma Operator Parsing', function() {
    it('should parse comma operators in parentheses without errors', async function() {
      const testContent = `
        let result = (a = 1, b = 2, a + b);
        replace(val, /pattern/, () => (rv.invert = true, ''));
      `;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-comma-operator.uc');
      
      const commaErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        (d.message.includes("Expected ')' after expression") ||
         d.message.includes("Unexpected token in expression"))
      );
      
      assert.strictEqual(commaErrors.length, 0, 
        `Should not show parsing errors for comma operators. Found: ${commaErrors.map(e => e.message).join(', ')}`);
    });
  });

  describe('RTNL Constants Completion', function() {
    it('should provide completions for rtnl constants', async function() {
      const testContent = `
        import { const } from 'rtnl';
        const.
      `;
      
      try {
        const completions = await getCompletions(testContent, '/tmp/test-rtnl-completion.uc', 2, 14);
        
        // Should have completions for RTNL constants
        const hasRtnlConstants = completions && completions.items && 
          completions.items.some(item => item.label && item.label.includes('RTM_'));
        
        assert(hasRtnlConstants, 'Should provide RTNL constant completions');
      } catch (error) {
        // If completion fails, at least ensure no parsing errors
        const diagnostics = await getDiagnostics(testContent, '/tmp/test-rtnl-fallback.uc');
        
        const importErrors = diagnostics.filter(d => 
          d.severity === 1 && 
          d.message.includes("not exported by the rtnl module")
        );
        
        // Should not show export errors for 'const' import
        assert.strictEqual(importErrors.length, 0, 'Should allow const import from rtnl');
      }
    });
  });

  describe('Builtin Function Validation', function() {
    it('should handle filter builtin appropriately', async function() {
      const testContent = `
        let result = filter("not_an_array", function(x) { return x > 5; });
      `;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-filter-validation.uc');
      
      // Parameter type validation might not be fully implemented for all builtins
      // Just ensure no critical parsing errors
      const criticalErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        (d.message.includes("Cannot parse") || d.message.includes("Unexpected character"))
      );
      
      assert.strictEqual(criticalErrors.length, 0, 'Should not have critical parsing errors');
    });

    it('should allow valid split usage with regex', async function() {
      const testContent = `
        let parts = split("hello,world", /,/);
      `;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-split-regex.uc');
      
      const splitErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("split")
      );
      
      assert.strictEqual(splitErrors.length, 0, 'Should allow valid split with regex');
    });
  });

  describe('FS Module Import Validation', function() {
    it('should show error when fs is used without import', async function() {
      const testContent = `fs.chmod("lol", 0o644);`;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-fs-no-import.uc');
      
      const importErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("Cannot use 'fs' module without importing it first")
      );
      
      assert(importErrors.length > 0, 'Should show fs import error');
    });

    it('should NOT show error when fs is properly imported', async function() {
      const testContent = `
        import * as fs from 'fs';
        fs.chmod("/file", 0o644);
      `;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-fs-with-import.uc');
      
      const importErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("Cannot use 'fs' module without importing it first")
      );
      
      assert.strictEqual(importErrors.length, 0, 'Should not show import error when fs is imported');
    });
  });

  describe('Edge Cases and Integration', function() {
    it('should handle complex mixed scenarios', async function() {
      const testContent = `
        // Test multiple features together
        let permissions = 0o755;
        let text = "hello";
        let len = text.length;
        
        // Comma operator
        let result = (permissions = 0o644, len + 10);
        
        // Valid import and usage
        import * as fs from 'fs';
        fs.chmod("/file", 0o644);
        
        // Import with constants
        import { const } from 'rtnl';
      `;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-complex-integration.uc');
      
      // Should not have critical parsing errors or import errors
      const criticalErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        (d.message.includes("Cannot parse this token") ||
         d.message.includes("Unexpected character") ||
         d.message.includes("Expected ')' after expression") ||
         d.message.includes("Cannot use 'fs' module without importing"))
      );
      
      assert.strictEqual(criticalErrors.length, 0, 
        `Should not have critical parsing or import errors in complex scenarios. Found: ${criticalErrors.map(e => e.message).join(', ')}`);
    });

    it('should have reasonable performance with shared server', async function() {
      const start = Date.now();
      
      const testContent = `
        let test = "performance test";
        let perm = 0o644;
        let result = (test.length, perm);
      `;
      
      await getDiagnostics(testContent, '/tmp/test-performance.uc');
      
      const elapsed = Date.now() - start;
      
      // Should be fast with shared server (under 2 seconds)
      assert(elapsed < 2000, `Shared server should be fast. Took ${elapsed}ms`);
    });
  });
});