/**
 * LSP integration tests for rest parameter support
 * Tests actual LSP server behavior with rest parameters
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Helper to create LSP server and test files
const { startLanguageServer, stopLanguageServer, sendRequest } = require('./lsp-test-helpers');

describe('Rest Parameters LSP Integration', () => {
  let serverProcess;
  
  beforeAll(async () => {
    serverProcess = await startLanguageServer();
  }, 15000);

  afterAll(async () => {
    if (serverProcess) {
      await stopLanguageServer(serverProcess);
    }
  });
  
  it('should not report undefined variable errors for rest parameters', async () => {
    const testFile = path.resolve(__dirname, 'temp-rest-params.uc');
    const testContent = `export default {
  debug: (fmt, ...args) => warn(sprintf(\`[D] \$\{fmt\}\\n\`, ...args)),
  warn:  (fmt, ...args) => warn(sprintf(\`[W] \$\{fmt\}\\n\`, ...args))
};`;
    
    try {
      // Write test file
      fs.writeFileSync(testFile, testContent);
      
      // Open document
      await sendRequest(serverProcess, 'textDocument/didOpen', {
        textDocument: {
          uri: `file://${testFile}`,
          languageId: 'ucode',
          version: 1,
          text: testContent
        }
      });
      
      // Small delay for analysis
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Request diagnostics
      const diagnostics = await sendRequest(serverProcess, 'textDocument/publishDiagnostics', null);
      
      // Filter for undefined variable errors related to 'args'
      const argsErrors = diagnostics.filter(diag => 
        diag.message.includes('Undefined variable: args') || 
        diag.code === 'UC1001' && diag.message.includes('args')
      );
      
      assert.strictEqual(argsErrors.length, 0, 
        `Should not have undefined variable errors for rest parameters. Found: ${argsErrors.map(e => e.message).join(', ')}`);
      
    } finally {
      // Clean up
      if (fs.existsSync(testFile)) {
        fs.unlinkSync(testFile);
      }
    }
  });
  
  it('should provide hover information for rest parameters', async () => {
    const testFile = path.resolve(__dirname, 'temp-rest-hover.uc');
    const testContent = `let func = (fmt, ...args) => {
  return args.length;
};`;
    
    try {
      fs.writeFileSync(testFile, testContent);
      
      await sendRequest(serverProcess, 'textDocument/didOpen', {
        textDocument: {
          uri: `file://${testFile}`,
          languageId: 'ucode',
          version: 1,
          text: testContent
        }
      });
      
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Request hover for 'args' in the function body
      const hoverResponse = await sendRequest(serverProcess, 'textDocument/hover', {
        textDocument: { uri: `file://\${testFile}` },
        position: { line: 1, character: 9 } // Position of 'args' in args.length
      });
      
      assert.ok(hoverResponse, 'Should have hover response');
      assert.ok(hoverResponse.contents, 'Should have hover contents');
      
      const hoverText = typeof hoverResponse.contents === 'string' 
        ? hoverResponse.contents 
        : hoverResponse.contents.value || hoverResponse.contents[0];
      
      // Should show parameter information, not undefined variable
      assert.ok(!hoverText.includes('undefined') && !hoverText.includes('not found'), 
        `Hover should not indicate undefined variable. Got: ${hoverText}`);
      
    } finally {
      if (fs.existsSync(testFile)) {
        fs.unlinkSync(testFile);
      }
    }
  });
  
  it('should provide completions for rest parameter properties', async () => {
    const testFile = path.resolve(__dirname, 'temp-rest-completion.uc');
    const testContent = `let func = (fmt, ...args) => {
  return args.
};`;
    
    try {
      fs.writeFileSync(testFile, testContent);
      
      await sendRequest(serverProcess, 'textDocument/didOpen', {
        textDocument: {
          uri: `file://${testFile}`,
          languageId: 'ucode',
          version: 1,
          text: testContent
        }
      });
      
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Request completions after 'args.'
      const completionResponse = await sendRequest(serverProcess, 'textDocument/completion', {
        textDocument: { uri: `file://\${testFile}` },
        position: { line: 1, character: 14 } // Position after 'args.'
      });
      
      assert.ok(completionResponse, 'Should have completion response');
      assert.ok(Array.isArray(completionResponse.items) || Array.isArray(completionResponse), 
        'Should have completion items');
      
      const items = Array.isArray(completionResponse.items) ? completionResponse.items : completionResponse;
      
      // Should have array methods like length, push, etc.
      const hasArrayMethods = items.some(item => 
        ['length', 'push', 'pop', 'slice'].includes(item.label)
      );
      
      assert.ok(hasArrayMethods, 
        `Should provide array method completions for rest parameters. Got: ${items.map(i => i.label).join(', ')}`);
      
    } finally {
      if (fs.existsSync(testFile)) {
        fs.unlinkSync(testFile);
      }
    }
  });
});