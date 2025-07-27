// Test suite for UCI module import validation
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

describe('UCI Module Import Validation Tests', function() {
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

  describe('Valid UCI Module Imports', function() {
    it('should accept valid uci function imports', async function() {
      const testContent = `
import { cursor, error } from 'uci';
      `;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-valid-uci.uc');
      
      // Should not have any import errors
      const importErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes('not exported by the uci module')
      );
      assert.strictEqual(importErrors.length, 0, 'Should not report errors for valid uci imports');
    });

    it('should accept individual valid imports', async function() {
      const testContent = `
import { cursor } from 'uci';
      `;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-cursor-import.uc');
      
      const importErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes('not exported by the uci module')
      );
      assert.strictEqual(importErrors.length, 0, 'Should accept cursor import');
    });

    it('should accept error function import', async function() {
      const testContent = `
import { error } from 'uci';
      `;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-error-import.uc');
      
      const importErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes('not exported by the uci module')
      );
      assert.strictEqual(importErrors.length, 0, 'Should accept error import');
    });
  });

  describe('Invalid UCI Module Imports', function() {
    it('should reject invalid uci function imports', async function() {
      const testContent = `
import { cursor, invalidFunction } from 'uci';
      `;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-invalid-uci.uc');
      
      // Should have exactly one import error for invalidFunction
      const importErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes('invalidFunction') &&
        d.message.includes('not exported by the uci module')
      );
      assert.strictEqual(importErrors.length, 1, 'Should report error for invalid uci import');
    });

    it('should provide helpful error message with available exports', async function() {
      const testContent = `
import { nonExistentFunction } from 'uci';
      `;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-helpful-error.uc');
      
      const importErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes('nonExistentFunction') &&
        d.message.includes('not exported by the uci module')
      );
      assert.strictEqual(importErrors.length, 1, 'Should report error for nonExistentFunction');
      
      const errorMessage = importErrors[0].message;
      assert(errorMessage.includes('Available exports:'), 'Error message should include available exports');
      assert(errorMessage.includes('cursor'), 'Error message should list cursor as available export');
      assert(errorMessage.includes('error'), 'Error message should list error as available export');
    });

    it('should handle case sensitivity in imports', async function() {
      const testContent = `
import { Cursor, ERROR } from 'uci';
      `;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-case-sensitivity.uc');
      
      const importErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes('not exported by the uci module')
      );
      
      // Both Cursor and ERROR should be invalid (case sensitive)
      assert.strictEqual(importErrors.length, 2, 'Should report errors for case-sensitive mismatches');
    });

    it('should handle multiple invalid imports', async function() {
      const testContent = `
import { invalid1, cursor, invalid2, error, invalid3 } from 'uci';
      `;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-multiple-invalid.uc');
      
      const importErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes('not exported by the uci module')
      );
      
      // Should report 3 errors for invalid1, invalid2, invalid3
      assert.strictEqual(importErrors.length, 3, 'Should report errors for all invalid imports');
    });
  });

  describe('Mixed Import Scenarios', function() {
    it('should handle mixed valid and invalid imports correctly', async function() {
      const testContent = `
import { cursor, badFunction, error } from 'uci';
      `;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-mixed-imports.uc');
      
      const importErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes('not exported by the uci module')
      );
      
      // Only badFunction should error
      assert.strictEqual(importErrors.length, 1, 'Should report error only for invalid import');
      assert(importErrors[0].message.includes('badFunction'), 'Error should be for badFunction');
    });

    it('should not interfere with other module imports', async function() {
      const testContent = `
import { cursor } from 'uci';
import { someFunction } from 'other-module';
      `;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-other-modules.uc');
      
      const uciImportErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes('not exported by the uci module')
      );
      
      // Should not have UCI import errors
      assert.strictEqual(uciImportErrors.length, 0, 'Should not interfere with other module imports');
    });
  });

  describe('Namespace Imports', function() {
    it('should accept namespace imports for uci module', async function() {
      const testContent = `
import * as uci from 'uci';
      `;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-namespace-import.uc');
      
      const importErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes('not exported by the uci module')
      );
      
      // Namespace imports should not trigger validation errors
      assert.strictEqual(importErrors.length, 0, 'Should accept namespace imports');
    });

    it('should accept default imports for uci module', async function() {
      const testContent = `
import uci from 'uci';
      `;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-default-import.uc');
      
      const importErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes('not exported by the uci module')
      );
      
      // Default imports should not trigger validation errors
      assert.strictEqual(importErrors.length, 0, 'Should accept default imports');
    });
  });

  describe('Edge Cases', function() {
    it('should handle empty import lists', async function() {
      const testContent = `
import { } from 'uci';
      `;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-empty-imports.uc');
      
      const importErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes('not exported by the uci module')
      );
      
      // Empty imports should not cause errors
      assert.strictEqual(importErrors.length, 0, 'Should handle empty import lists');
    });

    it('should handle aliased imports correctly', async function() {
      const testContent = `
import { cursor as uciCursor, error as uciError } from 'uci';
      `;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-aliased-imports.uc');
      
      const importErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes('not exported by the uci module')
      );
      
      // Aliased valid imports should not cause errors
      assert.strictEqual(importErrors.length, 0, 'Should handle aliased imports correctly');
    });

    it('should validate original names in aliased imports', async function() {
      const testContent = `
import { invalidName as myAlias } from 'uci';
      `;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-invalid-aliased.uc');
      
      const importErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes('not exported by the uci module')
      );
      
      // Should validate original name (invalidName), not alias
      assert.strictEqual(importErrors.length, 1, 'Should validate original names in aliased imports');
      assert(importErrors[0].message.includes('invalidName'), 'Error should mention original name');
    });
  });
});