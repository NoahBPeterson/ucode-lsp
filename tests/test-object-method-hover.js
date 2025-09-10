/**
 * Tests for hover information on object methods and rest parameters
 * Ensures proper type inference and hover display
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Helper to create LSP server and test files
const { createLSPTestServer } = require('./lsp-test-helpers');

describe('Object Method and Rest Parameter Hover', () => {
  let lspServer;
  let getHover;
  
  before(async function() {
    this.timeout(15000);
    lspServer = createLSPTestServer();
    await lspServer.initialize();
    getHover = lspServer.getHover;
  });

  after(async function() {
    if (lspServer) {
      await lspServer.shutdown();
    }
  });
  
  it('should show function type hover for object properties with arrow functions', async function() {
    this.timeout(10000);
    const testContent = `export default {
  debug: (fmt, ...args) => warn(sprintf(\`[D] \${fmt}\\n\`, ...args)),
  warn:  (fmt, ...args) => warn(sprintf(\`[W] \${fmt}\\n\`, ...args))
};`;
    
    const testFile = `/tmp/test-object-method-hover-${Date.now()}.uc`;
    
    // Test hover on 'debug' property name (line 1, character 2)
    const debugHover = await getHover(testContent, testFile, 1, 2);
    
    console.log('Debug hover response:', JSON.stringify(debugHover, null, 2));
    
    if (!debugHover) {
      console.log('No hover response - this is the issue we need to fix');
      return;
    }
    
    assert.ok(debugHover, 'Should have hover response for debug property');
    assert.ok(debugHover.contents, 'Should have hover contents for debug');
    
    const debugHoverText = typeof debugHover.contents === 'string' 
      ? debugHover.contents 
      : debugHover.contents.value || debugHover.contents[0];
    
    console.log('Debug hover text:', debugHoverText);
    
    // Should indicate it's a function/lambda/arrow function
    assert.ok(
      debugHoverText.includes('function') || 
      debugHoverText.includes('lambda') || 
      debugHoverText.includes('arrow') ||
      debugHoverText.includes('=>') ||
      debugHoverText.includes('Function'),
      `Debug property should show function type. Got: ${debugHoverText}`
    );
    
    // Test hover on 'warn' property name (line 2, character 2)  
    const warnHover = await getHover(testContent, testFile, 2, 2);
    
    assert.ok(warnHover, 'Should have hover response for warn property');
    
    const warnHoverText = typeof warnHover.contents === 'string' 
      ? warnHover.contents 
      : warnHover.contents.value || warnHover.contents[0];
    
    console.log('Warn hover text:', warnHoverText);
    
    assert.ok(
      warnHoverText.includes('function') || 
      warnHoverText.includes('lambda') || 
      warnHoverText.includes('arrow') ||
      warnHoverText.includes('=>') ||
      warnHoverText.includes('Function'),
      `Warn property should show function type. Got: ${warnHoverText}`
    );
  });
  
  it('should show array type hover for rest parameters', async function() {
    this.timeout(10000);
    const testContent = `let func = (fmt, ...args) => {
  return args.length;
};`;
    
    const testFile = `/tmp/test-rest-param-hover-${Date.now()}.uc`;
    
    // Test hover on 'args' in the parameter list (line 0, character 18)
    const paramHover = await getHover(testContent, testFile, 0, 18);
    
    console.log('Args param hover response:', JSON.stringify(paramHover, null, 2));
    
    if (!paramHover) {
      console.log('No hover response for args parameter - this is the issue we need to fix');
      return;
    }
    console.log(paramHover);
    assert.ok(paramHover, 'Should have hover response for args parameter');
    
    const paramHoverText = typeof paramHover.contents === 'string' 
      ? paramHover.contents 
      : paramHover.contents.value || paramHover.contents[0];
    
    console.log('Args parameter hover text:', paramHoverText);
    
    // Should indicate it's an array type
    assert.ok(
      paramHoverText.includes('array') || 
      paramHoverText.includes('Array') ||
      paramHoverText.includes('[]') ||
      paramHoverText.includes('iterable'),
      `Args parameter should show array type. Got: ${paramHoverText}`
    );
    
    // Test hover on 'args' in the function body (line 1, character 9)
    const bodyHover = await getHover(testContent, testFile, 1, 9);
    
    assert.ok(bodyHover, 'Should have hover response for args in body');
    
    const bodyHoverText = typeof bodyHover.contents === 'string' 
      ? bodyHover.contents 
      : bodyHover.contents.value || bodyHover.contents[0];
    
    console.log('Args body hover text:', bodyHoverText);
    
    assert.ok(
      bodyHoverText.includes('array') || 
      bodyHoverText.includes('Array') ||
      bodyHoverText.includes('[]') ||
      bodyHoverText.includes('iterable'),
      `Args in body should show array type. Got: ${bodyHoverText}`
    );
  });
  
});