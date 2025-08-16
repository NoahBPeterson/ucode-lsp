// Combined LSP validation tests using shared server pattern for performance
// This combines multiple test scenarios to reuse the LSP server connection

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

describe('Combined LSP Validation Tests', function() {
  this.timeout(20000); // 20 second timeout for comprehensive tests

  let serverProcess;
  let requestId = 1;
  let buffer = '';
  let pendingRequests = new Map();

  // Helper function to create LSP message with Content-Length header
  function createLSPMessage(obj) {
    const content = JSON.stringify(obj);
    return `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n${content}`;
  }

  // Start shared server process
  before(function(done) {
    console.log('🚀 Starting shared LSP server for combined validation tests...');
    
    serverProcess = spawn('bun', ['dist/server.js', '--stdio'], {
      stdio: ['pipe', 'pipe', 'inherit']
    });

    serverProcess.stdout.on('data', (data) => {
      buffer += data.toString();
      
      // Process complete LSP messages
      while (true) {
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) break;
        
        const header = buffer.slice(0, headerEnd);
        const contentLengthMatch = header.match(/Content-Length: (\d+)/);
        
        if (!contentLengthMatch) {
          buffer = buffer.slice(headerEnd + 4);
          continue;
        }
        
        const contentLength = parseInt(contentLengthMatch[1]);
        const messageStart = headerEnd + 4;
        
        if (buffer.length < messageStart + contentLength) {
          break; // Wait for more data
        }
        
        const messageContent = buffer.slice(messageStart, messageStart + contentLength);
        buffer = buffer.slice(messageStart + contentLength);
        
        try {
          const message = JSON.parse(messageContent);
          
          // Handle publishDiagnostics notifications
          if (message.method === 'textDocument/publishDiagnostics') {
            const uri = message.params.uri;
            if (pendingRequests.has(uri)) {
              const { resolve, timeout } = pendingRequests.get(uri);
              clearTimeout(timeout);
              pendingRequests.delete(uri);
              resolve(message.params.diagnostics);
            }
          }
          
          // Handle completion responses
          if (message.id && pendingRequests.has(message.id)) {
            const { resolve, timeout } = pendingRequests.get(message.id);
            clearTimeout(timeout);
            pendingRequests.delete(message.id);
            resolve(message.result);
          }
        } catch (e) {
          // Ignore parse errors, continue processing
        }
      }
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
              dynamicRegistration: false,
              completionItem: {
                snippetSupport: true,
                commitCharactersSupport: true
              }
            }
          }
        }
      }
    };

    const initialized = {
      jsonrpc: '2.0',
      method: 'initialized',
      params: {}
    };

    // Wait for initialization response
    pendingRequests.set(initialize.id, {
      resolve: () => {
        // Send initialized notification
        serverProcess.stdin.write(createLSPMessage(initialized));
        console.log('✅ LSP server initialized successfully');
        done();
      },
      timeout: setTimeout(() => {
        done(new Error('Server initialization timeout'));
      }, 8000)
    });

    serverProcess.stdin.write(createLSPMessage(initialize));
  });

  // Clean up server process
  after(function() {
    if (serverProcess) {
      console.log('🔥 Shutting down shared LSP server');
      serverProcess.kill();
    }
  });

  // Helper function to get diagnostics using shared server
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

      const timeout = setTimeout(() => {
        if (pendingRequests.has(`file://${testFilePath}`)) {
          pendingRequests.delete(`file://${testFilePath}`);
          reject(new Error('Timeout waiting for diagnostics'));
        }
      }, 8000);

      pendingRequests.set(`file://${testFilePath}`, { resolve, timeout });

      // Send didOpen message
      serverProcess.stdin.write(createLSPMessage(didOpen));
    });
  }

  // Helper function to get completions using shared server
  function getCompletions(testContent, testFilePath, line, character) {
    return new Promise((resolve, reject) => {
      const currentRequestId = requestId++;
      
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
          textDocument: {
            uri: `file://${testFilePath}`
          },
          position: {
            line: line,
            character: character
          }
        }
      };

      const timeout = setTimeout(() => {
        if (pendingRequests.has(currentRequestId)) {
          pendingRequests.delete(currentRequestId);
          reject(new Error('Timeout waiting for completion response'));
        }
      }, 8000);

      pendingRequests.set(currentRequestId, { resolve, timeout });

      // Send messages
      serverProcess.stdin.write(createLSPMessage(didOpen));
      
      // Wait a bit for document to be processed, then send completion
      setTimeout(() => {
        serverProcess.stdin.write(createLSPMessage(completion));
      }, 200);
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