import { spawn } from 'node:child_process';
import assert from 'node:assert';

describe('Conversion Functions Validation Tests', function() {
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
        clientInfo: { name: 'conversion-test-client', version: '1.0.0' },
        capabilities: {
          textDocument: {
            publishDiagnostics: {
              relatedInformation: false,
              versionSupport: false,
              codeDescriptionSupport: false,
              dataSupport: false
            }
          }
        },
        rootUri: 'file://' + process.cwd(),
        workspaceFolders: null
      }
    };

    serverProcess.stdin.write(createLSPMessage(initialize));
    
    // Wait for initialize response
    setTimeout(() => {
      serverProcess.stdin.write(createLSPMessage({
        jsonrpc: '2.0',
        method: 'initialized',
        params: {}
      }));
      done();
    }, 1000);
  });

  // Stop server process
  after(function() {
    if (serverProcess) {
      serverProcess.kill();
    }
  });

  // Helper function to get diagnostics
  async function getDiagnostics(code, filename = 'conversion-test.uc') {
    return new Promise((resolve, reject) => {
      const uri = `file://${process.cwd()}/${filename}`;
      const timeoutId = setTimeout(() => {
        pendingRequests.delete(uri);
        resolve([]);
      }, 5000);

      pendingRequests.set(uri, { resolve, timeout: timeoutId });

      const didOpen = {
        jsonrpc: '2.0',
        method: 'textDocument/didOpen',
        params: {
          textDocument: {
            uri: uri,
            languageId: 'ucode',
            version: 1,
            text: code
          }
        }
      };

      serverProcess.stdin.write(createLSPMessage(didOpen));
    });
  }

  describe('int() function validation', () => {
    it('should accept string parameter', async () => {
      const diagnostics = await getDiagnostics(`
        print(int("123"));
      `);
      const errors = diagnostics.filter(d => d.severity === 1);
      assert.strictEqual(errors.length, 0, 'Should not have errors for valid string parameter');
    });

    it('should accept number parameter', async () => {
      const diagnostics = await getDiagnostics(`
        print(int(123.45));
      `);
      const errors = diagnostics.filter(d => d.severity === 1);
      assert.strictEqual(errors.length, 0, 'Should not have errors for valid number parameter');
    });

    it('should reject array parameter', async () => {
      const diagnostics = await getDiagnostics(`
        print(int([1, 2, 3]));
      `);
      const errors = diagnostics.filter(d => d.severity === 1);
      assert.strictEqual(errors.length, 1, 'Should have error for array parameter');
      assert.match(errors[0].message, /int\(\) expects string or number, got array/);
    });

    it('should reject object parameter', async () => {
      const diagnostics = await getDiagnostics(`
        print(int({value: 123}));
      `);
      const errors = diagnostics.filter(d => d.severity === 1);
      assert.strictEqual(errors.length, 1, 'Should have error for object parameter');
      assert.match(errors[0].message, /int\(\) expects string or number, got object/);
    });

    it('should require at least one parameter', async () => {
      const diagnostics = await getDiagnostics(`
        print(int());
      `);
      const errors = diagnostics.filter(d => d.severity === 1);
      assert.strictEqual(errors.length, 1, 'Should have error for no parameters');
      assert.match(errors[0].message, /int\(\) expects 1 argument, got 0/);
    });

    it('should reject multiple parameters', async () => {
      const diagnostics = await getDiagnostics(`
        print(int("123", "456"));
      `);
      const errors = diagnostics.filter(d => d.severity === 1);
      assert.strictEqual(errors.length, 1, 'Should have error for too many parameters');
      assert.match(errors[0].message, /int\(\) expects 1 argument, got 2/);
    });
  });

  describe('hex() function validation', () => {
    it('should reject number parameter', async () => {
      const diagnostics = await getDiagnostics(`
        print(hex(255));
      `);
      const errors = diagnostics.filter(d => d.severity === 1);
      assert.strictEqual(errors.length, 1, 'Should have error for invalid number parameter');
        assert.match(errors[0].message, /hex\(\) expects string, got integer/);
    });

    it('should accept string parameter', async () => {
      const diagnostics = await getDiagnostics(`
        print(hex("255"));
      `);
      const errors = diagnostics.filter(d => d.severity === 1);
      assert.strictEqual(errors.length, 0, 'Should not have error for string parameter');
    });

    it('should require one parameter', async () => {
      const diagnostics = await getDiagnostics(`
        print(hex());
      `);
      const errors = diagnostics.filter(d => d.severity === 1);
      assert.strictEqual(errors.length, 1, 'Should have error for no parameters');
      assert.match(errors[0].message, /hex\(\) expects 1 argument, got 0/);
    });
  });

  describe('chr() and ord() function validation', () => {
    it('chr should accept number parameter', async () => {
      const diagnostics = await getDiagnostics(`
        print(chr(65));
      `);
      const errors = diagnostics.filter(d => d.severity === 1);
      assert.strictEqual(errors.length, 0, 'Should not have errors for valid number parameter');
    });

    it('chr should accept string parameter', async () => {
      const diagnostics = await getDiagnostics(`
        print(chr("65"));
      `);
      const errors = diagnostics.filter(d => d.severity === 1);
      assert.strictEqual(errors.length, 0, 'Should not have error for string parameter (chr accepts both)');
    });

    it('ord should accept string parameter', async () => {
      const diagnostics = await getDiagnostics(`
        print(ord("A"));
      `);
      const errors = diagnostics.filter(d => d.severity === 1);
      assert.strictEqual(errors.length, 0, 'Should not have errors for valid string parameter');
    });

    it('ord should reject number parameter', async () => {
      const diagnostics = await getDiagnostics(`
        print(ord(65));
      `);
      const errors = diagnostics.filter(d => d.severity === 1);
      assert.strictEqual(errors.length, 1, 'Should have error for number parameter');
      assert.match(errors[0].message, /ord\(\) expects string, got integer/);
    });
  });

  describe('uchr() function validation', () => {
    it('should accept number parameter', async () => {
      const diagnostics = await getDiagnostics(`
        print(uchr(8364));
      `);
      const errors = diagnostics.filter(d => d.severity === 1);
      assert.strictEqual(errors.length, 0, 'Should not have errors for valid number parameter');
    });

    it('should reject string parameter', async () => {
      const diagnostics = await getDiagnostics(`
        print(uchr("8364"));
      `);
      const errors = diagnostics.filter(d => d.severity === 1);
      assert.strictEqual(errors.length, 0, 'Should not have error for string parameter');
    });
  });

  describe('Combined conversion functions', () => {
    it('should validate nested conversion functions', async () => {
      const diagnostics = await getDiagnostics(`
        print(chr(ord("A") + 1));
      `);
      const errors = diagnostics.filter(d => d.severity === 1);
      assert.strictEqual(errors.length, 0, 'Should not have errors for valid nested functions');
    });

    it('should catch errors in nested conversion functions', async () => {
      const diagnostics = await getDiagnostics(`
        print(chr(ord(65)));
      `);
      const errors = diagnostics.filter(d => d.severity === 1);
      assert.strictEqual(errors.length, 1, 'Should have error for invalid nested function');
      assert.match(errors[0].message, /ord\(\) expects string, got integer/);
    });
  });
});