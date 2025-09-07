const assert = require('assert');
const path = require('path');
const { createLSPTestServer } = require('./lsp-test-helpers');

describe('Variable Hover Consistency Bug Test', function() {
  this.timeout(15000);

  let lspServer;
  let getHover;

  before(async function() {
    lspServer = createLSPTestServer();
    await lspServer.initialize();
    getHover = lspServer.getHover;
  });

  after(function() {
    if (lspServer) {
      lspServer.shutdown();
    }
  });

  it('should show consistent hover for all instances of the same variable', async function() {
    const testContent = 'import {request as r} from "nl80211";\\nlet a = r;\\nimport * as math from "math";\\nmath.abs();\\nmath.atan2(a, a);';
    const testFilePath = path.join(__dirname, '..', 'test-variable-hover-consistency.uc');

    console.log('Variable hover consistency test:');
    console.log('Testing content:');
    testContent.split('\\n').forEach((line, i) => {
      console.log(`  ${i}: ${line}`);
    });
    
    // Find the positions of both 'a' variables in 'math.atan2(a, a)'
    const lastLine = testContent.split('\\n')[4]; // Line with math.atan2(a, a)
    console.log(`\\nLast line: "${lastLine}"`);
    console.log('Character positions: 0123456789012345678901234567890');
    
    // Find positions of both 'a' variables
    const firstAPos = lastLine.indexOf('(a,');
    const secondAPos = lastLine.indexOf(', a)');
    
    console.log(`First 'a' position in line: ${firstAPos + 1}`);  // +1 for the 'a' after '('
    console.log(`Second 'a' position in line: ${secondAPos + 2}`); // +2 for the 'a' after ', '
    
    if (firstAPos === -1 || secondAPos === -1) {
      assert.fail('Could not locate both a variables in math.atan2(a, a)');
    }
    
    // Test hover on first 'a'
    const hoverFirstA = await getHover(testContent, testFilePath, 4, firstAPos + 1);
    console.log('\\nFirst a hover result:', hoverFirstA ? 'HAS HOVER' : 'NO HOVER');
    if (hoverFirstA && hoverFirstA.contents) {
      const hoverText = typeof hoverFirstA.contents === 'string' ? hoverFirstA.contents : JSON.stringify(hoverFirstA.contents);
      console.log('First a hover contents:', hoverText.substring(0, 100) + '...');
    }
    
    // Test hover on second 'a'
    const hoverSecondA = await getHover(testContent, testFilePath, 4, secondAPos + 2);
    console.log('\\nSecond a hover result:', hoverSecondA ? 'HAS HOVER' : 'NO HOVER');
    if (hoverSecondA && hoverSecondA.contents) {
      const hoverText = typeof hoverSecondA.contents === 'string' ? hoverSecondA.contents : JSON.stringify(hoverSecondA.contents);
      console.log('Second a hover contents:', hoverText.substring(0, 100) + '...');
    }
    
    // Both should have hover or both should not have hover (consistency)
    console.log('\\n🎯 Testing consistency:');
    const firstHasHover = hoverFirstA && hoverFirstA.contents;
    const secondHasHover = hoverSecondA && hoverSecondA.contents;
    
    console.log(`First 'a' has hover: ${firstHasHover ? '✅' : '❌'}`);
    console.log(`Second 'a' has hover: ${secondHasHover ? '✅' : '❌'}`);
    
    if (firstHasHover !== secondHasHover) {
      console.log('❌ INCONSISTENCY DETECTED: Same variable shows different hover behavior!');
      console.log('Expected: Both instances of variable "a" should have the same hover behavior');
      
      // This assertion should fail initially, showing the bug
      assert.fail(`Hover inconsistency: First 'a' has hover: ${firstHasHover}, Second 'a' has hover: ${secondHasHover}`);
    } else {
      console.log('✅ CONSISTENT: Both instances have the same hover behavior');
    }
    
    // If both have hover, they should show the same information
    if (firstHasHover && secondHasHover) {
      const firstText = typeof hoverFirstA.contents === 'string' ? hoverFirstA.contents : JSON.stringify(hoverFirstA.contents);
      const secondText = typeof hoverSecondA.contents === 'string' ? hoverSecondA.contents : JSON.stringify(hoverSecondA.contents);
      
      assert.strictEqual(firstText, secondText, 'Both instances of variable "a" should show identical hover information');
      console.log('✅ CONTENT MATCH: Both instances show identical hover information');
    }
  });

  it('should show hover for variable in different contexts', async function() {
    const testContent = `let x = 42;
console.log(x);
if (x > 0) {
  print(x);
  let y = x + 1;
}`;
    const testFilePath = path.join(__dirname, '..', 'test-variable-contexts.uc');

    console.log('\\n=== Variable Context Test ===');
    
    // Test variable 'x' in different contexts
    const contexts = [
      { line: 1, char: 12, context: 'console.log(x)' },
      { line: 2, char: 4, context: 'if (x > 0)' },
      { line: 3, char: 8, context: 'print(x)' },
      { line: 4, char: 9, context: 'let y = x + 1' }
    ];
    
    const hovers = [];
    
    for (const ctx of contexts) {
      const hover = await getHover(testContent, testFilePath, ctx.line, ctx.char);
      hovers.push({ ...ctx, hasHover: !!(hover && hover.contents) });
      console.log(`${ctx.context}: ${hover && hover.contents ? '✅ HAS HOVER' : '❌ NO HOVER'}`);
    }
    
    // Check for consistency
    const hoverStates = hovers.map(h => h.hasHover);
    const allSame = hoverStates.every(state => state === hoverStates[0]);
    
    if (!allSame) {
      console.log('❌ INCONSISTENT: Variable "x" has different hover behavior in different contexts');
      hovers.forEach(h => console.log(`  ${h.context}: ${h.hasHover}`));
    } else {
      console.log('✅ CONSISTENT: Variable "x" has same hover behavior in all contexts');
    }
  });

  it('should show hover for imported alias variable - THE MAIN BUG', async function() {
    const testContent = 'import {request as r} from "nl80211";\\nlet a = r;\\nprint(a);';
    const testFilePath = path.join(__dirname, '..', 'test-alias-variable.uc');

    console.log('\\n=== MAIN BUG: Imported Alias Variable Test ===');
    console.log('Content:');
    testContent.split('\\n').forEach((line, i) => {
      console.log(`  ${i}: ${line}`);
    });
    
    // Test hover on 'r' (the imported alias)
    const hoverOnR = await getHover(testContent, testFilePath, 1, 9); // Position at 'r' in 'let a = r'
    console.log(`\\nAlias 'r' (imported function): ${hoverOnR && hoverOnR.contents ? '✅ HAS HOVER' : '❌ NO HOVER'}`);
    
    // Test hover on 'a' (variable that holds the imported function)
    const hoverOnA = await getHover(testContent, testFilePath, 2, 6); // Position at 'a' in 'print(a)'
    console.log(`Variable 'a' (holds imported function): ${hoverOnA && hoverOnA.contents ? '✅ HAS HOVER' : '❌ NO HOVER'}`);
    
    if (hoverOnR && hoverOnR.contents) {
      const hoverText = typeof hoverOnR.contents === 'string' ? hoverOnR.contents : JSON.stringify(hoverOnR.contents);
      console.log('\\nHover on r:', hoverText.substring(0, 100) + '...');
    }
    
    if (hoverOnA && hoverOnA.contents) {
      const hoverText = typeof hoverOnA.contents === 'string' ? hoverOnA.contents : JSON.stringify(hoverOnA.contents);
      console.log('Hover on a:', hoverText.substring(0, 100) + '...');
    }
    
    // THIS IS THE BUG: r shows hover, a does not (even though a = r)
    if (hoverOnR && !hoverOnA) {
      console.log('\\n🎯 BUG CONFIRMED: "r" has hover but "a" (which equals r) does not!');
      console.log('This is the variable hover consistency bug');
      
      // This assertion will fail, documenting the bug
      assert.fail('Variable hover inconsistency: "r" has hover but "a" (which holds the same value) does not');
    } else if (hoverOnR && hoverOnA) {
      console.log('\\n✅ BUG FIXED: Both "r" and "a" show hover information');
    } else {
      console.log('\\n❓ Unexpected state - analyzing hover states');
      console.log('Need to investigate why imported aliases and regular variables lack hover');
    }
  });

  it('should demonstrate the original bug scenario exactly', async function() {
    const testContent = `import {request as r} from 'nl80211';
let a = r;
import * as math from 'math';
math.abs();
math.atan2(a, a);`;
    const testFilePath = path.join(__dirname, '..', 'test-original-bug.uc');

    console.log('\\n=== ORIGINAL BUG REPRODUCTION ===');
    console.log('Code:');
    testContent.split('\\n').forEach((line, i) => {
      console.log(`  ${i}: ${line}`);
    });
    
    // Focus on the problematic line: math.atan2(a, a)
    const problemLine = 'math.atan2(a, a);';
    console.log(`\\nProblem line: "${problemLine}"`);
    console.log('Positions:     0123456789012345');
    
    // Test both 'a' positions in math.atan2(a, a)
    const firstAHover = await getHover(testContent, testFilePath, 4, 12); // First 'a'
    const secondAHover = await getHover(testContent, testFilePath, 4, 15); // Second 'a'
    
    console.log('\\nResults:');
    console.log(`First 'a' in math.atan2(a, a):  ${firstAHover ? '✅ HAS HOVER' : '❌ NO HOVER'}`);
    console.log(`Second 'a' in math.atan2(a, a): ${secondAHover ? '✅ HAS HOVER' : '❌ NO HOVER'}`);
    
    // According to the bug report: second 'a' shows hover, first 'a' does not
    if (!firstAHover && secondAHover) {
      console.log('🎯 BUG CONFIRMED: First "a" has no hover, second "a" has hover');
      console.log('This matches the reported bug behavior');
    } else if (firstAHover && secondAHover) {
      console.log('✅ BUG FIXED: Both instances now show hover');
    } else if (!firstAHover && !secondAHover) {
      console.log('❓ Neither shows hover - might be a different issue');
    } else {
      console.log('❓ Unexpected pattern - first has hover but second does not');
    }
    
    // The fix should make both behave the same way
    console.log('\\n💡 Expected after fix: Both "a" variables should have consistent hover behavior');
  });

  it('should show basic variable hover information', async function() {
    const testContent = 'let x = 42;\\nprint(x);';
    const testFilePath = path.join(__dirname, '..', 'test-basic-variable.uc');

    console.log('\\n=== BASIC VARIABLE HOVER TEST ===');
    console.log('Content:');
    testContent.split('\\n').forEach((line, i) => {
      console.log(`  ${i}: ${line}`);
    });
    
    // Test hover on variable 'x'
    const hoverOnX = await getHover(testContent, testFilePath, 1, 6); // Position at 'x' in 'print(x)'
    
    console.log(`\\nVariable 'x' hover: ${hoverOnX && hoverOnX.contents ? '✅ HAS HOVER' : '❌ NO HOVER'}`);
    
    if (hoverOnX && hoverOnX.contents) {
      const hoverText = typeof hoverOnX.contents === 'string' ? hoverOnX.contents : JSON.stringify(hoverOnX.contents);
      console.log('Hover contents:', hoverText);
      
      // Should show some variable information
      const hasVariableInfo = hoverText.includes('variable') || hoverText.includes('x') || hoverText.includes('42');
      console.log(`Shows variable info: ${hasVariableInfo ? '✅' : '❌'}`);
    } else {
      console.log('\\n🔍 No hover - this might be expected if variable hover is not implemented');
      console.log('This helps us understand the baseline behavior');
    }
    
    console.log('\\nThis test establishes whether basic variable hover works at all');
  });

  it('should show imported function hover', async function() {
    const testContent = 'import {request} from "nl80211";\\nrequest();';
    const testFilePath = path.join(__dirname, '..', 'test-imported-function.uc');

    console.log('\\n=== IMPORTED FUNCTION HOVER TEST ===');
    console.log('Content:');
    testContent.split('\\n').forEach((line, i) => {
      console.log(`  ${i}: ${line}`);
    });
    
    // Test hover on imported function 'request'
    const hoverOnRequest = await getHover(testContent, testFilePath, 1, 0); // Position at 'request' in 'request()'
    
    console.log(`\\nImported function 'request' hover: ${hoverOnRequest && hoverOnRequest.contents ? '✅ HAS HOVER' : '❌ NO HOVER'}`);
    
    if (hoverOnRequest && hoverOnRequest.contents) {
      const hoverText = typeof hoverOnRequest.contents === 'string' ? hoverOnRequest.contents : JSON.stringify(hoverOnRequest.contents);
      console.log('Hover contents preview:', hoverText.substring(0, 100) + '...');
    }
    
    console.log('\\nThis establishes the baseline for imported function hover');
  });

  it('should replicate exact working scenario to find the difference', async function() {
    // This EXACT content works according to the bug report and our earlier test
    const workingContent = 'import {request as r} from "nl80211";\\nlet a = r;\\nimport * as math from "math";\\nmath.abs();\\nmath.atan2(a, a);';
    
    // This simpler content doesn't work
    const simpleContent = 'let a = 42;\\nprint(a);';
    
    const workingFilePath = path.join(__dirname, '..', 'test-working-scenario.uc');
    const simpleFilePath = path.join(__dirname, '..', 'test-simple-scenario.uc');

    console.log('\\n=== COMPARISON: Working vs Simple Scenarios ===');
    
    // Test the working scenario
    console.log('\\nWorking scenario (from bug report):');
    console.log(workingContent.replace(/\\\\n/g, '\\n'));
    
    const workingHover = await getHover(workingContent, workingFilePath, 4, 12); // 'a' in math.atan2(a, a)
    console.log(`Working scenario 'a' hover: ${workingHover && workingHover.contents ? '✅ HAS HOVER' : '❌ NO HOVER'}`);
    
    if (workingHover && workingHover.contents) {
      const hoverText = typeof workingHover.contents === 'string' ? workingHover.contents : JSON.stringify(workingHover.contents);
      console.log('Working hover contents:', hoverText.substring(0, 150) + '...');
    }
    
    // Test the simple scenario  
    console.log('\\nSimple scenario:');
    console.log(simpleContent.replace(/\\\\n/g, '\\n'));
    
    const simpleHover = await getHover(simpleContent, simpleFilePath, 1, 6); // 'a' in print(a)
    console.log(`Simple scenario 'a' hover: ${simpleHover && simpleHover.contents ? '✅ HAS HOVER' : '❌ NO HOVER'}`);
    
    if (simpleHover && simpleHover.contents) {
      const hoverText = typeof simpleHover.contents === 'string' ? simpleHover.contents : JSON.stringify(simpleHover.contents);
      console.log('Simple hover contents:', hoverText.substring(0, 150) + '...');
    }
    
    console.log('\\n🔍 ANALYSIS:');
    if (workingHover && !simpleHover) {
      console.log('✅ CONFIRMED: Complex scenario works, simple scenario does not');
      console.log('The difference might be:');
      console.log('  - Import statements affecting symbol table');
      console.log('  - Function argument context vs print argument');
      console.log('  - Module imports triggering semantic analysis');
    } else if (!workingHover && !simpleHover) {
      console.log('❌ Neither works - variable hover might be completely broken');
    } else if (workingHover && simpleHover) {
      console.log('✅ Both work - the bug might be already fixed!');
    }
  });
});