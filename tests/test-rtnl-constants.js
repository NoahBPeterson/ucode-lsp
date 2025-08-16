const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

describe('RTNL Constants Integration Tests', function() {
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
          
          // Handle completion responses
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
        capabilities: {
          textDocument: {
            completion: {
              completionItem: {
                snippetSupport: true
              }
            }
          }
        }
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

  // Helper function to get completions
  function getCompletions(testContent, testFilePath, line, character) {
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

      const completion = {
        jsonrpc: '2.0',
        id: currentRequestId,
        method: 'textDocument/completion',
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
          reject(new Error('Timeout waiting for completion response'));
        }
      }, 8000);

      pendingRequests.set(currentRequestId, { resolve, timeout });

      // Send messages
      serverProcess.stdin.write(createLSPMessage(didOpen));
      
      // Wait a bit for document to be processed, then send completion
      setTimeout(() => {
        serverProcess.stdin.write(createLSPMessage(completion));
      }, 200);
    });
  }

  describe('RTNL Constants Import and Usage', function() {
    it('should allow "const" import from rtnl module', async function() {
      const testContent = `import { 'const' as rtnlconst } from 'rtnl';`;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-rtnl-const-import.uc');
      
      // Should not show import errors
      const importErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("is not exported by the rtnl module")
      );
      assert.strictEqual(importErrors.length, 0, 'Should allow "const" import from rtnl module');
    });

    it('should provide member expression completions for rtnl constants', async function() {
      const testContent = `import { 'const' as rtnlconst } from 'rtnl';
let value = rtnlconst.`;
      
      // Get completions at the end of "rtnlconst."
      const completions = await getCompletions(testContent, '/tmp/test-rtnl-member.uc', 1, 23);
      
      // Should have rtnl constants available
      const constantCompletions = completions.items || completions || [];
      const rtnConstants = constantCompletions.filter(item => 
        item.label && (
          item.label.startsWith('RT_TABLE_') ||
          item.label.startsWith('RTN_') ||
          item.label.startsWith('RTM_') ||
          item.label.startsWith('NLM_F_')
        )
      );
      
      assert(rtnConstants.length > 0, `Should provide rtnl constant completions, got: ${constantCompletions.map(c => c.label).join(', ')}`);
      
      // Should have specific constants
      const labels = constantCompletions.map(c => c.label);
      assert(labels.includes('RT_TABLE_MAIN'), 'Should include RT_TABLE_MAIN constant');
      assert(labels.includes('RTN_UNICAST'), 'Should include RTN_UNICAST constant');
      assert(labels.includes('RTM_GETROUTE'), 'Should include RTM_GETROUTE constant');
    });

    it('should not leak constants to global scope', async function() {
      const testContent = `import { 'const' as rtnlconst } from 'rtnl';
let R`;
      
      // Get completions after "let R" - should not show RTN_* constants
      const completions = await getCompletions(testContent, '/tmp/test-rtnl-noleak.uc', 1, 5);
      
      const constantCompletions = completions.items || completions || [];
      const globalRtnConstants = constantCompletions.filter(item => 
        item.label && (
          item.label.startsWith('RTN_') ||
          item.label.startsWith('RT_TABLE_') ||
          item.label.startsWith('RTM_')
        )
      );
      
      assert.strictEqual(globalRtnConstants.length, 0, 
        `RTNL constants should not leak to global scope, found: ${globalRtnConstants.map(c => c.label).join(', ')}`);
    });

    it('should allow access to specific rtnl constants via member expression', async function() {
      const testContent = `import { 'const' as rtnlconst } from 'rtnl';
let tableMain = rtnlconst.RT_TABLE_MAIN;
let routeUnicast = rtnlconst.RTN_UNICAST;
let getRoute = rtnlconst.RTM_GETROUTE;`;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-rtnl-access.uc');
      
      // Should not show any undefined property errors
      const propertyErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("Property") && 
        d.message.includes("does not exist")
      );
      assert.strictEqual(propertyErrors.length, 0, 
        `Should allow access to rtnl constants, but got errors: ${propertyErrors.map(e => e.message).join(', ')}`);
    });

    it('should show error for invalid rtnl constant access', async function() {
      const testContent = `import { 'const' as rtnlconst } from 'rtnl';
let invalid = rtnlconst.INVALID_CONSTANT;`;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-rtnl-invalid.uc');
      
      // Should show property does not exist error
      const propertyErrors = diagnostics.filter(d => 
        d.severity === 1 && 
        d.message.includes("Property 'INVALID_CONSTANT' does not exist")
      );
      assert(propertyErrors.length > 0, 'Should show error for invalid constant access');
    });
  });

  describe('NL80211 Constants Comparison', function() {
    it('should work the same way as nl80211 constants', async function() {
      const testContent = `import { 'const' as nl80211const } from 'nl80211';
import { 'const' as rtnlconst } from 'rtnl';
let nlCmd = nl80211const.NL80211_CMD_GET_INTERFACE;
let rtRoute = rtnlconst.RTN_UNICAST;`;
      
      const diagnostics = await getDiagnostics(testContent, '/tmp/test-both-constants.uc');
      
      // Both should work without errors
      const errors = diagnostics.filter(d => d.severity === 1);
      assert.strictEqual(errors.length, 0, 
        `Both nl80211 and rtnl constants should work, but got errors: ${errors.map(e => e.message).join(', ')}`);
    });

    it('should provide completions for both nl80211 and rtnl constants separately', async function() {
      const testContent = `import { 'const' as nl80211const } from 'nl80211';
import { 'const' as rtnlconst } from 'rtnl';
let nl = nl80211const.`;
      
      const nlCompletions = await getCompletions(testContent, '/tmp/test-nl-completions.uc', 2, 23);
      const nlItems = nlCompletions.items || nlCompletions || [];
      
      // Should have nl80211 constants but not rtnl constants
      const nlConstants = nlItems.filter(item => 
        item.label && item.label.startsWith('NL80211_')
      );
      const rtnlConstants = nlItems.filter(item => 
        item.label && (item.label.startsWith('RTN_') || item.label.startsWith('RTM_'))
      );
      
      assert(nlConstants.length > 0, 'Should provide nl80211 constants');
      assert.strictEqual(rtnlConstants.length, 0, 'Should not mix in rtnl constants');
    });
  });
});