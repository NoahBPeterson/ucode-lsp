// Test fs import validation - ensure fs cannot be used without import

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

describe('FS Import Validation Tests', function() {
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
    console.log('🚀 Starting LSP server for fs import validation tests...');
    
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
          
          // Handle other responses with IDs
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
        clientInfo: { name: 'fs-import-test-client', version: '1.0.0' },
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
        console.log('✅ LSP server initialized successfully');
        done();
      },
      timeout: setTimeout(() => {
        done(new Error('Server initialization timeout'));
      }, 8000)
    });

    serverProcess.stdin.write(createLSPMessage(initialize));
  });

  // Clean up server process
  after(function() {
    if (serverProcess) {
      console.log('🔥 Shutting down LSP server');
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

  describe('FS Import Validation', function() {
    it('should show error when fs.chmod is used without import', async function() {
      const testContent = `fs.chmod("lol", 0o644);`;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-fs-no-import.uc');
      
      // Should show import error
      const importErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("Cannot use 'fs' module without importing it first")
      );
      
      assert(importErrors.length > 0, 
        `Should show fs import error. Found diagnostics: ${diagnostics.map(d => d.message).join(', ')}`);
    });

    it('should show error when fs.open is used without import', async function() {
      const testContent = `
        let file = fs.open("/tmp/test", "r");
        fs.close(file);
      `;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-fs-open-no-import.uc');
      
      const importErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("Cannot use 'fs' module without importing it first")
      );
      
      assert(importErrors.length > 0, 'Should show fs import error for fs.open');
    });

    it('should show helpful import suggestion in error message', async function() {
      const testContent = `fs.chmod("/file", 0o644);`;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-fs-suggestion.uc');
      
      const importErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("Add: import { chmod } from 'fs';")
      );
      
      assert(importErrors.length > 0, 'Should show helpful import suggestion');
    });

    it('should NOT show error when fs is properly imported (namespace)', async function() {
      const testContent = `
        import * as fs from 'fs';
        fs.chmod("/file", 0o644);
      `;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-fs-namespace-import.uc');
      
      const importErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("Cannot use 'fs' module without importing it first")
      );
      
      assert.strictEqual(importErrors.length, 0, 
        `Should not show import error when fs is imported. Found: ${importErrors.map(d => d.message).join(', ')}`);
    });

    it('should NOT show error when fs functions are imported individually', async function() {
      const testContent = `
        import { chmod, open } from 'fs';
        chmod("/file", 0o644);
        let file = open("/tmp/test", "r");
      `;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-fs-named-import.uc');
      
      const importErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("Cannot use 'fs' module without importing it first")
      );
      
      assert.strictEqual(importErrors.length, 0, 'Should not show import error for named imports');
    });

    it('should show errors for other known modules too', async function() {
      const testContent = `
        debug.memdump("/tmp/dump");
        log.openlog("test");
        math.sin(3.14);
      `;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-other-modules.uc');
      
      const debugErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("Cannot use 'debug' module")
      );
      
      const logErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("Cannot use 'log' module")
      );
      
      const mathErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("Cannot use 'math' module")
      );
      
      assert(debugErrors.length > 0, 'Should show debug import error');
      assert(logErrors.length > 0, 'Should show log import error');
      assert(mathErrors.length > 0, 'Should show math import error');
    });

    it('should handle the original reported case', async function() {
      const testContent = `fs.chmod("lol", 0o644); // No error diagnostics! You cannot use fs without importing it :(`;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-original-case.uc');
      
      // Should now show the import error (fixing the original issue)
      const importErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("Cannot use 'fs' module without importing it first")
      );
      
      assert(importErrors.length > 0, 
        `Should now show fs import error for the original case. Found: ${diagnostics.map(d => d.message).join(', ')}`);
    });

    it('should have reasonable performance', async function() {
      const start = Date.now();
      
      const testContent = `
        fs.chmod("/file", 0o644);
        debug.memdump("/tmp/dump");
        log.syslog(1, "test");
      `;
      
      await getDiagnostics(testContent, '/tmp/test-performance.uc');
      
      const elapsed = Date.now() - start;
      
      // Should be reasonably fast (under 3 seconds)
      assert(elapsed < 3000, `Import validation should be fast. Took ${elapsed}ms`);
    });
  });
});