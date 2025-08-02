// Test specifically for delete method hover functionality
// This test is based on the working uloop module test structure

const { spawn } = require('child_process');
const path = require('path');
const assert = require('assert');

let server;
let requestId = 1;
const pendingRequests = new Map();

function startLanguageServer() {
  const serverPath = path.join(__dirname, '../dist/server.js');
  
  server = spawn('node', [serverPath, '--stdio'], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  server.stdout.on('data', (data) => {
    const content = data.toString();
    console.log('📤 Server stdout:', content.trim());
    
    const lines = content.split('\n');
    
    for (const line of lines) {
      if (line.trim() && line.startsWith('{')) {
        try {
          const message = JSON.parse(line.trim());
          if (message.id && pendingRequests.has(message.id)) {
            const { resolve, timeout } = pendingRequests.get(message.id);
            clearTimeout(timeout);
            pendingRequests.delete(message.id);
            resolve(message.result);
          }
        } catch (e) {
          // Not a JSON message
        }
      }
    }
  });

  server.stderr.on('data', (data) => {
    const message = data.toString();
    if (message.includes('HOVER_DEBUG') || message.includes('SERVER_DEBUG')) {
      console.log('🐛 Debug:', message.trim());
    } else {
      console.log('📥 Server stderr:', message.trim());
    }
  });

  return new Promise((resolve) => {
    setTimeout(resolve, 2000); // Give server more time to start
  });
}

function sendRequest(method, params, hasId = true) {
  return new Promise((resolve, reject) => {
    const id = hasId ? requestId++ : undefined;
    const request = {
      jsonrpc: '2.0',
      method,
      params,
      ...(id && { id })
    };

    const requestStr = JSON.stringify(request) + '\n';
    const message = `Content-Length: ${Buffer.byteLength(requestStr)}\r\n\r\n${requestStr}`;

    if (hasId) {
      const timeout = setTimeout(() => {
        if (pendingRequests.has(id)) {
          pendingRequests.delete(id);
          reject(new Error(`Timeout waiting for ${method} response`));
        }
      }, 5000);

      pendingRequests.set(id, { resolve, timeout });
    } else {
      resolve(); // For notifications
    }

    server.stdin.write(message);
  });
}

async function testDeleteMethodHover() {
  console.log('🧪 Testing delete method hover functionality...\n');

  try {
    await startLanguageServer();

    // Initialize
    await sendRequest('initialize', {
      processId: process.pid,
      rootUri: null,
      capabilities: {}
    });

    // Test content with uloop objects and delete calls
    const testContent = `import * as uloop from 'uloop';

let handle = uloop.handle(3, () => {}, uloop.ULOOP_READ);
let process = uloop.process("/bin/sleep", ["1"], {}, (exitCode) => {});
let signal = uloop.signal("SIGUSR1", () => {});

handle.delete();
process.delete();
signal.delete();`;

    // Open document
    await sendRequest('textDocument/didOpen', {
      textDocument: {
        uri: 'file:///tmp/test-delete-hover.uc',
        languageId: 'ucode',
        version: 1,
        text: testContent
      }
    }, false);

    console.log('📄 Test document opened');

    // Test hover on handle.delete() 
    console.log('\n🔍 Testing hover on handle.delete()...');
    
    // Find the line with handle.delete()
    const lines = testContent.split('\n');
    let handleDeleteLine = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('handle.delete()')) {
        handleDeleteLine = i;
        break;
      }
    }

    const handleDeleteChar = lines[handleDeleteLine].indexOf('delete') + 2; // Middle of "delete"
    
    console.log(`📍 Testing at line ${handleDeleteLine}, character ${handleDeleteChar}`);
    console.log(`📝 Line content: "${lines[handleDeleteLine]}"`);

    const hoverResult = await sendRequest('textDocument/hover', {
      textDocument: { uri: 'file:///tmp/test-delete-hover.uc' },
      position: { line: handleDeleteLine, character: handleDeleteChar }
    });

    console.log('\n📋 Hover result for handle.delete():');
    if (hoverResult && hoverResult.contents) {
      console.log('✅ Hover successful!');
      console.log('📄 Hover content:');
      console.log(hoverResult.contents.value || JSON.stringify(hoverResult.contents, null, 2));
      
      const content = hoverResult.contents.value || JSON.stringify(hoverResult.contents);
      const hasDeleteMethod = content.includes('delete');
      const hasDescription = content.includes('Unregisters') || content.includes('unregisters');
      
      console.log('\n✅ Content analysis:');
      console.log('  - Mentions delete method:', hasDeleteMethod ? '✅ Yes' : '❌ No');
      console.log('  - Has proper description:', hasDescription ? '✅ Yes' : '❌ No');
      
      if (hasDeleteMethod && hasDescription) {
        console.log('\n🎉 SUCCESS: handle.delete() hover is working correctly!');
      } else {
        console.log('\n⚠️  WARNING: Hover content may not be complete');
      }
    } else {
      console.log('❌ No hover result returned');
      console.log('🔍 Full result:', JSON.stringify(hoverResult, null, 2));
    }

    // Test other delete methods
    for (const objType of ['process', 'signal']) {
      console.log(`\n🔍 Testing hover on ${objType}.delete()...`);
      
      let deleteLine = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(`${objType}.delete()`)) {
          deleteLine = i;
          break;
        }
      }

      const deleteChar = lines[deleteLine].indexOf('delete') + 2;
      
      const result = await sendRequest('textDocument/hover', {
        textDocument: { uri: 'file:///tmp/test-delete-hover.uc' },
        position: { line: deleteLine, character: deleteChar }
      });

      if (result && result.contents) {
        console.log(`✅ ${objType}.delete() hover working!`);
        const content = result.contents.value || JSON.stringify(result.contents);
        if (content.includes('delete') && (content.includes('Unregisters') || content.includes('Uninstalls'))) {
          console.log(`🎉 ${objType}.delete() hover has correct content!`);
        }
      } else {
        console.log(`❌ ${objType}.delete() hover failed`);
      }
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    if (server) {
      server.kill();
    }
  }
}

testDeleteMethodHover();