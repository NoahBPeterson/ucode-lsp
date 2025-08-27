const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

describe('Disable Comments Parser Diagnostics Tests', function() {
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

  describe('Parser Diagnostic Suppression', function() {
    it('should suppress parser diagnostics on lines with disable comments', async function() {
      const testContent = `let nlresult = nl.request(); // ucode-lsp disable`;
      const testFilePath = '/tmp/test-parser-disable.uc';
      
      const diagnostics = await getDiagnostics(testContent, testFilePath);
      
      console.log(`\nParser disable test diagnostics: ${diagnostics.length}`);
      diagnostics.forEach((d, i) => {
        console.log(`  [${i}] Line ${d.range.start.line}: "${d.message}" (severity: ${d.severity}, source: ${d.source})`);
      });
      
      // Should have diagnostics, but they should be warnings (severity 2), not errors (severity 1)
      assert(diagnostics.length > 0, 'Should have diagnostics (converted to warnings)');
      
      const errorDiagnostics = diagnostics.filter(d => d.severity === 1);
      assert.strictEqual(errorDiagnostics.length, 0, 'Should have no error-level diagnostics on disabled line');
    });

    it('should suppress both parser and semantic diagnostics on disabled lines', async function() {
      const testContent = `let undefinedVar = someUndefinedFunction(); // ucode-lsp disable
let anotherVar = anotherUndefinedFunction();`;
      const testFilePath = '/tmp/test-both-disable.uc';
      
      const diagnostics = await getDiagnostics(testContent, testFilePath);
      
      console.log(`\nBoth diagnostics test: ${diagnostics.length}`);
      diagnostics.forEach((d, i) => {
        console.log(`  [${i}] Line ${d.range.start.line}: "${d.message}" (severity: ${d.severity}, source: ${d.source})`);
      });
      
      // Line 0 should have warnings only (no errors), line 1 should have errors
      const line0Diagnostics = diagnostics.filter(d => d.range.start.line === 0);
      const line1Diagnostics = diagnostics.filter(d => d.range.start.line === 1);
      
      const line0Errors = line0Diagnostics.filter(d => d.severity === 1);
      const line0Warnings = line0Diagnostics.filter(d => d.severity === 2);
      const line1Errors = line1Diagnostics.filter(d => d.severity === 1);
      
      assert.strictEqual(line0Errors.length, 0, 'Line 0 should have no error-level diagnostics (disabled)');
      assert(line0Warnings.length > 0, 'Line 0 should have warning-level diagnostics (converted from errors)');
      assert(line1Errors.length > 0, 'Line 1 should have error-level diagnostics (not disabled)');
    });

    it('should only suppress diagnostics on the specific disabled line', async function() {
      const testContent = `let error1 = undefinedFunction1();
let error2 = undefinedFunction2(); // ucode-lsp disable
let error3 = undefinedFunction3();`;
      const testFilePath = '/tmp/test-specific-line-disable.uc';
      
      const diagnostics = await getDiagnostics(testContent, testFilePath);
      
      console.log(`\nSpecific line disable test: ${diagnostics.length}`);
      diagnostics.forEach((d, i) => {
        console.log(`  [${i}] Line ${d.range.start.line}: "${d.message}" (severity: ${d.severity}, source: ${d.source})`);
      });
      
      const line0Diagnostics = diagnostics.filter(d => d.range.start.line === 0);
      const line1Diagnostics = diagnostics.filter(d => d.range.start.line === 1);
      const line2Diagnostics = diagnostics.filter(d => d.range.start.line === 2);
      
      // Line 0 should have errors (not disabled)
      const line0Errors = line0Diagnostics.filter(d => d.severity === 1);
      assert(line0Errors.length > 0, 'Line 0 should have error-level diagnostics (not disabled)');
      
      // Line 1 should have warnings only (no errors)
      const line1Errors = line1Diagnostics.filter(d => d.severity === 1);
      const line1Warnings = line1Diagnostics.filter(d => d.severity === 2);
      assert.strictEqual(line1Errors.length, 0, 'Line 1 should have no error-level diagnostics (disabled)');
      assert(line1Warnings.length > 0, 'Line 1 should have warning-level diagnostics (converted from errors)');
      
      // Line 2 should have errors (not disabled)
      const line2Errors = line2Diagnostics.filter(d => d.severity === 1);
      assert(line2Errors.length > 0, 'Line 2 should have error-level diagnostics (not disabled)');
    });
  });
});