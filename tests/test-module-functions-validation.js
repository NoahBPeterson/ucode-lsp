import { spawn } from 'node:child_process';
import assert from 'node:assert';

describe('Module Functions Validation Tests', function() {
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
        clientInfo: { name: 'module-test-client', version: '1.0.0' },
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
  async function getDiagnostics(code, filename = 'module-test.uc') {
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

  describe('require() function validation', () => {
    it('should accept string parameter', async () => {
      const diagnostics = await getDiagnostics(`
        let module = require("fs");
        print(module);
      `);
      const errors = diagnostics.filter(d => d.severity === 1);
      assert.strictEqual(errors.length, 0, 'Should not have errors for valid string parameter');
    });

    it('should reject number parameter', async () => {
      const diagnostics = await getDiagnostics(`
        print(require(123));
      `);
      const errors = diagnostics.filter(d => d.severity === 1);
      assert.strictEqual(errors.length, 1, 'Should have error for number parameter');
      assert.match(errors[0].message, /require\(\) expects string, got (integer|number)/);
    });

    it('should reject array parameter', async () => {
      const diagnostics = await getDiagnostics(`
        print(require(["fs"]));
      `);
      const errors = diagnostics.filter(d => d.severity === 1);
      assert.strictEqual(errors.length, 1, 'Should have error for array parameter');
      assert.match(errors[0].message, /require\(\) expects string, got array/);
    });

    it('should require exactly one parameter', async () => {
      const diagnostics = await getDiagnostics(`
        print(require());
      `);
      const errors = diagnostics.filter(d => d.severity === 1);
      assert.strictEqual(errors.length, 1, 'Should have error for no parameters');
      assert.match(errors[0].message, /require\(\) expects 1 argument, got 0/);
    });

    it('should reject multiple parameters', async () => {
      const diagnostics = await getDiagnostics(`
        print(require("fs", "extra"));
      `);
      const errors = diagnostics.filter(d => d.severity === 1);
      assert.strictEqual(errors.length, 1, 'Should have error for multiple parameters');
      assert.match(errors[0].message, /require\(\) expects 1 argument, got 2/);
    });
  });

  describe('include() function validation', () => {
    it('should accept string parameter', async () => {
      const diagnostics = await getDiagnostics(`
        print(include("/path/to/file.uc"));
      `);
      const errors = diagnostics.filter(d => d.severity === 1);
      assert.strictEqual(errors.length, 0, 'Should not have errors for valid string parameter');
    });

    it('should reject number parameter', async () => {
      const diagnostics = await getDiagnostics(`
        print(include(42));
      `);
      const errors = diagnostics.filter(d => d.severity === 1);
      assert.strictEqual(errors.length, 1, 'Should have error for number parameter');
      assert.match(errors[0].message, /include\(\) expects string, got (integer|number)/);
    });

    it('should require exactly one parameter', async () => {
      const diagnostics = await getDiagnostics(`
        print(include());
      `);
      const errors = diagnostics.filter(d => d.severity === 1);
      assert.strictEqual(errors.length, 1, 'Should have error for no parameters');
      assert.match(errors[0].message, /include\(\) expects 1 argument, got 0/);
    });
  });

  describe('loadfile() function validation', () => {
    it('should accept string parameter', async () => {
      const diagnostics = await getDiagnostics(`
        let func = loadfile("/path/to/script.uc");
        print(func);
      `);
      const errors = diagnostics.filter(d => d.severity === 1);
      assert.strictEqual(errors.length, 0, 'Should not have errors for valid string parameter');
    });

    it('should reject object parameter', async () => {
      const diagnostics = await getDiagnostics(`
        print(loadfile({path: "/path/to/script.uc"}));
      `);
      const errors = diagnostics.filter(d => d.severity === 1);
      assert.strictEqual(errors.length, 1, 'Should have error for object parameter');
      assert.match(errors[0].message, /loadfile\(\) expects string, got object/);
    });

    it('should require exactly one parameter', async () => {
      const diagnostics = await getDiagnostics(`
        print(loadfile());
      `);
      const errors = diagnostics.filter(d => d.severity === 1);
      assert.strictEqual(errors.length, 1, 'Should have error for no parameters');
      assert.match(errors[0].message, /loadfile\(\) expects 1 argument, got 0/);
    });
  });

  describe('loadstring() function validation', () => {
    it('should accept string parameter', async () => {
      const diagnostics = await getDiagnostics(`
        let func = loadstring("print('Hello World');");
        print(func);
      `);
      const errors = diagnostics.filter(d => d.severity === 1);
      assert.strictEqual(errors.length, 0, 'Should not have errors for valid string parameter');
    });

    it('should reject boolean parameter', async () => {
      const diagnostics = await getDiagnostics(`
        print(loadstring(true));
      `);
      const errors = diagnostics.filter(d => d.severity === 1);
      assert.strictEqual(errors.length, 1, 'Should have error for boolean parameter');
      assert.match(errors[0].message, /loadstring\(\) expects string, got boolean/);
    });

    it('should require exactly one parameter', async () => {
      const diagnostics = await getDiagnostics(`
        print(loadstring());
      `);
      const errors = diagnostics.filter(d => d.severity === 1);
      assert.strictEqual(errors.length, 1, 'Should have error for no parameters');
      assert.match(errors[0].message, /loadstring\(\) expects 1 argument, got 0/);
    });
  });

  describe('sourcepath() function validation', () => {
    it('should accept no parameters', async () => {
      const diagnostics = await getDiagnostics(`
        let path = sourcepath();
        print(path);
      `);
      const errors = diagnostics.filter(d => d.severity === 1);
      assert.strictEqual(errors.length, 0, 'Should not have errors for no parameters');
    });

    it('should accept number depth parameter', async () => {
      const diagnostics = await getDiagnostics(`
        print(sourcepath(1));
      `);
      const errors = diagnostics.filter(d => d.severity === 1);
      assert.strictEqual(errors.length, 0, 'Should not have error for valid number depth parameter');
    });

    it('should accept convertible number depth parameter', async () => {
      const diagnostics = await getDiagnostics(`
        print(sourcepath('1'));
      `);
      const errors = diagnostics.filter(d => d.severity === 1);
      assert.strictEqual(errors.length, 0, 'Should not have error for valid number depth parameter');
    });

    it('should accept number depth and boolean dironly parameters', async () => {
      const diagnostics = await getDiagnostics(`
        print(sourcepath(2, true));
      `);
      const errors = diagnostics.filter(d => d.severity === 1);
      assert.strictEqual(errors.length, 0, 'Should not have error for valid parameters');
    });

    it('should reject string depth parameter', async () => {
      const diagnostics = await getDiagnostics(`
        print(sourcepath("invalid"));
      `);
      const errors = diagnostics.filter(d => d.severity === 1);
      assert.strictEqual(errors.length, 1, 'Should have error for invalid depth parameter type');
      assert.match(errors[0].message, /String "invalid" cannot be converted to a number for sourcepath\(\) argument 1/);
    });

    it('should accept various types for dironly parameter', async () => {
      const validDironlyCases = [
        'true', 'false', '1', '0', '"true"', '""', 'null', '{}', '[]'
      ];

      for (const val of validDironlyCases) {
        const diagnostics = await getDiagnostics(`print(sourcepath(1, ${val}));`);
        const errors = diagnostics.filter(d => d.severity === 1);
        assert.strictEqual(errors.length, 0, `Should not have error for dironly value: ${val}`);
      }
    });

    
  });

  describe('Combined module functions', () => {
    it('should validate multiple module functions in one script', async () => {
      const diagnostics = await getDiagnostics(`
        let fs = require("fs");
        let path = sourcepath();
        let code = "print('test');";
        let func = loadstring(code);
        print(fs, path, func);
      `);
      const errors = diagnostics.filter(d => d.severity === 1);
      assert.strictEqual(errors.length, 0, 'Should not have errors for valid usage');
    });

    it.only('should catch errors in invalid module functions', async () => {
      const diagnostics = await getDiagnostics(`
        let fs = require(123);
        let func = loadstring(true);
        let path = sourcepath("invalid");
      `);
      const errors = diagnostics.filter(d => d.severity === 1);
      assert.strictEqual(errors.length, 3, 'Should have errors for require(), loadstring(), and sourcepath()');
    });

    it('should validate nested module function calls', async () => {
      const diagnostics = await getDiagnostics(`
        let func = loadstring("print(sourcepath());");
        print(func);
      `);
      const errors = diagnostics.filter(d => d.severity === 1);
      assert.strictEqual(errors.length, 0, 'Should not have errors for valid nested calls');
    });
  });
});