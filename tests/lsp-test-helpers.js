/**
 * LSP Test Helpers
 * 
 * Provides reusable LSP test utilities based on the superior pattern
 * from test-rtnl-constants.js. Each test file gets its own server
 * instance but uses the same robust protocol handling.
 */

const { spawn } = require('child_process');

/**
 * Creates an LSP test server instance with the robust Buffer-based protocol handling
 * @param {Object} options - Optional configuration
 * @param {Object} options.capabilities - Client capabilities to send during initialization
 */
function createLSPTestServer(options = {}) {
  let serverProcess = null;
  let requestId = 1;
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

  // Wire reader / demux (Buffer-safe)
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
        console.error('[LSP-HELPER] parse error (JSON):', e);
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
          console.error(`[LSP-HELPER] response id=${mid} has no pending entry; pending ids=[${[...pendingRequests.keys()].join(', ')}]`);
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

  // Initialize the server
  function initialize() {
    return new Promise((resolve, reject) => {
      serverProcess = spawn('node', ['dist/server.js', '--stdio'], {
        stdio: ['pipe', 'pipe', 'inherit']
      });

      serverProcess.stdout.on('data', (data) => {
        handleIncomingChunk(data);
      });

      serverProcess.on('error', (error) => {
        console.error('LSP test server error:', error);
        reject(error);
      });

      // Initialize the server
      const defaultCapabilities = {
        textDocument: {
          hover: { dynamicRegistration: false },
          completion: {
            completionItem: { snippetSupport: true }
          }
        }
      };

      const initialize = {
        jsonrpc: '2.0',
        id: requestId++,
        method: 'initialize',
        params: {
          processId: process.pid,
          clientInfo: { name: 'test-client', version: '1.0.0' },
          rootUri: `file://${process.cwd()}`,
          workspaceFolders: [{
            uri: `file://${process.cwd()}`,
            name: 'ucode-lsp'
          }],
          capabilities: { ...defaultCapabilities, ...options.capabilities }
        }
      };

      const initialized = { jsonrpc: '2.0', method: 'initialized', params: {} };

      // Wait for initialization response
      const initKey = idKey(initialize.id);
      pendingRequests.set(initKey, {
        resolve: () => {
          serverProcess.stdin.write(createLSPMessage(initialized));
          resolve();
        },
        reject: (err) => reject(err instanceof Error ? err : new Error(String(err))),
        timeout: setTimeout(() => { 
          reject(new Error('LSP server initialization timeout')); 
        }, 10000)
      });

      inflightStartedAt.set(initKey, Date.now());
      serverProcess.stdin.write(createLSPMessage(initialize));
    });
  }

  // Shutdown the server
  function shutdown() {
    if (serverProcess) {
      try { 
        serverProcess.kill(); 
      } catch (_) {}
      serverProcess = null;
    }
    pendingRequests.clear();
    inflightStartedAt.clear();
    wireBuffer = Buffer.alloc(0);
  }

  // Get diagnostics for a document
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

  // Get completions for a document position
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

  // Get hover information for a document position
  function getHover(testContent, testFilePath, line, character) {
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

      const hover = {
        jsonrpc: '2.0',
        id: currentRequestId,
        method: 'textDocument/hover',
        params: {
          textDocument: { uri: `file://${testFilePath}` },
          position: { line, character }
        }
      };

      const timeout = setTimeout(() => {
        if (pendingRequests.has(reqKey)) {
          pendingRequests.delete(reqKey);
          inflightStartedAt.delete(reqKey);
          reject(new Error('Timeout waiting for hover response'));
        }
      }, 12000); // < suite timeout

      pendingRequests.set(reqKey, { resolve, reject, timeout });
      inflightStartedAt.set(reqKey, Date.now());

      serverProcess.stdin.write(createLSPMessage(didOpen));

      setTimeout(() => {
        serverProcess.stdin.write(createLSPMessage(hover));
      }, 10);
    });
  }

  // Get code actions for a document position and diagnostics
  function getCodeActions(testFilePath, diagnostics, line, character) {
    return new Promise((resolve, reject) => {
      const currentRequestId = requestId++;
      const reqKey = idKey(currentRequestId);

      const codeAction = {
        jsonrpc: '2.0',
        id: currentRequestId,
        method: 'textDocument/codeAction',
        params: {
          textDocument: { uri: `file://${testFilePath}` },
          range: {
            start: { line, character },
            end: { line, character: character + 1 }
          },
          context: {
            diagnostics: diagnostics
          }
        }
      };

      const timeout = setTimeout(() => {
        if (pendingRequests.has(reqKey)) {
          pendingRequests.delete(reqKey);
          inflightStartedAt.delete(reqKey);
          reject(new Error('Timeout waiting for code action response'));
        }
      }, 12000);

      pendingRequests.set(reqKey, { resolve, reject, timeout });
      inflightStartedAt.set(reqKey, Date.now());

      serverProcess.stdin.write(createLSPMessage(codeAction));
    });
  }

  return {
    initialize,
    shutdown,
    getDiagnostics,
    getCompletions,
    getHover,
    getCodeActions
  };
}

module.exports = {
  createLSPTestServer
};