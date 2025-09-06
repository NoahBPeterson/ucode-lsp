const assert = require('assert');
const path = require('path');
const { createLSPTestServer } = require('./lsp-test-helpers');

describe('Destructured Import Completion Test', function() {
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

  it('should provide math function completions in destructured import', async function() {
    const testContent = 'import { cos, rand, sin } from \'math\';';
    const testFilePath = path.join(__dirname, '..', 'test-math-destructured.uc');

    const completions = await getCompletions(testContent, testFilePath, 0, 8); // Position after '{'
    
    //console.log('Math destructured completions received:', completions?.length || 0);
    if (completions) {
      const mathFunctions = completions.filter(item => 
        ['cos', 'sin', 'rand', 'pow', 'sqrt', 'exp', 'log', 'abs', 'atan2', 'isnan', 'srand'].includes(item.label)
      );
      //console.log('Math functions found:', mathFunctions.map(item => item.label));
      
      assert(mathFunctions.length > 0, 'Should find math function completions');
      assert(mathFunctions.some(item => item.label === 'sqrt'), 'Should include sqrt function');
      assert(mathFunctions.some(item => item.label === 'exp'), 'Should include exp function');
      assert(mathFunctions.some(item => item.label === 'abs'), 'Should include abs function');
    } else {
      assert.fail('Should receive completions for math destructured import');
    }
  });

  it('should provide digest function completions in destructured import', async function() {
    const testContent = 'import { md5 } from \'digest\';';
    const testFilePath = path.join(__dirname, '..', 'test-digest-destructured.uc');

    const completions = await getCompletions(testContent, testFilePath, 0, 8); // Position after '{'
    
    console.log('Digest destructured completions received:', completions?.length || 0);
    if (completions) {
      const digestFunctions = completions.filter(item => 
        ['md5', 'sha1', 'sha256', 'sha384', 'sha512'].includes(item.label)
      );
      console.log('Digest functions found:', digestFunctions.map(item => item.label));
      
      assert(digestFunctions.length > 0, 'Should find digest function completions');
      assert(digestFunctions.some(item => item.label === 'sha384'), 'Should include sha384 function');
    } else {
      assert.fail('Should receive completions for digest destructured import');
    }
  });

  it('should provide fs function completions in destructured import', async function() {
    const testContent = 'import { open, lstat } from \'fs\';';
    const testFilePath = path.join(__dirname, '..', 'test-fs-destructured.uc');

    const completions = await getCompletions(testContent, testFilePath, 0, 8); // Position after '{'
    
    console.log('FS destructured completions received:', completions?.length || 0);
    if (completions) {
      const fsFunctions = completions.filter(item => 
        ['open', 'lstat', 'stat', 'readfile', 'writefile', 'access'].includes(item.label)
      );
      console.log('FS functions found:', fsFunctions.map(item => item.label));
      
      assert(fsFunctions.length > 0, 'Should find fs function completions');
      assert(fsFunctions.some(item => item.label === 'readfile'), 'Should include open function');
      assert(fsFunctions.some(item => item.label === 'access'), 'Should include lstat function');
    } else {
      assert.fail('Should receive completions for fs destructured import');
    }
  });

  it('should provide completions in middle of existing identifiers', async function() {
    const testContent = 'import { cos, rand, sin } from \'math\';';
    const testFilePath = path.join(__dirname, '..', 'test-math-middle.uc');

    const completions = await getCompletions(testContent, testFilePath, 0, 10); // Position in middle of 'cos'
    
    console.log('Math middle completions received:', completions?.length || 0);
    if (completions) {
      const mathFunctions = completions.filter(item => 
        ['cos', 'sin', 'rand', 'pow', 'sqrt'].includes(item.label)
      );
      
      assert(mathFunctions.length == 2, 'Should find math function completions when cursor is in middle');
    } else {
      assert.fail('Should receive completions when cursor is in middle of destructured import');
    }
  });
});