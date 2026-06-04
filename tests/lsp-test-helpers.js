/**
 * LSP Test Helpers
 *
 * Provides reusable LSP test utilities based on the superior pattern
 * from test-rtnl-constants.js. Each test file gets its own server
 * instance but uses the same robust protocol handling.
 */

const { spawn } = require('child_process');
const path = require('path');

/**
 * Creates an LSP test server instance with the robust Buffer-based protocol handling
 * @param {Object} options - Optional configuration
 * @param {Object} options.capabilities - Client capabilities to send during initialization
 */
function createLSPTestServer(options = {}) {
  // If a shared server exists (via mocha root hook), return a no-op wrapper.
  // A custom workspaceRoot needs its own server (the shared one is rooted at the
  // repo), so bypass the wrapper in that case.
  if (global.__sharedLSPServer && !options.workspaceRoot) {
    return {
      initialize: () => Promise.resolve(),
      shutdown: () => {},
      getDiagnostics: global.__sharedLSPServer.getDiagnostics,
      getCompletions: global.__sharedLSPServer.getCompletions,
      getHover: global.__sharedLSPServer.getHover,
      getDefinition: global.__sharedLSPServer.getDefinition,
      getReferences: global.__sharedLSPServer.getReferences,
      getDocumentSymbols: global.__sharedLSPServer.getDocumentSymbols,
      getHighlights: global.__sharedLSPServer.getHighlights,
      getRename: global.__sharedLSPServer.getRename,
      getPrepareRename: global.__sharedLSPServer.getPrepareRename,
      getSignatureHelp: global.__sharedLSPServer.getSignatureHelp,
      getInlayHints: global.__sharedLSPServer.getInlayHints,
      getWorkspaceSymbols: global.__sharedLSPServer.getWorkspaceSymbols,
      getCodeActions: global.__sharedLSPServer.getCodeActions,
      getCodeLens: global.__sharedLSPServer.getCodeLens,
      resolveCodeLens: global.__sharedLSPServer.resolveCodeLens,
    };
  }

  let serverProcess = null;
  let requestId = 1;
  let wireBuffer = Buffer.alloc(0);
  const pendingRequests = new Map(); // key -> { resolve, reject?, timeout }
  const inflightStartedAt = new Map(); // key -> t0 (ms)
  const lastDiagnosticsByUri = new Map(); // uri -> last published diagnostics (for cross-file tests)
  const diagnosticsWaiters = []; // {uri, predicate, resolve, timeout}

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
        const diagnostics = message.params.diagnostics;
        lastDiagnosticsByUri.set(uri, diagnostics);
        if (pendingRequests.has(uri)) {
          const { resolve, timeout } = pendingRequests.get(uri);
          clearTimeout(timeout);
          pendingRequests.delete(uri);
          resolve(diagnostics);
        }
        // Satisfy any waitForDiagnostics() callers whose predicate matches
        for (let wi = diagnosticsWaiters.length - 1; wi >= 0; wi--) {
          const w = diagnosticsWaiters[wi];
          if (w.uri === uri && w.predicate(diagnostics)) {
            clearTimeout(w.timeout);
            diagnosticsWaiters.splice(wi, 1);
            w.resolve(diagnostics);
          }
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
      const serverPath = path.join(__dirname, '..', 'dist', 'server.js');
      serverProcess = spawn('node', [serverPath, '--stdio'], {
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

      const wsRoot = options.workspaceRoot || process.cwd();
      const initialize = {
        jsonrpc: '2.0',
        id: requestId++,
        method: 'initialize',
        params: {
          processId: process.pid,
          clientInfo: { name: 'test-client', version: '1.0.0' },
          rootUri: `file://${wsRoot}`,
          workspaceFolders: [{
            uri: `file://${wsRoot}`,
            name: 'ucode-lsp'
          }],
          capabilities: { ...defaultCapabilities, ...options.capabilities }
        }
      };

      const initialized = { jsonrpc: '2.0', method: 'initialized', params: {} };

      // Wait for initialization response
      const initKey = idKey(initialize.id);
      pendingRequests.set(initKey, {
        resolve: (initResult) => {
          serverProcess.stdin.write(createLSPMessage(initialized));
          resolve(initResult);
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
      }, 2000);

      pendingRequests.set(key, { resolve, timeout });
      serverProcess.stdin.write(createLSPMessage(didOpen));
    });
  }

  // Get completions for a document position. `context` defaults to a manual
  // invocation (triggerKind 1); pass e.g. { triggerKind: 2, triggerCharacter: '{' }
  // to simulate a trigger-character keypress.
  function getCompletions(testContent, testFilePath, line, character, context) {
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
          context: context || { triggerKind: 1 }
        }
      };

      const timeout = setTimeout(() => {
        if (pendingRequests.has(reqKey)) {
          pendingRequests.delete(reqKey);
          inflightStartedAt.delete(reqKey);
          reject(new Error('Timeout waiting for completion response'));
        }
      }, 2000); // < suite timeout

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
      }, 2000); // < suite timeout

      pendingRequests.set(reqKey, { resolve, reject, timeout });
      inflightStartedAt.set(reqKey, Date.now());

      serverProcess.stdin.write(createLSPMessage(didOpen));

      setTimeout(() => {
        serverProcess.stdin.write(createLSPMessage(hover));
      }, 10);
    });
  }

  // Get go-to-definition for a document position (textDocument/definition)
  function getDefinition(testContent, testFilePath, line, character) {
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

      const definition = {
        jsonrpc: '2.0',
        id: currentRequestId,
        method: 'textDocument/definition',
        params: {
          textDocument: { uri: `file://${testFilePath}` },
          position: { line, character }
        }
      };

      const timeout = setTimeout(() => {
        if (pendingRequests.has(reqKey)) {
          pendingRequests.delete(reqKey);
          inflightStartedAt.delete(reqKey);
          reject(new Error('Timeout waiting for definition response'));
        }
      }, 2000);

      pendingRequests.set(reqKey, { resolve, reject, timeout });
      inflightStartedAt.set(reqKey, Date.now());

      serverProcess.stdin.write(createLSPMessage(didOpen));

      setTimeout(() => {
        serverProcess.stdin.write(createLSPMessage(definition));
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
      }, 2000);

      pendingRequests.set(reqKey, { resolve, reject, timeout });
      inflightStartedAt.set(reqKey, Date.now());

      serverProcess.stdin.write(createLSPMessage(codeAction));
    });
  }

  // Request CodeLenses for a document (opens it first). Resolves with CodeLens[].
  function getCodeLens(testContent, testFilePath) {
    return new Promise((resolve, reject) => {
      const currentRequestId = requestId++;
      const reqKey = idKey(currentRequestId);

      const didOpen = {
        jsonrpc: '2.0',
        method: 'textDocument/didOpen',
        params: {
          textDocument: { uri: `file://${testFilePath}`, languageId: 'ucode', version: 1, text: testContent }
        }
      };
      const codeLens = {
        jsonrpc: '2.0',
        id: currentRequestId,
        method: 'textDocument/codeLens',
        params: { textDocument: { uri: `file://${testFilePath}` } }
      };

      const timeout = setTimeout(() => {
        if (pendingRequests.has(reqKey)) {
          pendingRequests.delete(reqKey);
          inflightStartedAt.delete(reqKey);
          reject(new Error('Timeout waiting for codeLens response'));
        }
      }, 2000);

      pendingRequests.set(reqKey, { resolve, reject, timeout });
      inflightStartedAt.set(reqKey, Date.now());

      serverProcess.stdin.write(createLSPMessage(didOpen));
      setTimeout(() => serverProcess.stdin.write(createLSPMessage(codeLens)), 10);
    });
  }

  // Resolve a single CodeLens (codeLens/resolve). Resolves with the resolved lens.
  function resolveCodeLens(lens) {
    return new Promise((resolve, reject) => {
      const currentRequestId = requestId++;
      const reqKey = idKey(currentRequestId);

      const req = { jsonrpc: '2.0', id: currentRequestId, method: 'codeLens/resolve', params: lens };

      const timeout = setTimeout(() => {
        if (pendingRequests.has(reqKey)) {
          pendingRequests.delete(reqKey);
          inflightStartedAt.delete(reqKey);
          reject(new Error('Timeout waiting for codeLens/resolve response'));
        }
      }, 2000);

      pendingRequests.set(reqKey, { resolve, reject, timeout });
      inflightStartedAt.set(reqKey, Date.now());

      serverProcess.stdin.write(createLSPMessage(req));
    });
  }

  // Generic position-based request: opens the doc, then sends `method` with the
  // given params (merged onto { textDocument, position }). Resolves with result.
  function sendPositionRequest(method, testContent, testFilePath, line, character, extraParams = {}) {
    return new Promise((resolve, reject) => {
      const currentRequestId = requestId++;
      const reqKey = idKey(currentRequestId);
      const uri = `file://${testFilePath}`;
      const didOpen = {
        jsonrpc: '2.0', method: 'textDocument/didOpen',
        params: { textDocument: { uri, languageId: 'ucode', version: 1, text: testContent } }
      };
      const req = {
        jsonrpc: '2.0', id: currentRequestId, method,
        params: { textDocument: { uri }, position: { line, character }, ...extraParams }
      };
      const timeout = setTimeout(() => {
        if (pendingRequests.has(reqKey)) {
          pendingRequests.delete(reqKey); inflightStartedAt.delete(reqKey);
          reject(new Error(`Timeout waiting for ${method} response`));
        }
      }, 2000);
      pendingRequests.set(reqKey, { resolve, reject, timeout });
      inflightStartedAt.set(reqKey, Date.now());
      serverProcess.stdin.write(createLSPMessage(didOpen));
      setTimeout(() => serverProcess.stdin.write(createLSPMessage(req)), 10);
    });
  }
  const getReferences = (content, file, line, character, includeDeclaration = true) =>
    sendPositionRequest('textDocument/references', content, file, line, character, { context: { includeDeclaration } });
  const getDocumentSymbols = (content, file) =>
    sendPositionRequest('textDocument/documentSymbol', content, file, 0, 0, { position: undefined });
  const getHighlights = (content, file, line, character) =>
    sendPositionRequest('textDocument/documentHighlight', content, file, line, character);
  const getRename = (content, file, line, character, newName) =>
    sendPositionRequest('textDocument/rename', content, file, line, character, { newName });
  const getPrepareRename = (content, file, line, character) =>
    sendPositionRequest('textDocument/prepareRename', content, file, line, character);
  const getSignatureHelp = (content, file, line, character) =>
    sendPositionRequest('textDocument/signatureHelp', content, file, line, character);
  const getInlayHints = (content, file, rangeStart, rangeEnd) =>
    sendPositionRequest('textDocument/inlayHint', content, file, 0, 0, { range: { start: rangeStart, end: rangeEnd } });
  // Opens the doc (so it's analyzed + in the cache), then queries workspace symbols.
  const getWorkspaceSymbols = (content, file, query) =>
    sendPositionRequest('workspace/symbol', content, file, 0, 0, { query });

  // Cross-file tests: send a raw didOpen / didChange for an aux file (so a
  // change to file B can trigger the server's cross-file invalidation of file
  // A) and wait for an UNSOLICITED publishDiagnostics on the importer URI.
  // Pass a predicate so the caller can wait for the specific state they expect
  // (`ds.length === 0`, a specific code, …) rather than racing on the first
  // diagnostic that happens to arrive.
  function openOrChangeDocument(uri, text, version) {
    const isOpen = lastDiagnosticsByUri.has(uri);
    const method = isOpen ? 'textDocument/didChange' : 'textDocument/didOpen';
    const params = isOpen
      ? { textDocument: { uri, version: version ?? 2 }, contentChanges: [{ text }] }
      : { textDocument: { uri, languageId: 'ucode', version: version ?? 1, text } };
    serverProcess.stdin.write(createLSPMessage({ jsonrpc: '2.0', method, params }));
  }

  function waitForDiagnostics(uri, predicate, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
      const existing = lastDiagnosticsByUri.get(uri);
      if (existing !== undefined && predicate(existing)) {
        return resolve(existing);
      }
      const timeout = setTimeout(() => {
        const idx = diagnosticsWaiters.findIndex(w => w.resolve === resolve);
        if (idx >= 0) diagnosticsWaiters.splice(idx, 1);
        reject(new Error(`Timeout waiting for diagnostics on ${uri} (last: ${JSON.stringify(lastDiagnosticsByUri.get(uri))})`));
      }, timeoutMs);
      diagnosticsWaiters.push({ uri, predicate, resolve, timeout });
    });
  }

  return {
    initialize,
    shutdown,
    getDiagnostics,
    getCompletions,
    getHover,
    getDefinition,
    getReferences,
    getDocumentSymbols,
    getHighlights,
    getRename,
    getPrepareRename,
    getSignatureHelp,
    getInlayHints,
    getWorkspaceSymbols,
    getCodeActions,
    getCodeLens,
    resolveCodeLens,
    openOrChangeDocument,
    waitForDiagnostics
  };
}

module.exports = {
  createLSPTestServer
};