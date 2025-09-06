const assert = require('assert');
const path = require('path');
const { createLSPTestServer } = require('./lsp-test-helpers');

describe('Import Exclusion Completion Test', function() {
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

  it('should exclude already imported functions after comma', async function() {
    const testContent = 'import { cos, } from \'math\';';
    const testFilePath = path.join(__dirname, '..', 'test-exclude-cos.uc');

    const completions = await getCompletions(testContent, testFilePath, 0, 14); // Position after 'cos, '
    
    console.log('Exclusion test - completions received:', completions?.length || 0);
    if (completions) {
      const labels = completions.map(item => item.label);
      console.log('Available functions:', labels);
      
      // cos should be excluded
      assert(!labels.includes('cos'), 'cos should be excluded since it\'s already imported');
      
      // Other math functions should still be available
      assert(labels.includes('sin'), 'sin should be available');
      assert(labels.includes('rand'), 'rand should be available');
      assert(labels.includes('pow'), 'pow should be available');
    } else {
      assert.fail('Should receive completions after comma');
    }
  });

  it('should exclude multiple already imported functions', async function() {
    const testContent = 'import { cos, sin, pow, } from \'math\';';
    const testFilePath = path.join(__dirname, '..', 'test-exclude-multiple.uc');

    const completions = await getCompletions(testContent, testFilePath, 0, 23); // Position after 'pow, '
    
    console.log('Multiple exclusion test - completions received:', completions?.length || 0);
    if (completions) {
      const labels = completions.map(item => item.label);
      console.log('Available functions:', labels);
      
      // Already imported functions should be excluded
      assert(!labels.includes('cos'), 'cos should be excluded');
      assert(!labels.includes('sin'), 'sin should be excluded');  
      assert(!labels.includes('pow'), 'pow should be excluded');
      
      // Other math functions should still be available
      assert(labels.includes('rand'), 'rand should be available');
      assert(labels.includes('sqrt'), 'sqrt should be available');
      assert(labels.includes('exp'), 'exp should be available');
    } else {
      assert.fail('Should receive completions after comma with multiple exclusions');
    }
  });

  it('should show all functions when none are imported yet', async function() {
    const testContent = 'import {  } from \'math\';';
    const testFilePath = path.join(__dirname, '..', 'test-exclude-none.uc');

    const completions = await getCompletions(testContent, testFilePath, 0, 9); // Position after '{ '
    
    console.log('No exclusion test - completions received:', completions?.length || 0);
    if (completions) {
      const labels = completions.map(item => item.label);
      console.log('Available functions:', labels);
      
      // All math functions should be available
      assert(labels.includes('cos'), 'cos should be available');
      assert(labels.includes('sin'), 'sin should be available');
      assert(labels.includes('rand'), 'rand should be available');
      assert(labels.includes('pow'), 'pow should be available');
      assert(labels.includes('sqrt'), 'sqrt should be available');
      
      // Should have all 11 math functions
      const mathFunctions = labels.filter(label => 
        ['cos', 'sin', 'rand', 'pow', 'sqrt', 'exp', 'log', 'abs', 'atan2', 'isnan', 'srand'].includes(label)
      );
      assert.strictEqual(mathFunctions.length, 11, 'Should have all 11 math functions when nothing is excluded');
    } else {
      assert.fail('Should receive completions when no functions are imported yet');
    }
  });

  it('should work correctly with different modules', async function() {
    const testContent = 'import { md5, sha1, } from \'digest\';';
    const testFilePath = path.join(__dirname, '..', 'test-exclude-digest.uc');

    const completions = await getCompletions(testContent, testFilePath, 0, 19); // Position after 'sha1, '
    
    console.log('Digest exclusion test - completions received:', completions?.length || 0);
    if (completions) {
      const labels = completions.map(item => item.label);
      console.log('Available digest functions:', labels);
      
      // Already imported functions should be excluded
      assert(!labels.includes('md5'), 'md5 should be excluded');
      assert(!labels.includes('sha1'), 'sha1 should be excluded');
      
      // Other digest functions should still be available
      assert(labels.includes('sha256'), 'sha256 should be available');
      assert(labels.includes('sha384'), 'sha384 should be available');
      assert(labels.includes('sha512'), 'sha512 should be available');
    } else {
      assert.fail('Should receive completions for digest module exclusions');
    }
  });
});