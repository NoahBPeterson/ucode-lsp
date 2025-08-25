const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

describe('Auto-Fix Code Actions Tests', function() {
  this.timeout(10000);

  let serverProcess;
  let requestId = 1;
  let buffer = '';
  let pendingRequests = new Map();

  function createLSPMessage(obj) {
    const content = JSON.stringify(obj);
    return `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n${content}`;
  }

  before(function(done) {
    serverProcess = spawn('node', ['dist/server.js', '--stdio'], {
      stdio: ['pipe', 'pipe', 'inherit']
    });

    serverProcess.stdout.on('data', (data) => {
      buffer += data.toString();
      
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
          break;
        }
        
        const messageContent = buffer.slice(messageStart, messageStart + contentLength);
        buffer = buffer.slice(messageStart + contentLength);
        
        try {
          const message = JSON.parse(messageContent);
          
          if (message.method === 'textDocument/publishDiagnostics') {
            const uri = message.params.uri;
            if (pendingRequests.has(`diagnostics:${uri}`)) {
              const { resolve, timeout } = pendingRequests.get(`diagnostics:${uri}`);
              clearTimeout(timeout);
              pendingRequests.delete(`diagnostics:${uri}`);
              resolve(message.params.diagnostics);
            }
          }
          
          if (message.id && pendingRequests.has(message.id)) {
            const { resolve, timeout } = pendingRequests.get(message.id);
            clearTimeout(timeout);
            pendingRequests.delete(message.id);
            resolve(message.result);
          }
        } catch (e) {
          // Ignore parse errors
        }
      }
    });

    const initialize = {
      jsonrpc: '2.0',
      id: requestId++,
      method: 'initialize',
      params: {
        processId: process.pid,
        clientInfo: { name: 'test-client', version: '1.0.0' },
        capabilities: {
          textDocument: {
            codeAction: {
              dynamicRegistration: false,
              codeActionLiteralSupport: {
                codeActionKind: {
                  valueSet: ['quickfix']
                }
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

    pendingRequests.set(initialize.id, {
      resolve: () => {
        serverProcess.stdin.write(createLSPMessage(initialized));
        done();
      },
      timeout: setTimeout(() => {
        done(new Error('Server initialization timeout'));
      }, 5000)
    });

    serverProcess.stdin.write(createLSPMessage(initialize));
  });

  after(function() {
    if (serverProcess) {
      serverProcess.kill();
    }
  });

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
        if (pendingRequests.has(`diagnostics:file://${testFilePath}`)) {
          pendingRequests.delete(`diagnostics:file://${testFilePath}`);
          reject(new Error('Timeout waiting for diagnostics'));
        }
      }, 6000);

      pendingRequests.set(`diagnostics:file://${testFilePath}`, { resolve, timeout });
      serverProcess.stdin.write(createLSPMessage(didOpen));
    });
  }

  function getCodeActions(testFilePath, diagnostics, line, character) {
    return new Promise((resolve, reject) => {
      const currentRequestId = requestId++;
      
      const codeAction = {
        jsonrpc: '2.0',
        id: currentRequestId,
        method: 'textDocument/codeAction',
        params: {
          textDocument: {
            uri: `file://${testFilePath}`
          },
          range: {
            start: { line: line, character: character },
            end: { line: line, character: character + 1 }
          },
          context: {
            diagnostics: diagnostics
          }
        }
      };

      const timeout = setTimeout(() => {
        if (pendingRequests.has(currentRequestId)) {
          pendingRequests.delete(currentRequestId);
          reject(new Error('Timeout waiting for code actions'));
        }
      }, 6000);

      pendingRequests.set(currentRequestId, { resolve, timeout });
      serverProcess.stdin.write(createLSPMessage(codeAction));
    });
  }

  describe('Auto-Fix Code Actions', function() {
    let diagnostics;
    const testFilePath = path.join(__dirname, '..', 'test-auto-fix.uc');

    before(async function() {
      if (!fs.existsSync(testFilePath)) {
        throw new Error(`Test file does not exist: ${testFilePath}`);
      }
      
      const testContent = fs.readFileSync(testFilePath, 'utf8');
      diagnostics = await getDiagnostics(testContent, testFilePath);
      
      console.log(`\nTotal diagnostics for auto-fix test: ${diagnostics.length}`);
      diagnostics.forEach((d, i) => {
        console.log(`  [${i}] Line ${d.range.start.line}: "${d.message}" (severity: ${d.severity}, source: ${d.source})`);
      });
    });

    it('should provide code actions for ucode-semantic diagnostics', async function() {
      // Find a ucode-semantic diagnostic
      const semanticDiagnostics = diagnostics.filter(d => d.source === 'ucode-semantic');
      assert(semanticDiagnostics.length > 0, 'Should have at least one ucode-semantic diagnostic');
      
      const diagnostic = semanticDiagnostics[0];
      const codeActions = await getCodeActions(testFilePath, [diagnostic], diagnostic.range.start.line, diagnostic.range.start.character);
      
      console.log(`\nCode actions for line ${diagnostic.range.start.line}:`, codeActions);
      
      assert(Array.isArray(codeActions), 'Code actions should be an array');
      assert(codeActions.length > 0, 'Should provide at least one code action');
      
      const disableAction = codeActions.find(action => 
        action.title === 'Disable ucode-lsp for this line' && 
        action.kind === 'quickfix'
      );
      
      assert(disableAction, 'Should provide a disable comment code action');
      assert(disableAction.edit, 'Code action should have edit');
      assert(disableAction.edit.changes, 'Code action should have changes');
    });

    it('should have correct text edit for disable comment', async function() {
      const semanticDiagnostics = diagnostics.filter(d => d.source === 'ucode-semantic');
      const diagnostic = semanticDiagnostics[0];
      const codeActions = await getCodeActions(testFilePath, [diagnostic], diagnostic.range.start.line, diagnostic.range.start.character);
      
      const disableAction = codeActions.find(action => action.title === 'Disable ucode-lsp for this line');
      assert(disableAction, 'Should have disable action');
      
      const changes = disableAction.edit.changes;
      const fileUri = `file://${testFilePath}`;
      assert(changes[fileUri], 'Should have changes for the test file');
      
      const textEdits = changes[fileUri];
      assert(Array.isArray(textEdits), 'Should have text edits array');
      assert(textEdits.length > 0, 'Should have at least one text edit');
      
      const edit = textEdits[0];
      assert.strictEqual(edit.newText, ' // ucode-lsp disable', 'Should insert disable comment');
      assert.strictEqual(edit.range.start.line, diagnostic.range.start.line, 'Should edit the correct line');
    });

    it('should not provide code actions for lines that already have disable comments', async function() {
      // Test with content that already has disable comment
      const testContentWithDisable = `
let errorVar = undefinedFunc(); // ucode-lsp disable
let anotherError = undefinedVar2();
      `;
      
      const diagnosticsWithDisable = await getDiagnostics(testContentWithDisable, '/tmp/test-with-disable.uc');
      
      // Find diagnostic on line with disable comment (should be none due to suppression)
      // But if any exist from other sources, code action should not be provided
      const line0Diagnostics = diagnosticsWithDisable.filter(d => d.range.start.line === 1);
      
      if (line0Diagnostics.length > 0) {
        const codeActions = await getCodeActions('/tmp/test-with-disable.uc', line0Diagnostics, 1, 0);
        
        const disableActions = codeActions.filter(action => action.title === 'Disable ucode-lsp for this line');
        assert.strictEqual(disableActions.length, 0, 'Should not provide disable action for line that already has disable comment');
      }
    });

    it('should provide separate code actions for multiple diagnostics', async function() {
      // Find multiple diagnostics if available
      const semanticDiagnostics = diagnostics.filter(d => d.source === 'ucode-semantic');
      
      if (semanticDiagnostics.length > 1) {
        // Test with multiple diagnostics
        const multipleDiagnostics = semanticDiagnostics.slice(0, 2);
        const firstDiagnostic = multipleDiagnostics[0];
        
        const codeActions = await getCodeActions(testFilePath, multipleDiagnostics, firstDiagnostic.range.start.line, firstDiagnostic.range.start.character);
        
        const disableActions = codeActions.filter(action => action.title === 'Disable ucode-lsp for this line');
        assert(disableActions.length >= 1, 'Should provide disable actions for multiple diagnostics');
      }
    });
  });
});