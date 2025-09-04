const { spawn } = require('child_process');
const assert = require('assert');

/**
 * RTNL Constants Integration Tests
 */
describe('RTNL Constants Integration Tests', function() {
  this.timeout(15000); // 15 second timeout for LSP tests

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
      /*
      if (kind === 'response') {
        console.log(`[WIRE] <- response id=${mid} hasResult=${'result' in message} hasError=${'error' in message}`);
      } else if (kind === 'request') {
        console.log(`[WIRE] <- request  ${message.method} id=${mid}`);
      } else {
        console.log(`[WIRE] <- note     ${message.method}`);
      }*/

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
          //console.log(`[WIRE] response id=${mid} in ${Date.now() - t0}ms`);
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
        clientInfo: { name: 'test-client', version: '1.0.0' },
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
    //console.log(`[WIRE] -> request  initialize id=${initKey}`);
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
      //console.log(`[WIRE] -> note     didOpen uri=${key}`);
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

      //console.log(`[WIRE] -> note     didOpen uri=file://${testFilePath}`);
      serverProcess.stdin.write(createLSPMessage(didOpen));

      setTimeout(() => {
        //console.log(`[WIRE] -> request  completion id=${reqKey} pos=${line}:${character}`);
        serverProcess.stdin.write(createLSPMessage(completion));
      }, 10);
    });
  }

  // ---------------------------------------------------------------------------
  // Tests
  // ---------------------------------------------------------------------------
  describe('RTNL Constants Import and Usage', function() {
    it('should allow "const" import from rtnl module', async function() {
      const testContent = `import { 'const' as rtnlconst } from 'rtnl';`;
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-rtnl-const-import.uc');
      const importErrors = diagnostics.filter(d => d.severity === 1 && d.message.includes('is not exported by the rtnl module'));
      assert.strictEqual(importErrors.length, 0, 'Should allow "const" import from rtnl module');
    });

    it('should provide member expression completions for rtnl constants', async function() {
      const testContent = `import { 'const' as rtnlconst } from 'rtnl';\nlet value = rtnlconst.`;
      const completions = await getCompletions(testContent, '/tmp/test-rtnl-member.uc', 1, 23);
      const constantCompletions = completions.items || completions || [];
      const rtnConstants = constantCompletions.filter(item => item.label && (
        item.label.startsWith('RT_TABLE_') ||
        item.label.startsWith('RTN_') ||
        item.label.startsWith('RTM_') ||
        item.label.startsWith('NLM_F_')
      ));
      assert(rtnConstants.length > 0, `Should provide rtnl constant completions, got: ${constantCompletions.map(c => c.label).join(', ')}`);
      const labels = constantCompletions.map(c => c.label);
      assert(labels.includes('RT_TABLE_MAIN'), 'Should include RT_TABLE_MAIN constant');
      assert(labels.includes('RTN_UNICAST'), 'Should include RTN_UNICAST constant');
      assert(labels.includes('RTM_GETROUTE'), 'Should include RTM_GETROUTE constant');
    });

    it('should not leak constants to global scope', async function() {
      const testContent = `import { 'const' as rtnlconst } from 'rtnl';\nlet R\n`;
      const completions = await getCompletions(testContent, '/tmp/test-rtnl-noleaks.uc', 1, 5);
      const constantCompletions = completions.items || completions || [];
      const globalRtnConstants = constantCompletions.filter(item => item.label && (
        item.label.startsWith('RTN_') ||
        item.label.startsWith('RT_TABLE_') ||
        item.label.startsWith('RTM_')
      ));
      assert.strictEqual(globalRtnConstants.length, 0, `RTNL constants should not leak to global scope, found: ${globalRtnConstants.map(c => c.label).join(', ')}`);
    });

    it('should allow access to specific rtnl constants via member expression', async function() {
      const testContent = `import { 'const' as rtnlconst } from 'rtnl';\nlet tableMain = rtnlconst.RT_TABLE_MAIN;\nlet routeUnicast = rtnlconst.RTN_UNICAST;\nlet getRoute = rtnlconst.RTM_GETROUTE;`;
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-rtnl-access.uc');
      const propertyErrors = diagnostics.filter(d => d.severity === 1 && d.message.includes('Property') && d.message.includes('does not exist'));
      assert.strictEqual(propertyErrors.length, 0, `Should allow access to rtnl constants, but got errors: ${propertyErrors.map(e => e.message).join(', ')}`);
    });

    it('should show error for invalid rtnl constant access', async function() {
      const testContent = `import { 'const' as rtnlconst } from 'rtnl';\nlet invalid = rtnlconst.INVALID_CONSTANT;`;
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-rtnl-invalid.uc');
      const propertyErrors = diagnostics.filter(d => d.severity === 1 && d.message.includes("Property 'INVALID_CONSTANT' does not exist"));
      assert(propertyErrors.length > 0, 'Should show error for invalid constant access');
    });
  });

  describe('NL80211 Constants Comparison', function() {
    it('should work the same way as nl80211 constants', async function() {
      const testContent = `import { 'const' as nl80211const } from 'nl80211';\nimport { 'const' as rtnlconst } from 'rtnl';\nlet nlCmd = nl80211const.NL80211_CMD_GET_INTERFACE;\nlet rtRoute = rtnlconst.RTN_UNICAST;`;
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-both-constants.uc');
      const errors = diagnostics.filter(d => d.severity === 1);
      assert.strictEqual(errors.length, 0, `Both nl80211 and rtnl constants should work, but got errors: ${errors.map(e => e.message).join(', ')}`);
    });

    it('should provide completions for both nl80211 and rtnl constants separately', async function() {
      const testContent = `import { 'const' as nl80211const } from 'nl80211';\nimport { 'const' as rtnlconst } from 'rtnl';\nlet nl = nl80211const.`;
      const nlCompletions = await getCompletions(testContent, '/tmp/test-nl-completions.uc', 2, 23);
      const nlItems = nlCompletions.items || nlCompletions || [];
      const nlConstants = nlItems.filter(item => item.label && item.label.startsWith('NL80211_'));
      const rtnlConstants = nlItems.filter(item => item.label && (item.label.startsWith('RTN_') || item.label.startsWith('RTM_')));
      assert(nlConstants.length > 0, 'Should provide nl80211 constants');
      assert.strictEqual(rtnlConstants.length, 0, 'Should not mix in rtnl constants');
    });
  });
});
