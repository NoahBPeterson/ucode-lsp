const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

describe('String Method Validation Tests', function() {
  this.timeout(10000); // 10 second timeout for LSP tests

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
      }, 5000)
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
      }, 6000);

      pendingRequests.set(`file://${testFilePath}`, { resolve, timeout });

      // Send didOpen message
      serverProcess.stdin.write(createLSPMessage(didOpen));
    });
  }

  describe('String Method Validation on test-string-methods.uc', function() {
    let diagnostics;
    const testFilePath = path.join(__dirname, 'test-string-methods.uc');

    before(async function() {
      // Ensure the test file exists
      if (!fs.existsSync(testFilePath)) {
        throw new Error(`Test file does not exist: ${testFilePath}`);
      }
      
      const testContent = fs.readFileSync(testFilePath, 'utf8');
      diagnostics = await getDiagnostics(testContent, testFilePath);
    });

    it('should detect toUpperCase() as invalid string method', function() {
      const errors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("Property 'toUpperCase' does not exist on string type")
      );
      assert.strictEqual(errors.length, 1, 'Should find exactly one toUpperCase error');
      
      // Verify the error location points to the method name
      const error = errors[0];
      assert.strictEqual(error.range.start.line, 8, 'Error should be on line 9 (0-indexed line 8)');
      assert.strictEqual(error.range.start.character, 17, 'Error should start at character 17');
      assert.strictEqual(error.range.end.character, 28, 'Error should end at character 28');
    });

    it('should detect toLowerCase() as invalid string method', function() {
      const errors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("Property 'toLowerCase' does not exist on string type")
      );
      assert.strictEqual(errors.length, 1, 'Should find exactly one toLowerCase error');
      
      const error = errors[0];
      assert.strictEqual(error.range.start.line, 9, 'Error should be on line 10 (0-indexed line 9)');
    });

    it('should detect replace() as invalid string method', function() {
      const errors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("Property 'replace' does not exist on string type")
      );
      assert.strictEqual(errors.length, 1, 'Should find exactly one replace error');
      
      const error = errors[0];
      assert.strictEqual(error.range.start.line, 10, 'Error should be on line 11 (0-indexed line 10)');
    });

    it('should detect split() as invalid string method', function() {
      const errors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("Property 'split' does not exist on string type")
      );
      assert.strictEqual(errors.length, 1, 'Should find exactly one split error');
      
      const error = errors[0];
      assert.strictEqual(error.range.start.line, 11, 'Error should be on line 12 (0-indexed line 11)');
    });

    it('should detect trim() as invalid string method', function() {
      const errors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("Property 'trim' does not exist on string type")
      );
      assert.strictEqual(errors.length, 1, 'Should find exactly one trim error');
      
      const error = errors[0];
      assert.strictEqual(error.range.start.line, 14, 'Error should be on line 15 (0-indexed line 14)');
    });

    it('should detect substring() as invalid string method', function() {
      const errors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("Property 'substring' does not exist on string type")
      );
      assert.strictEqual(errors.length, 1, 'Should find exactly one substring error');
      
      const error = errors[0];
      assert.strictEqual(error.range.start.line, 15, 'Error should be on line 16 (0-indexed line 15)');
    });

    it('should detect charAt() as invalid string method', function() {
      const errors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("Property 'charAt' does not exist on string type")
      );
      assert.strictEqual(errors.length, 1, 'Should find exactly one charAt error');
      
      const error = errors[0];
      assert.strictEqual(error.range.start.line, 16, 'Error should be on line 17 (0-indexed line 16)');
    });

    it('should detect indexOf() as invalid string method', function() {
      const errors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("Property 'indexOf' does not exist on string type")
      );
      assert.strictEqual(errors.length, 1, 'Should find exactly one indexOf error');
      
      const error = errors[0];
      assert.strictEqual(error.range.start.line, 17, 'Error should be on line 18 (0-indexed line 17)');
    });

    it('should find exactly 8 string method validation errors total', function() {
      const stringMethodErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes('does not exist on string type') &&
        d.message.includes('Property')
      );
      assert.strictEqual(stringMethodErrors.length, 8, 'Should find exactly 8 string method errors');
    });

    it('should allow access to valid string property length', function() {
      // There should be no error for text.length (line 5 in the test file)
      const lengthErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("Property 'length' does not exist on string type")
      );
      assert.strictEqual(lengthErrors.length, 0, 'Should not report length as invalid property');
    });

    it('should have consistent error message format', function() {
      const stringMethodErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes('does not exist on string type') &&
        d.message.includes('Property')
      );

      stringMethodErrors.forEach(error => {
        assert(error.message.includes('Property'), 'Error message should start with Property');
        assert(error.message.includes('does not exist on string type'), 'Error message should explain the issue');
        assert(error.message.includes('Strings in ucode only have a \'length\' property, not methods'), 'Error message should provide guidance');
        assert.strictEqual(error.source, 'ucode-semantic', 'Error source should be ucode-semantic');
      });
    });

    it('should have precise error ranges that point to method names only', function() {
      const stringMethodErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes('does not exist on string type') &&
        d.message.includes('Property')
      );

      stringMethodErrors.forEach(error => {
        // Error range should be reasonable (method names are typically 3-11 characters)
        const rangeLength = error.range.end.character - error.range.start.character;
        assert(rangeLength >= 3 && rangeLength <= 15, 
          `Error range length (${rangeLength}) should be reasonable for method name`);
        
        // Start and end positions should be valid
        assert(error.range.start.character >= 0, 'Start character should be non-negative');
        assert(error.range.end.character > error.range.start.character, 'End should be after start');
        assert(error.range.start.line >= 0, 'Start line should be non-negative');
        assert(error.range.end.line >= error.range.start.line, 'End line should be >= start line');
      });
    });
  });

  describe('String Method Validation Edge Cases', function() {
    it('should validate computed string property access', async function() {
      const testContent = `
let text = "hello";
let methodName = "toUpperCase";
let result = text[methodName](); // This should not trigger string method validation
      `;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-computed.uc');
      
      // Should not report string method errors for computed access
      const stringMethodErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes('does not exist on string type')
      );
      assert.strictEqual(stringMethodErrors.length, 0, 'Should not validate computed property access');
    });

    it('should only validate non-computed string property access', async function() {
      const testContent = `
let text = "hello";
let validLength = text.length;     // Valid - should not error
let invalidMethod = text.charAt(0); // Invalid - should error
      `;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-mixed.uc');
      
      const stringMethodErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes('does not exist on string type')
      );
      assert.strictEqual(stringMethodErrors.length, 1, 'Should find exactly one error for charAt');
      
      const lengthErrors = diagnostics.filter(d => 
        d.message.includes("Property 'length' does not exist")
      );
      assert.strictEqual(lengthErrors.length, 0, 'Should not error on valid length property');
    });

    it('should handle empty string method names gracefully', async function() {
      // This tests edge case handling in the validation code
      const testContent = `
let text = "hello";
// This is syntactically invalid but shouldn't crash the validator
      `;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-empty.uc');
      
      // Should not crash and should return some diagnostics (even if empty)
      assert(Array.isArray(diagnostics), 'Should return diagnostics array');
    });
  });
});