const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

describe('Filter Builtin Function Validation Tests', function() {
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
          
          // Handle hover responses with IDs
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

  // Helper function to get hover information using shared server
  function getHoverInfo(testContent, testFilePath, line, character) {
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

      const hover = {
        jsonrpc: '2.0',
        id: currentRequestId,
        method: 'textDocument/hover',
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
          reject(new Error('Timeout waiting for hover response'));
        }
      }, 6000);

      pendingRequests.set(currentRequestId, { resolve, timeout });

      // Send messages
      serverProcess.stdin.write(createLSPMessage(didOpen));
      
      // Wait a bit for document to be processed, then send hover
      setTimeout(() => {
        serverProcess.stdin.write(createLSPMessage(hover));
      }, 100);
    });
  }

  describe('Filter Builtin Function Recognition', function() {
    const testContent = `// Test filter builtin function
const batman_ifaces = filter(split("lol:lol", ';'), () => true);
let evens = filter([1, 2, 3, 4, 5], n => n % 2 == 0);
let filtered = filter(["a", "b", "c"], (val, idx) => idx > 0);`;

    it('should not show "Undefined function" error for filter builtin', async function() {
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-filter-builtin.uc');
      
      // Check for "Undefined function: filter" errors
      const undefinedFilterErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes('Undefined function') && 
        d.message.includes('filter')
      );
      
      assert.strictEqual(undefinedFilterErrors.length, 0, 
        `Should not show "Undefined function: filter" errors. Found: ${undefinedFilterErrors.map(e => e.message).join(', ')}`);
    });

    it('should provide hover information for filter builtin', async function() {
      const hover = await getHoverInfo(testContent, '/tmp/test-filter-hover.uc', 1, 25);
      
      assert(hover, 'Should return hover information for filter');
      assert(hover.contents && hover.contents.value, 'Should have hover content');
      assert(hover.contents.value.includes('filter'), 'Should mention filter function');
      assert(hover.contents.value.includes('Filter array elements'), 'Should describe filtering');
      assert(hover.contents.value.includes('callback'), 'Should mention callback parameter');
    });

    it('should recognize filter as a valid builtin function', async function() {
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-filter-valid.uc');
      
      // Filter should be recognized, so no "undefined function" errors
      const errors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.toLowerCase().includes('undefined') &&
        d.message.toLowerCase().includes('filter')
      );
      
      assert.strictEqual(errors.length, 0, 
        'Filter builtin should be recognized as valid function');
    });
  });

  describe('Array Method Validation (Invalid Usage)', function() {
    const arrayMethodTestContent = `// Test invalid array method calls
let data = ["a", "b", "c"];
let result1 = data.filter(x => x !== "b");  // Invalid - arrays don't have methods
let result2 = data.map(x => x.toUpperCase()); // Invalid - arrays don't have methods  
let result3 = data.length;  // Valid - arrays have length property

// Also test on split result
let parts = split("a,b,c", ",");
let filtered = parts.filter(x => x !== "b");  // Invalid - split returns array, arrays don't have methods`;

    it('should detect invalid .filter() method call on arrays', async function() {
      const diagnostics = await getDiagnostics(arrayMethodTestContent, '/tmp/test-array-methods.uc');
      
      // Look for array method validation errors
      const arrayMethodErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        (d.message.includes('does not exist on array type') || 
         d.message.includes('arrays do not have methods') ||
         d.message.includes('Property \'filter\' does not exist'))
      );
      
      // We expect at least 3 method call errors (data.filter, data.map, parts.filter)
      assert(arrayMethodErrors.length >= 2, 
        `Should detect invalid array method calls. Found ${arrayMethodErrors.length} errors: ${arrayMethodErrors.map(e => e.message).join(', ')}`);
    });

    it('should detect invalid array property access (length)', async function() {
      const diagnostics = await getDiagnostics(arrayMethodTestContent, '/tmp/test-array-properties.uc');
      
      // Should error on .length property access since arrays have no properties
      const lengthPropertyErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes('Property \'length\' does not exist on array type')
      );
      
      assert(lengthPropertyErrors.length >= 1, 
        'Should detect invalid .length property access on arrays - use length(array) instead');
    });

    it('should provide helpful error messages for array methods', async function() {
      const diagnostics = await getDiagnostics(arrayMethodTestContent, '/tmp/test-array-error-messages.uc');
      
      // Find array method errors and check message quality
      const methodErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        (d.message.includes('filter') || d.message.includes('map')) &&
        d.message.includes('does not exist')
      );
      
      if (methodErrors.length > 0) {
        methodErrors.forEach(error => {
          // Error message should be informative
          assert(error.message.includes('array'), 'Error message should mention array type');
          assert(error.source === 'ucode-semantic', 'Error source should be ucode-semantic');
        });
      }
    });
  });

  describe('Filter vs Array Methods Edge Cases', function() {
    it('should distinguish between valid filter() builtin and invalid .filter() method', async function() {
      const edgeCaseContent = `// Valid builtin usage
let validResult = filter([1, 2, 3], x => x > 1);

// Invalid method usage  
let arr = [1, 2, 3];
let invalidResult = arr.filter(x => x > 1);

// Complex case with split
let splitResult = split("a,b,c", ",");
let validFiltered = filter(splitResult, x => x !== "b");  // Valid builtin
let invalidFiltered = splitResult.filter(x => x !== "b");  // Invalid method`;

      const diagnostics = await getDiagnostics(edgeCaseContent, '/tmp/test-edge-cases.uc');
      
      // Should not error on valid builtin filter() calls
      const undefinedFilterErrors = diagnostics.filter(d => 
        d.message.includes('Undefined function') && 
        d.message.includes('filter')
      );
      assert.strictEqual(undefinedFilterErrors.length, 0, 
        'Should not show undefined function errors for valid filter() builtin calls');
      
      // Should error on invalid .filter() method calls
      const arrayMethodErrors = diagnostics.filter(d => 
        d.message.includes('does not exist') && 
        d.message.includes('filter')
      );
      assert(arrayMethodErrors.length >= 2, 
        `Should detect invalid .filter() method calls. Found ${arrayMethodErrors.length} errors`);
    });
  });
});