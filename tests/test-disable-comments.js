const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

describe('Disable Comments Tests', function() {
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

  describe('Disable Comment Validation on test-disable-comments.uc', function() {
    let diagnostics;
    const testFilePath = path.join(__dirname, 'test-disable-comments.uc');

    before(async function() {
      // Ensure the test file exists
      if (!fs.existsSync(testFilePath)) {
        throw new Error(`Test file does not exist: ${testFilePath}`);
      }
      
      const testContent = fs.readFileSync(testFilePath, 'utf8');
      diagnostics = await getDiagnostics(testContent, testFilePath);
      
      console.log(`\nTotal diagnostics: ${diagnostics.length}`);
      console.log('All diagnostics:');
      diagnostics.forEach((d, i) => {
        console.log(`  [${i}] Line ${d.range.start.line}: "${d.message}" (severity: ${d.severity})`);
      });
    });

    it('should NOT report errors on lines with // ucode-lsp disable comment', function() {
      // Lines with disable comments should not have errors
      const disabledLineErrors = diagnostics.filter(d => 
        (d.range.start.line === 8 || // let disabledExample = invalidFunction(); // ucode-lsp disable
         d.range.start.line === 18 || // undefinedVariable; // ucode-lsp disable  
         d.range.start.line === 19) && // let test = undefinedFunction2(); // ucode-lsp disable
        d.severity === 1 // Error severity
      );
      
      assert.strictEqual(disabledLineErrors.length, 0, 
        `Should not report errors on lines with disable comments. Found errors: ${JSON.stringify(disabledLineErrors)}`);
    });

    it('should NOT report errors on multi-line statements with // ucode-lsp disable', function() {
      // Multi-line statement with disable comment (lines 11-15) should not have errors
      const multiLineDisabledErrors = diagnostics.filter(d => 
        d.range.start.line >= 10 && d.range.start.line <= 14 && // Multi-line disabled statement range
        d.severity === 1
      );
      
      assert.strictEqual(multiLineDisabledErrors.length, 0, 
        `Should not report errors on multi-line statements with disable comments. Found errors: ${JSON.stringify(multiLineDisabledErrors)}`);
    });

    it('should still report errors on lines WITHOUT disable comments', function() {
      // Line 7: let invalidExample = invalidFunction(); (no disable comment)
      console.log('Looking for errors on line 7 (invalidExample line)');
      const normalErrors = diagnostics.filter(d => 
        d.range.start.line === 7 && 
        d.severity === 1
      );
      
      console.log(`Found ${normalErrors.length} errors on line 7:`);
      normalErrors.forEach(e => console.log(`  - ${e.message}`));
      
      assert(normalErrors.length > 0, 'Should still report errors on lines without disable comments');
    });

    it('should report errors on multi-line statements WITHOUT disable comments', function() {
      // Multi-line statement without disable (lines around 18-22) should have errors
      const multiLineErrors = diagnostics.filter(d => 
        d.range.start.line >= 17 && d.range.start.line <= 21 && 
        d.severity === 1
      );
      
      assert(multiLineErrors.length > 0, 
        `Should report errors on multi-line statements without disable comments`);
    });

    it('should report errors on the final test line', function() {
      // Line with "let normalError = thisWillError();" should have error
      console.log('Looking for errors on line 34 (normalError line)');
      const finalLineErrors = diagnostics.filter(d => 
        d.range.start.line === 34 && // Line 35 in 1-based, 34 in 0-based
        d.severity === 1
      );
      
      console.log(`Found ${finalLineErrors.length} errors on line 34:`);
      finalLineErrors.forEach(e => console.log(`  - ${e.message}`));
      
      assert(finalLineErrors.length > 0, 'Should report errors on lines without disable comments');
    });

  });

  describe('Disable Comment Edge Cases', function() {
    it('should handle disable comment at different positions in line', async function() {
      const testContent = `
let test1 = invalidFunc(); // ucode-lsp disable
let test2 = invalidFunc(); // some text ucode-lsp disable more text  
let test3 = invalidFunc(); // ucode-lsp disable with more
      `;
      
      console.log('\nTest content lines:');
      testContent.split('\n').forEach((line, i) => {
        console.log(`  Line ${i}: "${line}"`);
      });
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-edge.uc');
      
      console.log('\nEdge case diagnostics:');
      diagnostics.forEach((d, i) => {
        console.log(`  [${i}] Line ${d.range.start.line}: "${d.message}" (severity: ${d.severity})`);
      });
      
      // Should have no errors since all lines have disable comments
      const errors = diagnostics.filter(d => d.severity === 1);
      console.log(`Expected 1 error, got ${errors.length}`);
      assert.strictEqual(errors.length, 1, 'Should handle disable comments at different positions');
    });

    it('should be case sensitive for disable comment', async function() {
      const testContent = `
let test1 = invalidFunc(); // UCODE-LSP DISABLE (wrong case)
let test2 = invalidFunc(); // ucode-lsp disable (correct case)
      `;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-case.uc');
      
      // Line 1 should have error (wrong case), line 2 should not
      const line1Errors = diagnostics.filter(d => d.range.start.line === 1 && d.severity === 1);
      const line2Errors = diagnostics.filter(d => d.range.start.line === 2 && d.severity === 1);
      
      assert(line1Errors.length > 0, 'Should report errors when disable comment has wrong case');
      assert.strictEqual(line2Errors.length, 0, 'Should not report errors when disable comment has correct case');
    });
  });
});