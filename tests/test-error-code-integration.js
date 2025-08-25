const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

describe('Error Code Integration Tests', function() {
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
            if (pendingRequests.has(uri)) {
              const { resolve, timeout } = pendingRequests.get(uri);
              clearTimeout(timeout);
              pendingRequests.delete(uri);
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
        if (pendingRequests.has(`file://${testFilePath}`)) {
          pendingRequests.delete(`file://${testFilePath}`);
          reject(new Error('Timeout waiting for diagnostics'));
        }
      }, 6000);

      pendingRequests.set(`file://${testFilePath}`, { resolve, timeout });
      serverProcess.stdin.write(createLSPMessage(didOpen));
    });
  }

  describe('Error Code Diagnostics', function() {
    let diagnostics;
    const testFilePath = path.join(__dirname, '..', 'test-error-codes.uc');

    before(async function() {
      if (!fs.existsSync(testFilePath)) {
        throw new Error(`Test file does not exist: ${testFilePath}`);
      }
      
      const testContent = fs.readFileSync(testFilePath, 'utf8');
      diagnostics = await getDiagnostics(testContent, testFilePath);
    });

    it('should include error codes in diagnostics', function() {
      console.log(`Total diagnostics found: ${diagnostics.length}`);
      console.log('All diagnostics:');
      diagnostics.forEach((d, i) => {
        console.log(`  [${i}] Code: ${d.code || 'none'}, Message: "${d.message}", Severity: ${d.severity}`);
      });
      
      // Check that some diagnostics have error codes
      const diagnosticsWithCodes = diagnostics.filter(d => d.code);
      console.log(`Diagnostics with codes: ${diagnosticsWithCodes.length}`);
      assert(diagnosticsWithCodes.length > 0, 'At least some diagnostics should have error codes');
    });

    it('should have UNDEFINED_VARIABLE error code for undefined variables', function() {
      const undefinedVarErrors = diagnostics.filter(d => 
        d.code === 'UC1001' || d.message.includes('Undefined variable')
      );
      assert(undefinedVarErrors.length > 0, 'Should have undefined variable errors');
    });

    it('should have VARIABLE_REDECLARATION error code for redeclared variables', function() {
      const redeclarationErrors = diagnostics.filter(d => 
        d.code === 'UC1003' || d.message.includes('already declared')
      );
      assert(redeclarationErrors.length > 0, 'Should have variable redeclaration errors');
    });

    it('should have UNUSED_VARIABLE warning code for unused variables', function() {
      const unusedVarWarnings = diagnostics.filter(d => 
        d.code === 'UC1006' || d.message.includes('never used')
      );
      assert(unusedVarWarnings.length > 0, 'Should have unused variable warnings');
    });

    it('should have INVALID_IMPORT error code for invalid imports', function() {
      const invalidImportErrors = diagnostics.filter(d => 
        d.code === 'UC3001' || d.message.includes('not exported')
      );
      assert(invalidImportErrors.length > 0, 'Should have invalid import errors');
    });
  });
});