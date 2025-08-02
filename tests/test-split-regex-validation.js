const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

describe('Split Function Regex Support Tests', function() {
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
          
          // Handle publishDiagnostics notifications (for diagnostic tests)
          if (message.method === 'textDocument/publishDiagnostics') {
            const uri = message.params.uri;
            if (pendingRequests.has(uri)) {
              const { resolve, timeout } = pendingRequests.get(uri);
              clearTimeout(timeout);
              pendingRequests.delete(uri);
              resolve(message.params.diagnostics);
            }
          }
          
          // Handle initialization response
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
      resolve: (result) => {
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

  describe('Split Function Regex Pattern Support', function() {
    it('should accept string separator without errors', async function() {
      const testContent = `
let text = "hello world test";
let words = split(text, " ");
      `;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-split-string.uc');
      
      // Should only have unused variable warning, no type errors
      const typeErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("expects") && 
        d.message.includes("split")
      );
      assert.strictEqual(typeErrors.length, 0, 'Should not have type errors for string separator');
    });

    it('should accept regex separator without errors', async function() {
      const testContent = `
let text = "hello world test";
let words = split(text, /\\s+/);
      `;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-split-regex.uc');
      
      // Should only have unused variable warning, no type errors
      const typeErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("expects") && 
        d.message.includes("split")
      );
      assert.strictEqual(typeErrors.length, 0, 'Should not have type errors for regex separator');
    });

    it('should accept regex separator with limit parameter without errors', async function() {
      const testContent = `
let text = "hello world test example";
let words = split(text, /\\s+/, 2);
      `;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-split-regex-limit.uc');
      
      // Should only have unused variable warning, no type errors
      const typeErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("expects") && 
        d.message.includes("split")
      );
      assert.strictEqual(typeErrors.length, 0, 'Should not have type errors for regex separator with limit');
    });

    it('should show error for number as separator', async function() {
      const testContent = `
let text = "hello world test";
let words = split(text, 123);
      `;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-split-invalid.uc');
      
      // Should have a type error for invalid separator
      const typeErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("expects string or regex pattern as second argument") &&
        d.message.includes("split")
      );
      assert.strictEqual(typeErrors.length, 1, 'Should have exactly one type error for invalid separator');
      assert(typeErrors[0].message.includes('got integer'), 'Error message should mention getting integer');
    });

    it('should show error for array as separator', async function() {
      const testContent = `
let text = "hello world test";
let words = split(text, []);
      `;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-split-array.uc');
      
      // Should have a type error for invalid separator
      const typeErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("expects string or regex pattern as second argument") &&
        d.message.includes("split")
      );
      assert.strictEqual(typeErrors.length, 1, 'Should have exactly one type error for array separator');
      assert(typeErrors[0].message.includes('got array'), 'Error message should mention getting array');
    });

    it('should show error for wrong limit parameter type', async function() {
      const testContent = `
let text = "hello world test";
let words = split(text, /\\s+/, "invalid");
      `;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-split-bad-limit.uc');
      
      // Should have a type error for invalid limit parameter
      const typeErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("expects integer as third argument") &&
        d.message.includes("split")
      );
      assert.strictEqual(typeErrors.length, 1, 'Should have exactly one type error for invalid limit');
      assert(typeErrors[0].message.includes('got string'), 'Error message should mention getting string');
    });

    it('should work with complex regex patterns', async function() {
      const testContent = `
let text = "word1:word2;word3,word4";
let words1 = split(text, /[;:,]/);
let words2 = split(text, /[;:,]/, 3);
      `;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-split-complex-regex.uc');
      
      // Should only have unused variable warnings, no type errors
      const typeErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("expects") && 
        d.message.includes("split")
      );
      assert.strictEqual(typeErrors.length, 0, 'Should not have type errors for complex regex patterns');
    });
  });

  describe('Consistency with Other Regex-Supporting Functions', function() {
    it('should handle regex consistently across split, match, and replace', async function() {
      const testContent = `
let text = "hello world test";
let pattern = /\\s+/;

// All these should work without type errors
let words = split(text, pattern);
let matches = match(text, pattern);
let replaced = replace(text, pattern, "_");
      `;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-regex-consistency.uc');
      
      // Should only have unused variable warnings, no type errors for any function
      const typeErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("expects") && 
        (d.message.includes("split") || d.message.includes("match") || d.message.includes("replace"))
      );
      assert.strictEqual(typeErrors.length, 0, 'Should not have type errors for any regex-supporting function');
    });
  });
});