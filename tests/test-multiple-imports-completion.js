const assert = require('assert');
const path = require('path');
const { createLSPTestServer } = require('./lsp-test-helpers');

describe('Multiple Destructured Import Completion Test', function() {
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

  it('should provide completions for fs when fs is first', async function() {
    const testContent = `import { open, lstat } from 'fs';
import { md5} from 'digest';
import { cos, sin, rand } from 'math';`;
    
    const completions = await getCompletions(testContent, path.join(__dirname, '..', 'test-fs-first.uc'), 0, 8); // Position after first '{'
    
    console.log('FS first - completions received:', completions?.length || 0);
    if (completions) {
      const fsFunctions = completions.filter(item => 
        ['open', 'lstat', 'stat', 'readfile', 'writefile', 'access'].includes(item.label)
      );
      console.log('FS functions found:', fsFunctions.map(item => item.label));
      
      assert(fsFunctions.length > 0, 'Should find fs function completions when fs is first');
      assert(fsFunctions.some(item => item.label === 'open'), 'Should include open function');
      assert(fsFunctions.some(item => item.label === 'lstat'), 'Should include lstat function');
    } else {
      assert.fail('Should receive completions for fs when fs is first');
    }
  });

  it('should provide completions for digest when fs is first', async function() {
    const testContent = `import { open, lstat } from 'fs';
import { md5} from 'digest';
import { cos, sin, rand } from 'math';`;
    
    const completions = await getCompletions(testContent, path.join(__dirname, '..', 'test-digest-second.uc'), 1, 8); // Position after second '{'
    
    console.log('Digest second - completions received:', completions?.length || 0);
    if (completions) {
      const digestFunctions = completions.filter(item => 
        ['md5', 'sha1', 'sha256', 'sha384', 'sha512'].includes(item.label)
      );
      console.log('Digest functions found:', digestFunctions.map(item => item.label));
      
      assert(digestFunctions.length > 0, 'Should find digest function completions when digest is second');
      assert(digestFunctions.some(item => item.label === 'md5'), 'Should include md5 function');
    } else {
      assert.fail('Should receive completions for digest when digest is second');
    }
  });

  it('should provide completions for math when fs is first', async function() {
    const testContent = `import { open, lstat } from 'fs';
import { md5} from 'digest';
import { cos, sin, rand } from 'math';`;
    
    const completions = await getCompletions(testContent, path.join(__dirname, '..', 'test-math-third.uc'), 2, 8); // Position after third '{'
    
    console.log('Math third - completions received:', completions?.length || 0);
    if (completions) {
      const mathFunctions = completions.filter(item => 
        ['cos', 'sin', 'rand', 'pow', 'sqrt', 'exp', 'log', 'abs', 'atan2', 'isnan', 'srand'].includes(item.label)
      );
      console.log('Math functions found:', mathFunctions.map(item => item.label));
      
      assert(mathFunctions.length > 0, 'Should find math function completions when math is third');
      assert(mathFunctions.some(item => item.label === 'cos'), 'Should include cos function');
      assert(mathFunctions.some(item => item.label === 'sin'), 'Should include sin function');
      assert(mathFunctions.some(item => item.label === 'rand'), 'Should include rand function');
    } else {
      assert.fail('Should receive completions for math when math is third');
    }
  });

  it('should provide completions for math when math is first', async function() {
    const testContent = `import { cos, sin, rand } from 'math';
import { open, lstat, readfile } from 'fs';
import { md5} from 'digest';`;
    
    const completions = await getCompletions(testContent, path.join(__dirname, '..', 'test-math-first.uc'), 0, 8); // Position after first '{'
    
    console.log('Math first - completions received:', completions?.length || 0);
    if (completions) {
      const mathFunctions = completions.filter(item => 
        ['cos', 'sin', 'rand', 'pow', 'sqrt', 'exp', 'log', 'abs', 'atan2', 'isnan', 'srand'].includes(item.label)
      );
      console.log('Math functions found:', mathFunctions.map(item => item.label));
      
      assert(mathFunctions.length > 0, 'Should find math function completions when math is first');
      assert(mathFunctions.some(item => item.label === 'cos'), 'Should include cos function');
      assert(mathFunctions.some(item => item.label === 'sin'), 'Should include sin function');
      assert(mathFunctions.some(item => item.label === 'rand'), 'Should include rand function');
    } else {
      assert.fail('Should receive completions for math when math is first');
    }
  });

  it('should provide completions for fs when math is first', async function() {
    const testContent = `import { cos, sin, rand } from 'math';
import { open, lstat, readfile } from 'fs';
import { md5} from 'digest';`;
    
    const completions = await getCompletions(testContent, path.join(__dirname, '..', 'test-fs-second.uc'), 1, 8); // Position after second '{'
    
    console.log('FS second - completions received:', completions?.length || 0);
    if (completions) {
      const fsFunctions = completions.filter(item => 
        ['open', 'lstat', 'stat', 'readfile', 'writefile', 'access'].includes(item.label)
      );
      console.log('FS functions found:', fsFunctions.map(item => item.label));
      
      assert(fsFunctions.length > 0, 'Should find fs function completions when fs is second');
      assert(fsFunctions.some(item => item.label === 'open'), 'Should include open function');
      assert(fsFunctions.some(item => item.label === 'lstat'), 'Should include lstat function');
      assert(fsFunctions.some(item => item.label === 'readfile'), 'Should include readfile function');
    } else {
      assert.fail('Should receive completions for fs when fs is second');
    }
  });

  it('should provide completions for digest when digest is first', async function() {
    const testContent = `import { sha1 } from 'digest';
import { cos, sin, rand } from 'math';
import { open, lstat, readfile } from 'fs';`;
    
    const completions = await getCompletions(testContent, path.join(__dirname, '..', 'test-digest-first.uc'), 0, 8); // Position after first '{'
    
    console.log('Digest first - completions received:', completions?.length || 0);
    if (completions) {
      const digestFunctions = completions.filter(item => 
        ['md5', 'sha1', 'sha256', 'sha384', 'sha512'].includes(item.label)
      );
      console.log('Digest functions found:', digestFunctions.map(item => item.label));
      
      assert(digestFunctions.length > 0, 'Should find digest function completions when digest is first');
      assert(digestFunctions.some(item => item.label === 'sha1'), 'Should include sha1 function');
    } else {
      assert.fail('Should receive completions for digest when digest is first');
    }
  });
});