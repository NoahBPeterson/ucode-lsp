const assert = require('assert');
const path = require('path');
const { createLSPTestServer } = require('./lsp-test-helpers');

describe('Completion Sorting Test', function() {
  this.timeout(15000);

  let lspServer;
  let getCompletions;

  before(async function() {
    lspServer = createLSPTestServer();
    await lspServer.initialize();
    getCompletions = lspServer.getCompletions;
  });

  after(function() {
    if (lspServer) {
      lspServer.shutdown();
    }
  });

  it('should sort completions with functions first, then constants', async function() {
    const testContent = 'import { } from \'nl80211\';';
    const testFilePath = path.join(__dirname, '..', 'test-completion-sorting.uc');

    const completions = await getCompletions(testContent, testFilePath, 0, 9); // Position after '{ '
    
    console.log('Completion sorting - completions received:', completions?.length || 0);
    
    if (completions && completions.length > 0) {
      // Extract first 20 items to examine the order
      const firstItems = completions.slice(0, 20);
      console.log('First 20 completions:');
      firstItems.forEach((item, index) => {
        console.log(`${String(index + 1).padStart(2)}. ${item.label.padEnd(25)} (kind: ${item.kind}, sortText: "${item.sortText || 'undefined'}")`);
      });
      
      // Find functions and constants in the results
      const functions = completions.filter(item => item.kind === 3); // Function kind
      const constants = completions.filter(item => item.kind === 21); // Constant kind
      
      console.log(`\nFound ${functions.length} functions and ${constants.length} constants`);
      
      // Get the positions of first function and first constant
      let firstFunctionIndex = -1;
      let firstConstantIndex = -1;
      
      for (let i = 0; i < completions.length; i++) {
        if (completions[i].kind === 3 && firstFunctionIndex === -1) {
          firstFunctionIndex = i;
        }
        if (completions[i].kind === 21 && firstConstantIndex === -1) {
          firstConstantIndex = i;
        }
        if (firstFunctionIndex !== -1 && firstConstantIndex !== -1) {
          break;
        }
      }
      
      console.log(`First function at index: ${firstFunctionIndex} (${firstFunctionIndex >= 0 ? completions[firstFunctionIndex].label : 'none'})`);
      console.log(`First constant at index: ${firstConstantIndex} (${firstConstantIndex >= 0 ? completions[firstConstantIndex].label : 'none'})`);
      
      // Verify that functions appear before constants
      if (firstFunctionIndex >= 0 && firstConstantIndex >= 0) {
        assert(firstFunctionIndex < firstConstantIndex, 
          `Functions should appear before constants. Found first function at ${firstFunctionIndex}, first constant at ${firstConstantIndex}`);
      }
      
      // Check that sortText is properly set for type-based sorting
      const itemsWithSortText = completions.filter(item => item.sortText && item.sortText.startsWith('1_'));
      console.log(`Items with function sortText (1_): ${itemsWithSortText.length}`);
      
      const constantsWithSortText = completions.filter(item => item.sortText && item.sortText.startsWith('2_'));
      console.log(`Items with constant sortText (2_): ${constantsWithSortText.length}`);
      
      // Verify that we have sortText values
      assert(functions.length > 0, 'Should have functions in nl80211');
      assert(constants.length > 0, 'Should have constants in nl80211');
      
      // Verify specific items are present and check their sortText
      const errorFunction = completions.find(item => item.label === 'error');
      const requestFunction = completions.find(item => item.label === 'request');
      const bridgeConstant = completions.find(item => item.label === 'BRIDGE_FLAGS_MASTER');
      
      if (errorFunction) {
        console.log(`error function sortText: "${errorFunction.sortText}"`);
        assert(errorFunction.sortText && errorFunction.sortText.startsWith('1_'), 'error function should have sortText starting with 1_');
      }
      
      if (requestFunction) {
        console.log(`request function sortText: "${requestFunction.sortText}"`);
        assert(requestFunction.sortText && requestFunction.sortText.startsWith('1_'), 'request function should have sortText starting with 1_');
      }
      
      if (bridgeConstant) {
        console.log(`BRIDGE_FLAGS_MASTER constant sortText: "${bridgeConstant.sortText}"`);
        assert(bridgeConstant.sortText && bridgeConstant.sortText.startsWith('2_'), 'BRIDGE_FLAGS_MASTER constant should have sortText starting with 2_');
      }
      
    } else {
      assert.fail('Should receive nl80211 completions');
    }
  });
  
  it('should demonstrate the sorting issue with mixed function/constant names', async function() {
    const testContent = 'import { request, } from \'nl80211\';';
    const testFilePath = path.join(__dirname, '..', 'test-mixed-sorting.uc');

    const completions = await getCompletions(testContent, testFilePath, 0, 17); // Position after 'request, '
    
    console.log('\nMixed sorting test - completions received:', completions?.length || 0);
    
    if (completions && completions.length > 0) {
      // Look for specific problematic cases
      const functions = ['error', 'waitfor', 'listener'];
      const constants = ['BRIDGE_FLAGS_MASTER', 'BRIDGE_MODE_UNSPEC'];
      
      const functionItems = completions.filter(item => functions.includes(item.label));
      const constantItems = completions.filter(item => constants.includes(item.label));
      
      console.log('\nFunction items found:');
      functionItems.forEach(item => {
        const index = completions.indexOf(item);
        console.log(`  ${item.label} at index ${index} (sortText: "${item.sortText}")`);
      });
      
      console.log('\nConstant items found:');
      constantItems.forEach(item => {
        const index = completions.indexOf(item);
        console.log(`  ${item.label} at index ${index} (sortText: "${item.sortText}")`);
      });
      
      // This test documents the current behavior - we expect it might fail initially
      // showing that BRIDGE_FLAGS_MASTER appears before 'error' or 'waitfor'
      console.log('\nExpected: All functions should appear before all constants');
      
    } else {
      assert.fail('Should receive completions for mixed sorting test');
    }
  });

  it('should test your exact scenario: request,BRIDGE_FLAGS_MASTER pattern', async function() {
    const testContent = 'import { request,BRIDGE_FLAGS_MASTER } from \'nl80211\';';
    const testFilePath = path.join(__dirname, '..', 'test-exact-scenario.uc');

    const completions = await getCompletions(testContent, testFilePath, 0, 32); // Position after 'request,BRIDGE_FLAGS_MASTER '
    
    console.log('\nExact scenario test - completions received:', completions?.length || 0);
    
    if (completions && completions.length > 0) {
      console.log('First 15 completions after "request,BRIDGE_FLAGS_MASTER":');
      completions.slice(0, 15).forEach((item, index) => {
        console.log(`${String(index + 1).padStart(2)}. ${item.label.padEnd(25)} (kind: ${item.kind}, sortText: "${item.sortText || 'undefined'}")`);
      });
      
      // In this case, both request and BRIDGE_FLAGS_MASTER should be excluded
      assert(!completions.some(item => item.label === 'request'), 'request should be excluded as already imported');
      assert(!completions.some(item => item.label === 'BRIDGE_FLAGS_MASTER'), 'BRIDGE_FLAGS_MASTER should be excluded as already imported');
      
      // Functions should still appear first
      const firstFunction = completions.find(item => item.kind === 3);
      const firstConstant = completions.find(item => item.kind === 21);
      
      if (firstFunction && firstConstant) {
        const functionIndex = completions.indexOf(firstFunction);
        const constantIndex = completions.indexOf(firstConstant);
        
        console.log(`\nFirst available function: ${firstFunction.label} at index ${functionIndex}`);
        console.log(`First available constant: ${firstConstant.label} at index ${constantIndex}`);
        
        assert(functionIndex < constantIndex, 'Functions should still appear before constants');
      }
      
    } else {
      console.log('No completions returned - this might be expected if all items are excluded');
    }
  });
});