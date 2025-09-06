const assert = require('assert');
const path = require('path');
const { createLSPTestServer } = require('./lsp-test-helpers');

describe('NL80211 Static Fallback Test', function() {
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

  it('should provide nl80211 static completions when module not available on system', async function() {
    const testContent = 'import { } from \'nl80211\';';
    const testFilePath = path.join(__dirname, '..', 'test-nl80211-fallback.uc');

    const completions = await getCompletions(testContent, testFilePath, 0, 9); // Position after '{ '
    
    console.log('NL80211 static fallback - completions received:', completions?.length || 0);
    if (completions) {
      const labels = completions.map(item => item.label);
      console.log('Available nl80211 functions:', labels);
      
      // Check for the specific functions you mentioned
      assert(labels.includes('request'), 'Should include request function from static definitions');
      assert(labels.includes('error'), 'Should include error function from static definitions');
      assert(labels.includes('waitfor'), 'Should include waitfor function from static definitions');
      
      // Should have at least these 3 functions
      assert(completions.length >= 3, 'Should have at least 3 nl80211 functions from static definitions');
      
      // Completions should be functions or constants
      completions.forEach(completion => {
        const isFunctionOrConstant = completion.kind === 3 || completion.kind === 21; // Function = 3, Constant = 21
        assert(isFunctionOrConstant, `Completion should be function or constant, got kind: ${completion.kind}`);
        assert(completion.detail.includes('from nl80211'), 'Detail should mention nl80211 module');
      });
    } else {
      assert.fail('Should receive static fallback completions for nl80211 module');
    }
  });

  it('should exclude already imported nl80211 functions', async function() {
    const testContent = 'import { request, } from \'nl80211\';';
    const testFilePath = path.join(__dirname, '..', 'test-nl80211-exclude.uc');

    const completions = await getCompletions(testContent, testFilePath, 0, 17); // Position after 'request, '
    
    console.log('NL80211 exclusion - completions received:', completions?.length || 0);
    if (completions) {
      const labels = completions.map(item => item.label);
      console.log('Available nl80211 functions after exclusion:', labels);
      
      // request should be excluded
      assert(!labels.includes('request'), 'request should be excluded since it\'s already imported');
      
      // Other functions should still be available
      assert(labels.includes('error'), 'error should still be available');
      assert(labels.includes('waitfor'), 'waitfor should still be available');
    } else {
      assert.fail('Should receive completions with exclusions for nl80211');
    }
  });

  it('should work for other modules with mixed availability', async function() {
    const testContent = `import { } from 'fs';
import { } from 'nl80211';
import { } from 'math';`;
    
    // Test fs (should work dynamically)
    const fsCompletions = await getCompletions(testContent, path.join(__dirname, '..', 'test-mixed-fs.uc'), 0, 9);
    console.log('FS completions (dynamic):', fsCompletions?.length || 0);
    
    // Test nl80211 (should work via static fallback) 
    const nl80211Completions = await getCompletions(testContent, path.join(__dirname, '..', 'test-mixed-nl80211.uc'), 1, 9);
    console.log('NL80211 completions (static fallback):', nl80211Completions?.length || 0);
    
    // Test math (should work dynamically)
    const mathCompletions = await getCompletions(testContent, path.join(__dirname, '..', 'test-mixed-math.uc'), 2, 9);
    console.log('Math completions (dynamic):', mathCompletions?.length || 0);
    
    // All should have completions
    assert(fsCompletions && fsCompletions.length > 0, 'FS should have completions');
    assert(nl80211Completions && nl80211Completions.length > 0, 'NL80211 should have static fallback completions');
    assert(mathCompletions && mathCompletions.length > 0, 'Math should have completions');
    
    // Verify nl80211 has the expected functions
    if (nl80211Completions) {
      const nl80211Labels = nl80211Completions.map(item => item.label);
      assert(nl80211Labels.includes('request'), 'NL80211 should include request');
      assert(nl80211Labels.includes('error'), 'NL80211 should include error');  
      assert(nl80211Labels.includes('waitfor'), 'NL80211 should include waitfor');
    }
  });
});