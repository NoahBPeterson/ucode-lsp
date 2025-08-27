const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

describe('Disable Comments Warning Conversion Tests', function() {
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
      }, 8000);

      pendingRequests.set(`diagnostics:file://${testFilePath}`, { resolve, timeout });
      serverProcess.stdin.write(createLSPMessage(didOpen));
    });
  }

  describe('Error to Warning Conversion', function() {
    it('should convert errors to warnings on disabled lines', async function() {
      const testContent = `let errorVar = undefinedFunction(); // ucode-lsp disable`;
      const testFilePath = '/tmp/test-error-to-warning.uc';
      
      const diagnostics = await getDiagnostics(testContent, testFilePath);
      
      console.log(`\nError to warning conversion test: ${diagnostics.length} diagnostics`);
      diagnostics.forEach((d, i) => {
        console.log(`  [${i}] Line ${d.range.start.line}: "${d.message}" (severity: ${d.severity}, source: ${d.source})`);
      });
      
      // Should have diagnostics, but they should all be warnings (severity 2), not errors (severity 1)
      assert(diagnostics.length > 0, 'Should have diagnostics');
      
      const errorDiagnostics = diagnostics.filter(d => d.severity === 1);
      const warningDiagnostics = diagnostics.filter(d => d.severity === 2);
      
      assert.strictEqual(errorDiagnostics.length, 0, 'Should have no error-level diagnostics on disabled line');
      assert(warningDiagnostics.length > 0, 'Should have warning-level diagnostics on disabled line');
    });

    it('should keep original errors on non-disabled lines', async function() {
      const testContent = `let errorVar1 = undefinedFunction1();
let errorVar2 = undefinedFunction2(); // ucode-lsp disable
let errorVar3 = undefinedFunction3();`;
      const testFilePath = '/tmp/test-mixed-errors.uc';
      
      const diagnostics = await getDiagnostics(testContent, testFilePath);
      
      console.log(`\nMixed errors test: ${diagnostics.length} diagnostics`);
      diagnostics.forEach((d, i) => {
        console.log(`  [${i}] Line ${d.range.start.line}: "${d.message}" (severity: ${d.severity}, source: ${d.source})`);
      });
      
      const line0Diagnostics = diagnostics.filter(d => d.range.start.line === 0);
      const line1Diagnostics = diagnostics.filter(d => d.range.start.line === 1);
      const line2Diagnostics = diagnostics.filter(d => d.range.start.line === 2);
      
      // Line 0 should have errors (severity 1)
      const line0Errors = line0Diagnostics.filter(d => d.severity === 1);
      assert(line0Errors.length > 0, 'Line 0 should have error-level diagnostics');
      
      // Line 1 should only have warnings (severity 2), no errors
      const line1Errors = line1Diagnostics.filter(d => d.severity === 1);
      const line1Warnings = line1Diagnostics.filter(d => d.severity === 2);
      assert.strictEqual(line1Errors.length, 0, 'Line 1 should have no error-level diagnostics');
      assert(line1Warnings.length > 0, 'Line 1 should have warning-level diagnostics');
      
      // Line 2 should have errors (severity 1)
      const line2Errors = line2Diagnostics.filter(d => d.severity === 1);
      assert(line2Errors.length > 0, 'Line 2 should have error-level diagnostics');
    });

    it('should convert warnings to information level on disabled lines', async function() {
      // This test targets unused variable warnings which are normally warning level
      const testContent = `let unusedVar = 42; // ucode-lsp disable`;
      const testFilePath = '/tmp/test-warning-to-info.uc';
      
      const diagnostics = await getDiagnostics(testContent, testFilePath);
      
      console.log(`\nWarning to information conversion test: ${diagnostics.length} diagnostics`);
      diagnostics.forEach((d, i) => {
        console.log(`  [${i}] Line ${d.range.start.line}: "${d.message}" (severity: ${d.severity}, source: ${d.source})`);
      });
      
      // Should have diagnostics converted to information level (severity 3)
      const errorDiagnostics = diagnostics.filter(d => d.severity === 1);
      const warningDiagnostics = diagnostics.filter(d => d.severity === 2);
      const infoDiagnostics = diagnostics.filter(d => d.severity === 3);
      
      assert.strictEqual(errorDiagnostics.length, 0, 'Should have no error-level diagnostics');
      
      // The "unused variable" diagnostic should be converted from warning (2) to info (3)
      const unusedVarDiagnostics = diagnostics.filter(d => d.message.includes('never used'));
      if (unusedVarDiagnostics.length > 0) {
        assert.strictEqual(unusedVarDiagnostics[0].severity, 3, 'Unused variable warning should be converted to information level');
      }
    });
  });

  describe('Unnecessary Disable Comment Warnings', function() {
    it('should warn about unnecessary disable comments', async function() {
      // Use a line that truly has no diagnostics (no unused variables)
      const testContent = `console.log("hello"); // ucode-lsp disable`;
      const testFilePath = '/tmp/test-unnecessary-disable.uc';
      
      const diagnostics = await getDiagnostics(testContent, testFilePath);
      
      console.log(`\nUnnecessary disable comment test: ${diagnostics.length} diagnostics`);
      diagnostics.forEach((d, i) => {
        console.log(`  [${i}] Line ${d.range.start.line}: "${d.message}" (severity: ${d.severity}, source: ${d.source})`);
      });
      
      // Should have a warning about the unnecessary disable comment
      const unnecessaryDisableWarnings = diagnostics.filter(d => 
        d.message.includes('No diagnostic disabled') && d.severity === 2
      );
      
      assert(unnecessaryDisableWarnings.length > 0, 'Should warn about unnecessary disable comment');
      
      // The warning should point to the disable comment itself
      const warning = unnecessaryDisableWarnings[0];
      const lineText = testContent.split('\n')[warning.range.start.line];
      const warningText = lineText.substring(warning.range.start.character, warning.range.end.character);
      assert(warningText.includes('// ucode-lsp disable'), 'Warning should point to the disable comment');
    });

    it('should not warn about necessary disable comments', async function() {
      const testContent = `let errorVar = undefinedFunction(); // ucode-lsp disable`;
      const testFilePath = '/tmp/test-necessary-disable.uc';
      
      const diagnostics = await getDiagnostics(testContent, testFilePath);
      
      console.log(`\nNecessary disable comment test: ${diagnostics.length} diagnostics`);
      diagnostics.forEach((d, i) => {
        console.log(`  [${i}] Line ${d.range.start.line}: "${d.message}" (severity: ${d.severity}, source: ${d.source})`);
      });
      
      // Should not have warnings about unnecessary disable comments
      const unnecessaryDisableWarnings = diagnostics.filter(d => 
        d.message.includes('No diagnostic disabled')
      );
      
      assert.strictEqual(unnecessaryDisableWarnings.length, 0, 'Should not warn about necessary disable comment');
      
      // Should have the original error converted to warning
      const warningDiagnostics = diagnostics.filter(d => d.severity === 2);
      assert(warningDiagnostics.length > 0, 'Should have warnings (converted from errors)');
    });

    it('should handle multiple disable comments correctly', async function() {
      const testContent = `let errorVar = undefinedFunction(); // ucode-lsp disable
console.log("no issues"); // ucode-lsp disable
let anotherError = anotherUndefinedFunction(); // ucode-lsp disable`;
      const testFilePath = '/tmp/test-multiple-disable.uc';
      
      const diagnostics = await getDiagnostics(testContent, testFilePath);
      
      console.log(`\nMultiple disable comments test: ${diagnostics.length} diagnostics`);
      diagnostics.forEach((d, i) => {
        console.log(`  [${i}] Line ${d.range.start.line}: "${d.message}" (severity: ${d.severity}, source: ${d.source})`);
      });
      
      // Line 0: should have warnings (converted from errors), no unnecessary disable warning
      const line0UnnecessaryWarnings = diagnostics.filter(d => 
        d.range.start.line === 0 && d.message.includes('No diagnostic disabled')
      );
      assert.strictEqual(line0UnnecessaryWarnings.length, 0, 'Line 0 should not have unnecessary disable warning');
      
      // Line 1: should have unnecessary disable warning (no diagnostics on clean line)
      const line1UnnecessaryWarnings = diagnostics.filter(d => 
        d.range.start.line === 1 && d.message.includes('No diagnostic disabled')
      );
      assert(line1UnnecessaryWarnings.length > 0, 'Line 1 should have unnecessary disable warning');
      
      // Line 2: should have warnings (converted from errors), no unnecessary disable warning
      const line2UnnecessaryWarnings = diagnostics.filter(d => 
        d.range.start.line === 2 && d.message.includes('No diagnostic disabled')
      );
      assert.strictEqual(line2UnnecessaryWarnings.length, 0, 'Line 2 should not have unnecessary disable warning');
    });
  });
});