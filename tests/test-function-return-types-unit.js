/**
 * Tests for function return type handling
 * Ensures functions have type 'function' while calls return actual return types
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Helper to create LSP server and test files
const { createLSPTestServer } = require('./lsp-test-helpers');

describe('Function Return Type Handling', () => {
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
  
  it('should show function type for function identifiers', async function() {
    this.timeout(10000);
    const testContent = `function getString() {
    return "hello";
}

function getStringOrNull() {
    if (true) {
        return "hello";
    } else {
        return null;
    }
}

let funcRef = getString;`;
    
    const testFile = `/tmp/test-function-types-${Date.now()}.uc`;
    
    // Find exact positions using indexOf
    const lines = testContent.split('\n');
    const getStringLine = lines.findIndex(line => line.includes('function getString'));
    const funcRefLine = lines.findIndex(line => line.includes('let funcRef'));
    const getStringChar = lines[getStringLine].indexOf('getString');
    const funcRefChar = lines[funcRefLine].indexOf('getString');
    
    console.log(`Testing getString declaration at line ${getStringLine}, char ${getStringChar}`);
    console.log(`Testing funcRef at line ${funcRefLine}, char ${funcRefChar}`);
    
    // Test hover on function name declaration
    const functionHover = await getHover(testContent, testFile, getStringLine, getStringChar);
    
    console.log('Function declaration hover:', JSON.stringify(functionHover, null, 2));
    
    assert.ok(functionHover, 'Should have hover response for function declaration');
    assert.ok(functionHover.contents, 'Should have hover contents for function');
    
    const functionHoverText = typeof functionHover.contents === 'string' 
      ? functionHover.contents 
      : functionHover.contents.value || functionHover.contents[0];
    
    console.log('Function hover text:', functionHoverText);
    
    // Function should show as type 'function'
    assert.ok(
      functionHoverText.includes('function') || 
      functionHoverText.includes('Function'),
      `Function should show function type. Got: ${functionHoverText}`
    );
    
    // Test hover on function reference
    const refHover = await getHover(testContent, testFile, funcRefLine, funcRefChar);
    
    assert.ok(refHover, 'Should have hover response for function reference');
    
    const refHoverText = typeof refHover.contents === 'string' 
      ? refHover.contents 
      : refHover.contents.value || refHover.contents[0];
    
    console.log('Function reference hover text:', refHoverText);
    
    assert.ok(
      refHoverText.includes('function') || 
      refHoverText.includes('Function'),
      `Function reference should show function type. Got: ${refHoverText}`
    );
  });
  
  it('should show return type for function calls', async function() {
    this.timeout(10000);
    const testContent = `function getString() {
    return "hello";
}

function getNumber() {
    return 42;
}

let result1 = getString();
let result2 = getNumber();`;
    
    const testFile = `/tmp/test-function-calls-${Date.now()}.uc`;
    
    // Find exact positions using indexOf  
    const lines = testContent.split('\n');
    const result1Line = lines.findIndex(line => line.includes('let result1'));
    const result2Line = lines.findIndex(line => line.includes('let result2'));
    const result1Char = lines[result1Line].indexOf('result1');
    const result2Char = lines[result2Line].indexOf('result2');
    
    console.log(`Testing result1 at line ${result1Line}, char ${result1Char}`);
    console.log(`Testing result2 at line ${result2Line}, char ${result2Char}`);
    
    // Test hover on result1 variable (should show string type)
    const stringCallHover = await getHover(testContent, testFile, result1Line, result1Char);
    
    console.log('String function call result hover:', JSON.stringify(stringCallHover, null, 2));
    
    if (stringCallHover && stringCallHover.contents) {
      const stringCallHoverText = typeof stringCallHover.contents === 'string' 
        ? stringCallHover.contents 
        : stringCallHover.contents.value || stringCallHover.contents[0];
      
      console.log('String call result hover text:', stringCallHoverText);
      
      // Result should show string type, not function type
      assert.ok(
        stringCallHoverText.includes('string') && !stringCallHoverText.includes('function'),
        `Function call result should show return type (string), not function. Got: ${stringCallHoverText}`
      );
    }
    
    // Test hover on result2 variable (should show integer type)
    const numberCallHover = await getHover(testContent, testFile, result2Line, result2Char);
    
    if (numberCallHover && numberCallHover.contents) {
      const numberCallHoverText = typeof numberCallHover.contents === 'string' 
        ? numberCallHover.contents 
        : numberCallHover.contents.value || numberCallHover.contents[0];
      
      console.log('Number call result hover text:', numberCallHoverText);
      
      // Result should show integer type, not function type
      assert.ok(
        (numberCallHoverText.includes('integer') || numberCallHoverText.includes('number')) 
        && !numberCallHoverText.includes('function'),
        `Function call result should show return type (integer), not function. Got: ${numberCallHoverText}`
      );
    }
  });
  
  it('should handle union return types correctly', async function() {
    this.timeout(10000);
    const testContent = `function getStringOrNull() {
    if (true) {
        return "hello";
    } else {
        return null;
    }
}

let result = getStringOrNull();`;
    
    const testFile = `/tmp/test-union-return-${Date.now()}.uc`;
    
    // Test hover on union function declaration (line 0, character 9)
    const functionHover = await getHover(testContent, testFile, 0, 9);
    
    console.log('Union function hover:', JSON.stringify(functionHover, null, 2));
    
    assert.ok(functionHover, 'Should have hover response for union function');
    
    const functionHoverText = typeof functionHover.contents === 'string' 
      ? functionHover.contents 
      : functionHover.contents.value || functionHover.contents[0];
    
    console.log('Union function hover text:', functionHoverText);
    
    // Function should show as type 'function' with return type info
    assert.ok(
      functionHoverText.includes('function') || 
      functionHoverText.includes('Function'),
      `Union function should show function type. Got: ${functionHoverText}`
    );
    
    // Test hover on union function call result (line 8, character 4)
    const resultHover = await getHover(testContent, testFile, 8, 4);
    
    if (resultHover && resultHover.contents) {
      const resultHoverText = typeof resultHover.contents === 'string' 
        ? resultHover.contents 
        : resultHover.contents.value || resultHover.contents[0];
      
      console.log('Union call result hover text:', resultHoverText);
      
      // Result should show appropriate type (could be unknown for union compatibility)
      // This validates that we're not incorrectly showing 'function' type
      assert.ok(
        !resultHoverText.includes('function') || resultHoverText.includes('Function'),
        `Union function call result should not show function type. Got: ${resultHoverText}`
      );
    }
  });

  it('should show union types like "string | null" instead of "unknown"', async function() {
    this.timeout(10000);
    const testContent = `function test(cond) {
    if (cond) {
        return null;
    }
    return "lol";
}

let a = test(false);`;
    
    const testFile = `/tmp/test-union-display-${Date.now()}.uc`;
    
    // Find exact positions using indexOf
    const lines = testContent.split('\n');
    const testFuncLine = lines.findIndex(line => line.includes('function test'));
    const aVarLine = lines.findIndex(line => line.includes('let a'));
    const testFuncChar = lines[testFuncLine].indexOf('test');
    const aVarChar = lines[aVarLine].indexOf('a');
    
    console.log(`Testing function declaration at line ${testFuncLine}, char ${testFuncChar}`);
    console.log(`Testing variable a at line ${aVarLine}, char ${aVarChar}`);
    
    // Test hover on function declaration - should show function type
    const functionHover = await getHover(testContent, testFile, testFuncLine, testFuncChar);
    
    if (functionHover && functionHover.contents) {
      const functionHoverText = typeof functionHover.contents === 'string' 
        ? functionHover.contents 
        : functionHover.contents.value || functionHover.contents[0];
      
      console.log('Function declaration hover text:', functionHoverText);
      
      assert.ok(
        functionHoverText.includes('function') || functionHoverText.includes('Function'),
        `Function should show function type. Got: ${functionHoverText}`
      );
    }
    
    // Test hover on variable a - should show union type "string | null" not "unknown"
    const variableHover = await getHover(testContent, testFile, aVarLine, aVarChar);
    
    assert.ok(variableHover, 'Should have hover response for variable a');
    assert.ok(variableHover.contents, 'Should have hover contents for variable a');
    
    const variableHoverText = typeof variableHover.contents === 'string' 
      ? variableHover.contents 
      : variableHover.contents.value || variableHover.contents[0];
    
    console.log('Variable a hover text:', variableHoverText);
    
    // Variable should show union type (either "string | null" or "null | string"), not "unknown"
    assert.ok(
      variableHoverText.includes('string | null') || 
      variableHoverText.includes('string|null') || 
      variableHoverText.includes('null | string') || 
      variableHoverText.includes('null|string'),
      `Variable should show union type with both "string" and "null", not "unknown". Got: ${variableHoverText}`
    );
  });
  
  it('should show enhanced function hover with return type info', async function() {
    this.timeout(10000);
    const testContent = `function test(cond) {
    if (cond) {
        return null;
    }
    return "lol";
}

let a = test(false);
match(test(false), /lol/);`;
    
    const testFile = `/tmp/test-enhanced-hover-${Date.now()}.uc`;
    
    // Find exact positions using indexOf
    const lines = testContent.split('\n');
    const testFuncLine = lines.findIndex(line => line.includes('function test'));
    const aVarLine = lines.findIndex(line => line.includes('let a'));
    const matchCallLine = lines.findIndex(line => line.includes('match(test'));
    
    const testFuncChar = lines[testFuncLine].indexOf('test');
    const aVarChar = lines[aVarLine].indexOf('a');
    const matchTestChar = lines[matchCallLine].indexOf('test(');
    
    console.log(`Testing function declaration at line ${testFuncLine}, char ${testFuncChar}`);
    console.log(`Testing variable a at line ${aVarLine}, char ${aVarChar}`);
    console.log(`Testing function call in match at line ${matchCallLine}, char ${matchTestChar}`);
    
    // Test function declaration hover - should show function type with return type info
    const funcHover = await getHover(testContent, testFile, testFuncLine, testFuncChar);
    
    assert.ok(funcHover, 'Should have hover response for function declaration');
    assert.ok(funcHover.contents, 'Should have hover contents for function');
    
    const funcHoverText = typeof funcHover.contents === 'string' 
      ? funcHover.contents 
      : funcHover.contents.value || funcHover.contents[0];
    
    console.log('Function declaration hover text:', funcHoverText);
    
    // Function should show as type 'function' with return type info
    assert.ok(
      funcHoverText.includes('function') && funcHoverText.includes('Returns:'),
      `Function should show function type with return type info. Got: ${funcHoverText}`
    );
    assert.ok(
      funcHoverText.includes('null | string') || funcHoverText.includes('string | null'),
      `Function should show return type as union. Got: ${funcHoverText}`
    );
    
    // Test variable hover - should show union type
    const varHover = await getHover(testContent, testFile, aVarLine, aVarChar);
    
    assert.ok(varHover, 'Should have hover response for variable a');
    assert.ok(varHover.contents, 'Should have hover contents for variable a');
    
    const varHoverText = typeof varHover.contents === 'string' 
      ? varHover.contents 
      : varHover.contents.value || varHover.contents[0];
    
    console.log('Variable a hover text:', varHoverText);
    
    // Variable should show union type
    assert.ok(
      varHoverText.includes('null | string') || varHoverText.includes('string | null'),
      `Variable should show union type. Got: ${varHoverText}`
    );
    
    // Test function call in argument hover - should show return type
    const callHover = await getHover(testContent, testFile, matchCallLine, matchTestChar);
    
    assert.ok(callHover, 'Should have hover response for function call');
    assert.ok(callHover.contents, 'Should have hover contents for function call');
    
    const callHoverText = typeof callHover.contents === 'string' 
      ? callHover.contents 
      : callHover.contents.value || callHover.contents[0];
    
    console.log('Function call hover text:', callHoverText);
    
    // Function call should show return type, not function type
    assert.ok(
      callHoverText.includes('function call') && (callHoverText.includes('null | string') || callHoverText.includes('string | null')),
      `Function call should show return type info. Got: ${callHoverText}`
    );
  });

  it('should distinguish function calls from function identifiers', async function() {
    this.timeout(10000);
    const testContent = `function test() {
    return "hello";
}

let funcIdentifier = test;    // Should be type 'function'
let callResult = test();      // Should be type 'string'`;
    
    const testFile = `/tmp/test-call-vs-identifier-${Date.now()}.uc`;
    
    // Find exact positions using indexOf
    const lines = testContent.split('\n');
    const funcIdentifierLine = lines.findIndex(line => line.includes('let funcIdentifier'));
    const callResultLine = lines.findIndex(line => line.includes('let callResult'));
    const testRefChar = lines[funcIdentifierLine].indexOf('test');
    const callResultChar = lines[callResultLine].indexOf('callResult');
    
    console.log(`Testing function identifier at line ${funcIdentifierLine}, char ${testRefChar}`);
    console.log(`Testing call result at line ${callResultLine}, char ${callResultChar}`);
    
    // Test hover on function identifier (test reference)
    const identifierHover = await getHover(testContent, testFile, funcIdentifierLine, testRefChar);
    
    if (identifierHover && identifierHover.contents) {
      const identifierHoverText = typeof identifierHover.contents === 'string' 
        ? identifierHover.contents 
        : identifierHover.contents.value || identifierHover.contents[0];
      
      console.log('Function identifier hover text:', identifierHoverText);
      
      assert.ok(
        identifierHoverText.includes('function') || identifierHoverText.includes('Function'),
        `Function identifier should show function type. Got: ${identifierHoverText}`
      );
    }
    
    // Test hover on callResult variable
    const callHover = await getHover(testContent, testFile, callResultLine, callResultChar);
    
    if (callHover && callHover.contents) {
      const callHoverText = typeof callHover.contents === 'string' 
        ? callHover.contents 
        : callHover.contents.value || callHover.contents[0];
      
      console.log('Function call result hover text:', callHoverText);
      
      // Call result should show return type (string), not function type
      assert.ok(
        callHoverText.includes('string') && !callHoverText.includes('function'),
        `Function call result should show return type, not function. Got: ${callHoverText}`
      );
    }
  });
  
});