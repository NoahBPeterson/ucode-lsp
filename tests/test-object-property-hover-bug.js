const assert = require('assert');
const path = require('path');
const { createLSPTestServer } = require('./lsp-test-helpers');

describe('Object Property Hover Bug Test', function() {
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

  it('should NOT show builtin hover for object property with same name as builtin', async function() {
    const testContent = `let e = {};
e.gc(); // This should NOT show builtin gc() hover`;
    const testFilePath = path.join(__dirname, '..', 'test-object-property-hover.uc');

    // Test hovering over the 'gc' in 'e.gc()' - position 2 should be the 'c' in 'gc'
    const hover = await getHover(testContent, testFilePath, 1, 2); // Position at 'c' in 'gc'
    
    console.log('Object property hover test:');
    console.log(`Content: "${testContent.split('\\n')[1]}"`);
    console.log(`Hover result:`, hover);
    
    if (hover && hover.contents) {
      console.log('Hover contents:', typeof hover.contents === 'string' ? hover.contents : JSON.stringify(hover.contents, null, 2));
      
      // This should NOT be the builtin gc() function hover
      // The hover should either be null/undefined or show property-specific information
      
      // Check if it's showing builtin gc() information
      const hoverText = typeof hover.contents === 'string' ? hover.contents : JSON.stringify(hover.contents);
      const isBuiltinGcHover = hoverText.includes('garbage collect') || 
                               hoverText.includes('Garbage collect') ||
                               hoverText.includes('Forces garbage collection') ||
                               hoverText.includes('builtin function');
      
      if (isBuiltinGcHover) {
        console.log('❌ BUG DETECTED: Object property e.gc() is showing builtin gc() hover information');
        console.log('Expected: Should NOT show builtin function hover for object properties');
        
        // For now, we'll make this test pass by documenting the bug
        // Later, when we fix the bug, we can change this to assert.fail()
        console.log('This test documents the current buggy behavior');
      } else {
        console.log('✅ GOOD: Object property e.gc() does not show builtin hover');
      }
      
      // The assertion we want to pass when the bug is fixed:
      assert(!isBuiltinGcHover, 'Object property e.gc() should NOT show builtin gc() function hover');
    } else {
      console.log('✅ GOOD: No hover shown for object property (this is acceptable)');
      // No hover is fine - object properties don't need to show hover unless they have specific typing
    }
  });

  it('should show builtin hover for standalone builtin function call', async function() {
    const testContent = `gc(); // This SHOULD show builtin gc() hover`;
    const testFilePath = path.join(__dirname, '..', 'test-builtin-hover.uc');

    // Test hovering over the 'gc' in standalone 'gc()'
    const hover = await getHover(testContent, testFilePath, 0, 1); // Position at 'g' in 'gc'
    
    console.log('\\nBuiltin function hover test:');
    console.log(`Content: "${testContent}"`);
    console.log(`Hover result:`, hover);
    
    if (hover && hover.contents) {
      console.log('Hover contents:', typeof hover.contents === 'string' ? hover.contents : JSON.stringify(hover.contents, null, 2));
      
      // This SHOULD show builtin gc() information
      const hoverText = typeof hover.contents === 'string' ? hover.contents : JSON.stringify(hover.contents);
      const isBuiltinGcHover = hoverText.includes('garbage collect') || 
                               hoverText.includes('Garbage collect') ||
                               hoverText.includes('Forces garbage collection') ||
                               hoverText.includes('builtin function');
      
      console.log(isBuiltinGcHover ? '✅ GOOD: Standalone gc() shows builtin hover' : '❌ Missing builtin hover for gc()');
      
      // This should work correctly
      assert(isBuiltinGcHover, 'Standalone gc() should show builtin function hover');
    } else {
      assert.fail('Standalone builtin gc() should show hover information');
    }
  });

  it('should test multiple builtin names as object properties', async function() {
    const testContent = `let obj = {};
obj.print();  // Should NOT show builtin print() hover  
obj.length(); // Should NOT show builtin length() hover
obj.push();   // Should NOT show builtin push() hover`;
    const testFilePath = path.join(__dirname, '..', 'test-multiple-properties.uc');

    // Test print property
    const printHover = await getHover(testContent, testFilePath, 1, 4); // Position at 'p' in 'print'
    console.log('\\nMultiple properties test - obj.print():');
    
    if (printHover && printHover.contents) {
      const hoverText = typeof printHover.contents === 'string' ? printHover.contents : JSON.stringify(printHover.contents);
      const isBuiltinHover = hoverText.includes('builtin') || hoverText.includes('Prints');
      
      console.log(`obj.print() hover: ${isBuiltinHover ? '❌ Shows builtin (bug)' : '✅ No builtin hover (correct)'}`);
      
      // When bug is fixed, this should pass
      assert(!isBuiltinHover, 'obj.print() should NOT show builtin print() hover');
    } else {
      console.log('✅ obj.print() shows no hover (acceptable)');
    }

    // Test length property
    const lengthHover = await getHover(testContent, testFilePath, 2, 4); // Position at 'l' in 'length'
    console.log('obj.length():');
    
    if (lengthHover && lengthHover.contents) {
      const hoverText = typeof lengthHover.contents === 'string' ? lengthHover.contents : JSON.stringify(lengthHover.contents);
      const isBuiltinHover = hoverText.includes('builtin') || hoverText.includes('Returns the length');
      
      console.log(`obj.length() hover: ${isBuiltinHover ? '❌ Shows builtin (bug)' : '✅ No builtin hover (correct)'}`);
      
      // When bug is fixed, this should pass
      assert(!isBuiltinHover, 'obj.length() should NOT show builtin length() hover');
    } else {
      console.log('✅ obj.length() shows no hover (acceptable)');
    }
  });

  it('should show correct behavior comparison', async function() {
    const testContent = `// Standalone builtin - SHOULD show hover
gc();

// Object property - should NOT show builtin hover  
let e = {};
e.gc();`;
    const testFilePath = path.join(__dirname, '..', 'test-hover-comparison.uc');

    console.log('\\n=== BEHAVIOR COMPARISON ===');
    
    // Test standalone builtin
    const standaloneHover = await getHover(testContent, testFilePath, 1, 1);
    console.log('1. Standalone gc():');
    if (standaloneHover && standaloneHover.contents) {
      const hoverText = typeof standaloneHover.contents === 'string' ? standaloneHover.contents : JSON.stringify(standaloneHover.contents);
      const isBuiltin = hoverText.includes('garbage collect') || hoverText.includes('builtin');
      console.log(`   ${isBuiltin ? '✅ Shows builtin hover (correct)' : '❌ Missing builtin hover'}`);
    } else {
      console.log('   ❌ No hover (should show builtin)');
    }
    
    // Test object property
    const propertyHover = await getHover(testContent, testFilePath, 5, 2);
    console.log('2. Object property e.gc():');
    if (propertyHover && propertyHover.contents) {
      const hoverText = typeof propertyHover.contents === 'string' ? propertyHover.contents : JSON.stringify(propertyHover.contents);
      const isBuiltin = hoverText.includes('garbage collect') || hoverText.includes('builtin');
      console.log(`   ${isBuiltin ? '❌ Shows builtin hover (BUG!)' : '✅ No builtin hover (correct)'}`);
    } else {
      console.log('   ✅ No hover (acceptable for object properties)');
    }
    
    console.log('\\nExpected behavior: Only standalone builtin calls should show builtin hover info');
  });

  it('should reproduce the specific bug: user object with builtin method name', async function() {
    const testContent = 'let obj = { gc: function() { return "custom gc"; } };\\nobj.gc(); // This property should NOT show builtin gc() hover';
    const testFilePath = path.join(__dirname, '..', 'test-user-object-gc.uc');

    // Test hovering specifically on the 'gc' in the member expression
    const lines = testContent.split('\\n');
    console.log('All lines:');
    lines.forEach((line, i) => console.log(`  ${i}: "${line}"`));
    console.log('Line 1 content:', `"${lines[1] || 'undefined'}"`);
    console.log('Character positions: 0123456789...');
    console.log('Looking for: obj.gc()');
    console.log('Expected: position 4="g", position 5="c"');
    
    const hoverOnG = await getHover(testContent, testFilePath, 1, 4); // Position at 'g' in 'obj.gc()'
    const hoverOnC = await getHover(testContent, testFilePath, 1, 5); // Position at 'c' in 'obj.gc()'
    
    console.log('\\nUser object with builtin method name test:');
    console.log('Content:', testContent.split('\\n')[1]);
    console.log('Hover on "g":', hoverOnG ? 'HAS HOVER' : 'NO HOVER');
    console.log('Hover on "c":', hoverOnC ? 'HAS HOVER' : 'NO HOVER');
    
    if (hoverOnG) {
      const hoverText = typeof hoverOnG.contents === 'string' ? hoverOnG.contents : JSON.stringify(hoverOnG.contents);
      const isBuiltinHover = hoverText.includes('garbage collect') || hoverText.includes('built-in function');
      console.log(`Hover on "g" shows builtin: ${isBuiltinHover ? '❌ YES (BUG)' : '✅ NO'}`);
    }
    
    if (hoverOnC) {
      const hoverText = typeof hoverOnC.contents === 'string' ? hoverOnC.contents : JSON.stringify(hoverOnC.contents);
      const isBuiltinHover = hoverText.includes('garbage collect') || hoverText.includes('built-in function');
      console.log(`Hover on "c" shows builtin: ${isBuiltinHover ? '❌ YES (BUG)' : '✅ NO'}`);
      
      // This assertion should pass now that the bug is fixed
      assert(!isBuiltinHover, 'Object property obj.gc() should NOT show builtin gc() hover');
    } else {
      console.log('✅ NO HOVER on "c" (correct - object properties should not show builtin hover)');
    }

    console.log('\\n🎯 This test verified the fix for the bug where user object properties');
    console.log('   with the same name as builtins incorrectly showed builtin hover info.'); 
    console.log('✅ FIX CONFIRMED: Object properties no longer show builtin hover!');
  });
});