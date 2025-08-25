const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

describe('NLResult Specific Test', function() {
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
        capabilities: {}
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

  it('should suppress nlresult diagnostic with disable comment', async function() {
    const testContent = `let nlresult = nl.request(); // ucode-lsp disable`;
    const testFilePath = '/tmp/test-nlresult.uc';
    
    const diagnostics = await getDiagnostics(testContent, testFilePath);
    
    console.log(`\nNLResult test diagnostics: ${diagnostics.length}`);
    diagnostics.forEach((d, i) => {
      console.log(`  [${i}] Line ${d.range.start.line}: "${d.message}" (severity: ${d.severity}, source: ${d.source})`);
    });
    
    // Should have no diagnostics because the disable comment should suppress all errors on this line
    assert.strictEqual(diagnostics.length, 0, `Expected no diagnostics, but got ${diagnostics.length}: ${JSON.stringify(diagnostics.map(d => d.message))}`);
  });
});