const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

describe('Comma Operator Parsing LSP Tests', function() {
  this.timeout(15000); // 15 second timeout for LSP tests

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
    serverProcess = spawn('node', ['dist/server.js', '--stdio'], {
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
          
          // Handle responses with IDs
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
        clientInfo: { name: 'test-client', version: '1.0.0' },
        capabilities: {}
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
        done();
      },
      timeout: setTimeout(() => {
        done(new Error('Server initialization timeout'));
      }, 10000)
    });

    serverProcess.stdin.write(createLSPMessage(initialize));
  });

  // Clean up server process
  after(function() {
    if (serverProcess) {
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

  describe('Comma Operator Parsing on test-comma-operator-lsp.uc', function() {
    let diagnostics;
    const testFilePath = path.join(__dirname, 'test-comma-operator-lsp.uc');

    before(async function() {
      // Ensure the test file exists
      if (!fs.existsSync(testFilePath)) {
        throw new Error(`Test file does not exist: ${testFilePath}`);
      }
      
      const testContent = fs.readFileSync(testFilePath, 'utf8');
      diagnostics = await getDiagnostics(testContent, testFilePath);
    });

    it('should NOT show "Expected \')\' after expression" error for comma operator', function() {
      const commaErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("Expected ')' after expression")
      );
      assert.strictEqual(commaErrors.length, 0, 'Should not show comma operator parsing errors');
    });

    it('should NOT show "Unexpected token in expression" error for comma operator', function() {
      const tokenErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("Unexpected token in expression")
      );
      assert.strictEqual(tokenErrors.length, 0, 'Should not show unexpected token errors for comma');
    });

    it('should parse the exact user example without errors', function() {
      // The specific example that was failing:
      // rv.val = trim(replace(val, /^[ \t]*!/, () => (rv.invert = true, '')));
      const specificErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        (d.message.includes("Expected ')' after expression") ||
         d.message.includes("Unexpected token in expression"))
      );
      assert.strictEqual(specificErrors.length, 0, 'Should parse the exact user example correctly');
    });

    it('should allow basic comma operator in parentheses', function() {
      // Test case: (a = 1, b = 2)
      const basicCommaErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.range.start.line >= 4 && d.range.start.line <= 6 && // Lines around basic comma test
        (d.message.includes("Expected ')' after expression") ||
         d.message.includes("Unexpected token"))
      );
      assert.strictEqual(basicCommaErrors.length, 0, 'Should allow basic comma operator usage');
    });

    it('should allow comma operator in function callbacks', function() {
      // Test case: callback functions with comma operators
      const callbackErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.range.start.line >= 8 && d.range.start.line <= 12 && // Lines around callback test
        (d.message.includes("Expected ')' after expression") ||
         d.message.includes("Unexpected token"))
      );
      assert.strictEqual(callbackErrors.length, 0, 'Should allow comma operator in callbacks');
    });

    it('should allow multiple comma operators', function() {
      // Test case: (x = 1, y = 2, z = 3)
      const multipleCommaErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.range.start.line >= 14 && d.range.start.line <= 16 && // Lines around multiple comma test
        (d.message.includes("Expected ')' after expression") ||
         d.message.includes("Unexpected token"))
      );
      assert.strictEqual(multipleCommaErrors.length, 0, 'Should allow multiple comma operators');
    });

    it('should have reasonable total diagnostic count', function() {
      // Should not have excessive parsing errors now that comma operator works
      const totalErrors = diagnostics.filter(d => d.severity === 1);
      assert(totalErrors.length < 10, `Should have fewer than 10 errors, got ${totalErrors.length}: ${totalErrors.map(e => e.message).join(', ')}`);
    });

    it('should have consistent error message format for any remaining errors', function() {
      const errors = diagnostics.filter(d => d.severity === 1);

      errors.forEach(error => {
        // Check that error has proper structure
        assert(error.message && error.message.length > 0, 'Error message should not be empty');
        assert(error.source, 'Error should have source');
        assert(error.range, 'Error should have range');
        assert(typeof error.range.start.line === 'number', 'Error should have valid line number');
        assert(typeof error.range.start.character === 'number', 'Error should have valid character number');
      });
    });

    it('should have precise error ranges for any remaining errors', function() {
      const errors = diagnostics.filter(d => d.severity === 1);

      errors.forEach(error => {
        // Error range should be reasonable
        const rangeLength = error.range.end.character - error.range.start.character;
        assert(rangeLength >= 1 && rangeLength <= 100, 
          `Error range length (${rangeLength}) should be reasonable for: ${error.message}`);
        
        // Start and end positions should be valid
        assert(error.range.start.character >= 0, 'Start character should be non-negative');
        assert(error.range.end.character > error.range.start.character, 'End should be after start');
        assert(error.range.start.line >= 0, 'Start line should be non-negative');
        assert(error.range.end.line >= error.range.start.line, 'End line should be >= start line');
      });
    });
  });

  describe('Comma Operator Edge Cases', function() {
    it('should handle comma operator in conditional expressions', async function() {
      const testContent = `
let flag = true;
let result = flag ? (a = 1, a + 2) : (b = 2, b * 2);
      `;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-conditional-comma.uc');
      
      // Should not report comma operator parsing errors
      const commaErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        (d.message.includes("Expected ')' after expression") ||
         d.message.includes("Unexpected token in expression"))
      );
      assert.strictEqual(commaErrors.length, 0, 'Should handle comma operator in conditional expressions');
    });

    it('should handle comma operator in array literals', async function() {
      const testContent = `
let arr = [(x = 1, x + 1), (y = 2, y * 2)];
      `;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-array-comma.uc');
      
      // Should not report comma operator parsing errors
      const commaErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        (d.message.includes("Expected ')' after expression") ||
         d.message.includes("Unexpected token in expression"))
      );
      assert.strictEqual(commaErrors.length, 0, 'Should handle comma operator in array literals');
    });

    it('should handle nested comma operators', async function() {
      const testContent = `
let result = (a = (b = 5, b + 1), c = (a + 2, a * 2));
      `;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-nested-comma.uc');
      
      // Should not report comma operator parsing errors
      const commaErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        (d.message.includes("Expected ')' after expression") ||
         d.message.includes("Unexpected token in expression"))
      );
      assert.strictEqual(commaErrors.length, 0, 'Should handle nested comma operators');
    });

    it('should handle comma operator with function calls', async function() {
      const testContent = `
let result = (console.log('test'), getValue());
      `;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-function-comma.uc');
      
      // Should not report comma operator parsing errors
      const commaErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        (d.message.includes("Expected ')' after expression") ||
         d.message.includes("Unexpected token in expression"))
      );
      assert.strictEqual(commaErrors.length, 0, 'Should handle comma operator with function calls');
    });
  });
});