const assert = require('assert');
const path = require('path');
const { createLSPTestServer } = require('./lsp-test-helpers');

describe('Destructured Import Trigger Completion Test', function() {
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

  it('should provide completions in empty destructuring', async function() {
    const testContent = 'import {  } from \'math\';';
    const testFilePath = path.join(__dirname, '..', 'test-empty-destructure.uc');

    const completions = await getCompletions(testContent, testFilePath, 0, 9); // Position after '{ '
    
    console.log('Empty destructuring - completions received:', completions?.length || 0);
    if (completions) {
      const mathFunctions = completions.filter(item => 
        ['cos', 'sin', 'rand', 'pow', 'sqrt', 'exp', 'log', 'abs', 'atan2', 'isnan', 'srand'].includes(item.label)
      );
      console.log('Math functions found:', mathFunctions.map(item => item.label));
      
      assert(mathFunctions.length > 0, 'Should find math function completions in empty destructuring');
      assert(mathFunctions.some(item => item.label === 'cos'), 'Should include cos function');
      assert(mathFunctions.some(item => item.label === 'sin'), 'Should include sin function');
      assert(mathFunctions.some(item => item.label === 'rand'), 'Should include rand function');
    } else {
      assert.fail('Should receive completions in empty destructuring');
    }
  });

  it('should provide completions after comma with space', async function() {
    const testContent = 'import { cos, } from \'math\';';
    const testFilePath = path.join(__dirname, '..', 'test-comma-space.uc');

    const completions = await getCompletions(testContent, testFilePath, 0, 14); // Position after 'cos, '
    
    console.log('After comma with space - completions received:', completions?.length || 0);
    if (completions) {
      const mathFunctions = completions.filter(item => 
        ['sin', 'rand', 'pow', 'sqrt', 'exp', 'log', 'abs', 'atan2', 'isnan', 'srand'].includes(item.label)
      );
      console.log('Math functions found:', mathFunctions.map(item => item.label));
      
      assert(mathFunctions.length > 0, 'Should find math function completions after comma with space');
      assert(mathFunctions.some(item => item.label === 'sin'), 'Should include sin function');
      assert(mathFunctions.some(item => item.label === 'rand'), 'Should include rand function');
    } else {
      assert.fail('Should receive completions after comma with space');
    }
  });

  it('should provide completions after comma without space', async function() {
    const testContent = 'import { cos,} from \'math\';';
    const testFilePath = path.join(__dirname, '..', 'test-comma-nospace.uc');

    const completions = await getCompletions(testContent, testFilePath, 0, 13); // Position right after 'cos,'
    
    console.log('After comma without space - completions received:', completions?.length || 0);
    if (completions) {
      const mathFunctions = completions.filter(item => 
        ['sin', 'rand', 'pow', 'sqrt', 'exp', 'log', 'abs', 'atan2', 'isnan', 'srand'].includes(item.label)
      );
      console.log('Math functions found:', mathFunctions.map(item => item.label));
      
      assert(mathFunctions.length > 0, 'Should find math function completions after comma without space');
      assert(mathFunctions.some(item => item.label === 'sin'), 'Should include sin function');
      assert(mathFunctions.some(item => item.label === 'rand'), 'Should include rand function');
    } else {
      assert.fail('Should receive completions after comma without space');
    }
  });

  it('should provide completions right after opening brace', async function() {
    const testContent = 'import {} from \'digest\';';
    const testFilePath = path.join(__dirname, '..', 'test-right-after-brace.uc');

    const completions = await getCompletions(testContent, testFilePath, 0, 8); // Position right after '{'
    
    console.log('Right after brace - completions received:', completions?.length || 0);
    if (completions) {
      const digestFunctions = completions.filter(item => 
        ['md5', 'sha1', 'sha256', 'sha384', 'sha512'].includes(item.label)
      );
      console.log('Digest functions found:', digestFunctions.map(item => item.label));
      
      assert(digestFunctions.length > 0, 'Should find digest function completions right after opening brace');
      assert(digestFunctions.some(item => item.label === 'md5'), 'Should include md5 function');
    } else {
      assert.fail('Should receive completions right after opening brace');
    }
  });

  it('should provide completions between existing imports', async function() {
    const testContent = 'import { cos,  , sin } from \'math\';';
    const testFilePath = path.join(__dirname, '..', 'test-between-imports.uc');

    const completions = await getCompletions(testContent, testFilePath, 0, 15); // Position in the middle between cos and sin
    
    console.log('Between existing imports - completions received:', completions?.length || 0);
    if (completions) {
      const mathFunctions = completions.filter(item => 
        ['rand', 'pow', 'sqrt', 'exp', 'log', 'abs', 'atan2', 'isnan', 'srand'].includes(item.label)
      );
      console.log('Math functions found:', mathFunctions.map(item => item.label));
      
      assert(mathFunctions.length > 0, 'Should find math function completions between existing imports');
      assert(mathFunctions.some(item => item.label === 'rand'), 'Should include rand function');
      assert(mathFunctions.some(item => item.label === 'pow'), 'Should include pow function');
    } else {
      assert.fail('Should receive completions between existing imports');
    }
  });
});