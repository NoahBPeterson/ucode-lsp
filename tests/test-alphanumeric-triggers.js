const assert = require('assert');
const path = require('path');
const { createLSPTestServer } = require('./lsp-test-helpers');

describe('Alphanumeric Trigger Completion Test', function() {
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

  it('should trigger completions when typing letters in empty destructuring', async function() {
    const testContent = 'import { e } from \'math\';';
    const testFilePath = path.join(__dirname, '..', 'test-alpha-e.uc');

    const completions = await getCompletions(testContent, testFilePath, 0, 10); // Position after 'e'
    
    console.log('Alphanumeric trigger (e) - completions received:', completions?.length || 0);
    if (completions) {
      const labels = completions.map(item => item.label);
      console.log('Available functions:', labels.slice(0, 10));
      
      // Should have math completions
      const mathFunctions = completions.filter(item => 
        ['exp', 'cos', 'sin', 'rand', 'pow', 'sqrt', 'log', 'abs', 'atan2', 'isnan', 'srand'].includes(item.label)
      );
      
      assert(mathFunctions.length > 0, 'Should find math function completions when typing "e"');
      assert(mathFunctions.some(item => item.label === 'exp'), 'Should include exp function starting with "e"');
    } else {
      assert.fail('Should receive completions when typing alphanumeric characters');
    }
  });

  it('should trigger completions when typing partial function names', async function() {
    const testContent = 'import { co } from \'math\';';
    const testFilePath = path.join(__dirname, '..', 'test-alpha-co.uc');

    const completions = await getCompletions(testContent, testFilePath, 0, 11); // Position after 'co'
    
    console.log('Partial function name (co) - completions received:', completions?.length || 0);
    if (completions) {
      const labels = completions.map(item => item.label);
      console.log('Available functions:', labels.slice(0, 10));
      
      // Should have math completions including cos
      const mathFunctions = completions.filter(item => 
        ['cos', 'sin', 'rand', 'pow', 'sqrt', 'exp', 'log', 'abs', 'atan2', 'isnan', 'srand'].includes(item.label)
      );
      
      assert(mathFunctions.length > 0, 'Should find math function completions when typing "co"');
      assert(mathFunctions.some(item => item.label === 'cos'), 'Should include cos function starting with "co"');
    } else {
      assert.fail('Should receive completions when typing partial function names');
    }
  });

  it('should trigger completions for nl80211 constants', async function() {
    const testContent = `import { NLM } from 'nl80211';`;
    const testFilePath = path.join(__dirname, '..', 'test-alpha-nlm.uc');

    const completions = await getCompletions(testContent, testFilePath, 0, 12); // Position after 'NLM'
    
    console.log('NL80211 constants (NLM) - completions received:', completions?.length || 0);
    if (completions) {
      const labels = completions.map(item => item.label);
      const nlmConstants = labels.filter(label => label.startsWith('NLM_'));
      console.log('NLM constants found:', nlmConstants.slice(0, 10));
      
      assert(completions.length > 0, 'Should find nl80211 completions');
      assert(nlmConstants.length > 0, 'Should include NLM_ constants');
      assert(labels.includes('request'), 'Should also include functions');
      assert(labels.includes('error'), 'Should include error function');
    } else {
      assert.fail('Should receive completions for nl80211 constants');
    }
  });

  it('should trigger completions on any single letter', async function() {
    const letters = ['a', 'r', 's', 'm'];
    
    for (const letter of letters) {
      const testContent = `import { ${letter} } from 'math';`;
      const testFilePath = path.join(__dirname, '..', `test-alpha-${letter}.uc`);

      const completions = await getCompletions(testContent, testFilePath, 0, 9 + letter.length); // Position after letter
      
      console.log(`Single letter (${letter}) - completions received:`, completions?.length || 0);
      
      if (completions) {
        const mathFunctions = completions.filter(item => 
          ['cos', 'sin', 'rand', 'pow', 'sqrt', 'exp', 'log', 'abs', 'atan2', 'isnan', 'srand'].includes(item.label)
        );
        
        assert(mathFunctions.length > 0, `Should find math function completions when typing "${letter}"`);
      } else {
        assert.fail(`Should receive completions when typing "${letter}"`);
      }
    }
  });
});