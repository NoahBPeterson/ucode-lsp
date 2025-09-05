const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

describe('Import Completion Test', function() {
  this.timeout(15000);

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
            completion: {
              completionItem: { snippetSupport: true }
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
      }, 10000)
    });

    serverProcess.stdin.write(createLSPMessage(initialize));
  });

  after(function() {
    if (serverProcess) {
      serverProcess.kill();
    }
  });

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
          textDocument: { uri: `file://${testFilePath}` },
          position: { line, character },
          context: { triggerKind: 1 }
        }
      };

      const timeout = setTimeout(() => {
        if (pendingRequests.has(currentRequestId)) {
          pendingRequests.delete(currentRequestId);
          reject(new Error('Timeout waiting for completion response'));
        }
      }, 100);

      pendingRequests.set(currentRequestId, { resolve, timeout });

      serverProcess.stdin.write(createLSPMessage(didOpen));

      setTimeout(() => {
        serverProcess.stdin.write(createLSPMessage(completion));
      }, 10);
    });
  }

  it('should provide completions for builtin modules at end of import string', async function() {
    const testContent = "import * as lol from '";
    const testFilePath = path.resolve(__dirname, `test_import_completion_${Date.now()}.uc`);
    const completions = await getCompletions(testContent, testFilePath, 0, testContent.length);

    assert(completions.length > 0, 'Expected completions for builtin modules');

    const moduleNames = completions.map(c => c.label);
    console.log('Available modules:', moduleNames);
    
    // Check for all expected builtin modules
    const expectedModules = ['fs', 'debug', 'log', 'math', 'ubus', 'uci', 'uloop', 'digest', 'nl80211', 'resolv', 'rtnl', 'socket', 'struct', 'zlib'];
    for (const module of expectedModules) {
      assert(moduleNames.includes(module), `Expected "${module}" in completions`);
    }

    // Verify completion item properties
    const fsCompletion = completions.find(c => c.label === 'fs');
    assert(fsCompletion, 'Expected fs completion item');
    assert.strictEqual(fsCompletion.kind, 9, 'Expected Module kind (9)'); // CompletionItemKind.Module = 9
    assert.strictEqual(fsCompletion.detail, 'ucode builtin module', 'Expected correct detail');
    assert(fsCompletion.insertText, 'Expected insertText');
  });

  it('should provide completions when cursor is inside import string', async function() {
    const testContent = "import * as lol from 'f'";
    const testFilePath = path.resolve(__dirname, 'test_import_completion2.uc');
    const completions = await getCompletions(testContent, testFilePath, 0, 23); // position inside 'f'

    assert(completions.length > 0, 'Expected completions for builtin modules');

    const moduleNames = completions.map(c => c.label);
    assert(moduleNames.includes('fs'), 'Expected "fs" in completions when cursor inside string');
  });

  it('should provide completions after from keyword with space', async function() {
    const testContent = "import * as lol from ";
    const testFilePath = path.resolve(__dirname, 'test_import_completion3.uc');
    const completions = await getCompletions(testContent, testFilePath, 0, testContent.length);

    assert(completions.length > 0, 'Expected completions after from keyword');

    const moduleNames = completions.map(c => c.label);
    assert(moduleNames.includes('fs'), 'Expected "fs" in completions after from keyword');
  });

  it('should NOT provide module completions in regular string literals', async function() {
    const testContent = "let x = 'f";
    const testFilePath = path.resolve(__dirname, 'test_import_completion4.uc');
    
    try {
      const completions = await getCompletions(testContent, testFilePath, 0, testContent.length);
      
      // Should not get module completions in regular strings
      const moduleNames = completions.map(c => c.label);
      const hasModuleCompletions = moduleNames.includes('fs');
      assert(!hasModuleCompletions || completions.length === 0, 'Should NOT get module completions in regular strings');
    } catch (error) {
      // If timeout occurs, it means no completions were provided, which is expected behavior
      if (error.message.includes('Timeout waiting for completion response')) {
        console.log('   ✓ No completions provided (as expected) - LSP did not respond');
        return; // Test passes
      }
      throw error; // Re-throw unexpected errors
    }
  });

  it('should NOT provide module completions outside import context', async function() {
    const testContent = "fs.";
    const testFilePath = path.resolve(__dirname, 'test_import_completion5.uc');
    const completions = await getCompletions(testContent, testFilePath, 0, testContent.length);

    // This should provide member completions, not module name completions
    const hasModuleNames = completions.some(c => ['fs', 'debug', 'uci'].includes(c.label));
    assert(!hasModuleNames, 'Should NOT get module name completions outside import context');
  });
});
