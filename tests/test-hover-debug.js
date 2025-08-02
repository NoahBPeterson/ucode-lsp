// Test to actually debug the hover functionality for delete methods
const { spawn } = require('child_process');
const path = require('path');

console.log('🔍 Testing actual hover functionality for delete() methods...\n');

// Start the language server
const serverPath = path.join(__dirname, '../dist/server.js');

// Test content matching the user's reported issue
const testContent = `import * as uloop from 'uloop';

let handle = uloop.handle(3, () => {}, uloop.ULOOP_READ);
let process = uloop.process("/bin/sleep", ["1"], {}, (exitCode) => {});
let signal = uloop.signal("SIGUSR1", () => {});

handle.delete();
process.delete(); 
signal.delete();`;

console.log('📝 Test content:');
console.log(testContent);
console.log();

let server;
let requestId = 1;
let serverOutput = '';

function startServer() {
  return new Promise((resolve, reject) => {
    console.log('🚀 Starting language server...');
    
    server = spawn('node', [serverPath, '--stdio'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    server.stdout.on('data', (data) => {
      serverOutput += data.toString();
      console.log('📤 Server output:', data.toString().trim());
    });

    server.stderr.on('data', (data) => {
      console.log('❌ Server error:', data.toString().trim());
    });

    server.on('error', (error) => {
      console.log('💥 Server spawn error:', error);
      reject(error);
    });

    // Give server time to start
    setTimeout(resolve, 1000);
  });
}

function sendRequest(request) {
  return new Promise((resolve, reject) => {
    const requestStr = JSON.stringify(request) + '\r\n';
    console.log('📨 Sending request:', JSON.stringify(request, null, 2));
    
    server.stdin.write(`Content-Length: ${Buffer.byteLength(requestStr)}\r\n\r\n${requestStr}`);
    
    // Set up response handler
    const timeout = setTimeout(() => {
      reject(new Error('Timeout waiting for response'));
    }, 5000);
    
    const originalHandler = server.stdout.on('data', (data) => {
      const response = data.toString();
      console.log('📥 Raw response:', response);
      
      // Try to parse JSON response
      const lines = response.split('\n');
      for (const line of lines) {
        if (line.trim() && line.includes('{')) {
          try {
            const json = JSON.parse(line.trim());
            if (json.id === request.id) {
              clearTimeout(timeout);
              server.stdout.removeListener('data', originalHandler);
              resolve(json);
              return;
            }
          } catch (e) {
            // Not JSON or not our response
          }
        }
      }
    });
  });
}

async function testHover() {
  try {
    await startServer();
    
    // Initialize the server
    console.log('\n📋 Step 1: Initialize server...');
    const initResponse = await sendRequest({
      jsonrpc: '2.0',
      id: requestId++,
      method: 'initialize',
      params: {
        processId: process.pid,
        rootUri: `file://${__dirname}`,
        capabilities: {}
      }
    });
    console.log('✅ Initialize response:', initResponse.result ? 'Success' : 'Failed');

    // Open document
    console.log('\n📋 Step 2: Open document...');
    await sendRequest({
      jsonrpc: '2.0',
      method: 'textDocument/didOpen',
      params: {
        textDocument: {
          uri: 'file:///tmp/test-hover.uc',
          languageId: 'ucode',
          version: 1,
          text: testContent
        }
      }
    });
    console.log('✅ Document opened');

    // Test hover on handle.delete() - position on "delete"
    console.log('\n📋 Step 3: Test hover on handle.delete()...');
    
    // Find position of "delete" in "handle.delete();"
    const lines = testContent.split('\n');
    let targetLine = -1;
    let targetChar = -1;
    
    for (let i = 0; i < lines.length; i++) {
      const deleteIndex = lines[i].indexOf('handle.delete()');
      if (deleteIndex !== -1) {
        targetLine = i;
        targetChar = deleteIndex + 'handle.'.length + 2; // Position in middle of "delete"
        break;
      }
    }
    
    console.log(`🎯 Testing hover at line ${targetLine}, character ${targetChar}`);
    console.log(`📍 Line content: "${lines[targetLine]}"`);
    
    const hoverResponse = await sendRequest({
      jsonrpc: '2.0',
      id: requestId++,
      method: 'textDocument/hover',
      params: {
        textDocument: {
          uri: 'file:///tmp/test-hover.uc'
        },
        position: {
          line: targetLine,
          character: targetChar
        }
      }
    });
    
    console.log('\n📋 Step 4: Analyze hover response...');
    console.log('🔍 Full hover response:', JSON.stringify(hoverResponse, null, 2));
    
    if (hoverResponse.result) {
      console.log('✅ Hover returned result!');
      if (hoverResponse.result.contents) {
        console.log('📄 Hover contents:');
        console.log(hoverResponse.result.contents.value || hoverResponse.result.contents);
      }
    } else {
      console.log('❌ Hover returned null - this is the problem!');
    }
    
  } catch (error) {
    console.log('💥 Test failed:', error.message);
  } finally {
    if (server) {
      server.kill();
    }
  }
}

testHover();