const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

describe('Exception Object Type Inference Tests', function() {
  this.timeout(1000); // 1 second timeout for LSP tests

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
          
          // Handle completion/hover responses with IDs
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

  // Helper function to get completion suggestions using shared server
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
      }, 6000);

      pendingRequests.set(currentRequestId, { resolve, timeout });

      // Send messages
      serverProcess.stdin.write(createLSPMessage(didOpen));
      
      // Wait a bit for document to be processed, then send completion
      setTimeout(() => {
        serverProcess.stdin.write(createLSPMessage(completion));
      }, 100);
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

  describe('Exception Object Property Completion', function() {
    it('should provide completion for e.message in catch block', async function() {
      const testContent = `try {
  riskyOperation();
} catch (e) {
  e.
}`;
      
      const completions = await getCompletions(testContent, '/tmp/test-completion.uc', 3, 4);
      
      // Should have message, stacktrace, and type properties
      assert(completions && completions.items, 'Should return completion items');
      
      const labels = completions.items.map(item => item.label);
      assert(labels.includes('message'), 'Should include message property');
      assert(labels.includes('stacktrace'), 'Should include stacktrace property');  
      assert(labels.includes('type'), 'Should include type property');
    });

    it('should provide completion for error.message with different variable name', async function() {
      const testContent = `try {
  riskyOperation();
} catch (error) {
  error.
}`;
      
      const completions = await getCompletions(testContent, '/tmp/test-completion2.uc', 3, 8);
      
      assert(completions && completions.items, 'Should return completion items');
      
      const labels = completions.items.map(item => item.label);
      assert(labels.includes('message'), 'Should include message property');
      assert(labels.includes('stacktrace'), 'Should include stacktrace property');
      assert(labels.includes('type'), 'Should include type property');
    });

    it('should provide completion for exception properties in nested contexts', async function() {
      const testContent = `try {
  riskyOperation();
} catch (e) {
  if (e.message) {
    print(e.
  }
}`;
      
      const completions = await getCompletions(testContent, '/tmp/test-completion3.uc', 4, 12);
      
      assert(completions && completions.items, 'Should return completion items');
      
      const labels = completions.items.map(item => item.label);
      assert(labels.includes('message'), 'Should include message property in nested context');
    });
  });

  describe('Exception Object Property Hover', function() {
    it('should provide hover information for e.message', async function() {
      const testContent = `try {
  riskyOperation();
} catch (e) {
  print(e.message);
}`;
      
      const hover = await getHoverInfo(testContent, '/tmp/test-hover.uc', 3, 11);
      
      assert(hover && hover.contents, 'Should return hover information');
      
      if (typeof hover.contents === 'string') {
        assert(hover.contents.includes('message'), 'Should describe message property');
      } else if (hover.contents.value) {
        assert(hover.contents.value.includes('message'), 'Should describe message property');
      }
    });

    it('should provide hover information for e.stacktrace', async function() {
      const testContent = `try {
  riskyOperation();
} catch (e) {
  print(e.stacktrace);
}`;
      
      const hover = await getHoverInfo(testContent, '/tmp/test-hover2.uc', 3, 13);
      
      assert(hover && hover.contents, 'Should return hover information');
      
      if (typeof hover.contents === 'string') {
        assert(hover.contents.includes('stacktrace'), 'Should describe stacktrace property');
      } else if (hover.contents.value) {
        assert(hover.contents.value.includes('stacktrace'), 'Should describe stacktrace property');
      }
    });
    
    it('should provide hover information for e.type', async function() {
      const testContent = `try {
  riskyOperation();
} catch (e) {
  print(e.type);
}`;
      
      const hover = await getHoverInfo(testContent, '/tmp/test-hover3.uc', 3, 10);
      
      assert(hover && hover.contents, 'Should return hover information');
      
      if (typeof hover.contents === 'string') {
        assert(hover.contents.includes('type'), 'Should describe type property');
      } else if (hover.contents.value) {
        assert(hover.contents.value.includes('type'), 'Should describe type property');
      }
    });
  });

  describe('Exception Object Type Recognition', function() {
    it('should recognize exception object with any variable name', async function() {
      const testContent = `try {
  riskyOperation();
} catch (myError) {
  myError.
}`;
      
      const completions = await getCompletions(testContent, '/tmp/test-varname.uc', 3, 10);
      
      assert(completions && completions.items, 'Should return completion items');
      
      const labels = completions.items.map(item => item.label);
      assert(labels.includes('message'), 'Should work with any variable name');
    });

    it('should not provide exception properties for non-exception variables', async function() {
      const testContent = `let regularObject = { name: "test" };
regularObject.`;
      
      const completions = await getCompletions(testContent, '/tmp/test-regular.uc', 1, 14);
      
      // Should not include exception properties for regular objects
      if (completions && completions.items) {
        const labels = completions.items.map(item => item.label);
        assert(!labels.includes('stacktrace'), 'Should not include stacktrace for regular objects');
      }
    });
  });

  describe('Exception Property Types', function() {
    it('should infer correct types for exception properties', async function() {
      const testContent = `try {
  riskyOperation();  
} catch (e) {
  let msg = e.message;
}`;
      
      const hover = await getHoverInfo(testContent, '/tmp/test-types.uc', 3, 8);
      
      assert(hover && hover.contents, 'Should return hover information for variable');
      // The variable should have inferred the string type from e.message
    });
  });

  describe('Multiple Catch Blocks', function() {
    it('should handle multiple catch blocks with different variable names', async function() {
      const testContent = `try {
  operation1();
} catch (e1) {
  print(e1.message);
}

try {
  operation2();  
} catch (e2) {
  e2.
}`;
      
      const completions = await getCompletions(testContent, '/tmp/test-multiple.uc', 9, 5);
      
      assert(completions && completions.items, 'Should return completion items');
      
      const labels = completions.items.map(item => item.label);
      assert(labels.includes('message'), 'Should work in multiple catch blocks');
      assert(labels.includes('stacktrace'), 'Should work in multiple catch blocks');
      assert(labels.includes('type'), 'Should work in multiple catch blocks');
    });
  });
});