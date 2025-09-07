const assert = require('assert');
const path = require('path');
const { createLSPTestServer } = require('./lsp-test-helpers');

describe('Semantic Analysis Timing Test', function() {
  this.timeout(15000);

  let lspServer;
  let getHover;
  let getDiagnostics;

  before(async function() {
    lspServer = createLSPTestServer();
    await lspServer.initialize();
    getHover = lspServer.getHover;
    getDiagnostics = lspServer.getDiagnostics;
  });

  after(function() {
    if (lspServer) {
      lspServer.shutdown();
    }
  });

  it('should perform semantic analysis and provide diagnostics', async function() {
    const testContent = 'let x = 42;\\nlet y = undefinedVariable;'; // This should trigger a diagnostic
    const testFilePath = path.join(__dirname, '..', 'test-semantic-analysis.uc');

    console.log('Testing semantic analysis with diagnostic triggers...');
    
    // Get diagnostics first - this should trigger semantic analysis
    const diagnostics = await getDiagnostics(testContent, testFilePath);
    
    console.log(`Diagnostics received: ${diagnostics ? diagnostics.length : 0}`);
    if (diagnostics && diagnostics.length > 0) {
      console.log('Sample diagnostic:', diagnostics[0]);
      console.log('✅ Semantic analysis appears to be working (diagnostics generated)');
    } else {
      console.log('❌ No diagnostics - semantic analysis might not be working');
    }
    
    // Now test hover on a simple variable
    const hoverOnX = await getHover(testContent, testFilePath, 0, 4); // 'x' in 'let x = 42'
    console.log(`\\nHover on 'x': ${hoverOnX && hoverOnX.contents ? '✅ HAS HOVER' : '❌ NO HOVER'}`);
    
    if (hoverOnX && hoverOnX.contents) {
      const hoverText = typeof hoverOnX.contents === 'string' ? hoverOnX.contents : JSON.stringify(hoverOnX.contents);
      console.log('Hover contents:', hoverText);
    }
  });

  it('should test hover on imported functions vs variables', async function() {
    const testContent = 'import {request} from "nl80211";\\nlet a = request;\\nrequest();\\na();';
    const testFilePath = path.join(__dirname, '..', 'test-imported-vs-variable.uc');

    console.log('\\nTesting imported function vs variable that holds it...');
    
    // Test hover on the imported function directly
    const hoverOnImported = await getHover(testContent, testFilePath, 2, 0); // 'request' in 'request()'
    console.log(`Imported function 'request': ${hoverOnImported && hoverOnImported.contents ? '✅ HAS HOVER' : '❌ NO HOVER'}`);
    
    // Test hover on variable that holds the imported function  
    const hoverOnVariable = await getHover(testContent, testFilePath, 3, 0); // 'a' in 'a()'
    console.log(`Variable 'a' (holds request): ${hoverOnVariable && hoverOnVariable.contents ? '✅ HAS HOVER' : '❌ NO HOVER'}`);
    
    // Test hover on variable declaration
    const hoverOnDeclaration = await getHover(testContent, testFilePath, 1, 4); // 'a' in 'let a = request'
    console.log(`Variable 'a' (in declaration): ${hoverOnDeclaration && hoverOnDeclaration.contents ? '✅ HAS HOVER' : '❌ NO HOVER'}`);
    
    if (hoverOnImported && hoverOnImported.contents) {
      console.log('\\nImported function hover preview:', JSON.stringify(hoverOnImported.contents).substring(0, 100) + '...');
    }
    
    if (hoverOnVariable && hoverOnVariable.contents) {
      console.log('Variable hover preview:', JSON.stringify(hoverOnVariable.contents).substring(0, 100) + '...');
    }
  });

  it('should test variable hover in function arguments', async function() {
    const testContent = 'import * as math from "math";\\nlet a = 5;\\nmath.atan2(a, a);';
    const testFilePath = path.join(__dirname, '..', 'test-function-args.uc');

    console.log('\\nTesting variable hover in function arguments (original bug scenario)...');
    
    // Test both 'a' variables in math.atan2(a, a)
    const hoverFirstA = await getHover(testContent, testFilePath, 2, 12); // First 'a'
    const hoverSecondA = await getHover(testContent, testFilePath, 2, 15); // Second 'a'
    
    console.log(`First 'a' in math.atan2(a, a): ${hoverFirstA && hoverFirstA.contents ? '✅ HAS HOVER' : '❌ NO HOVER'}`);
    console.log(`Second 'a' in math.atan2(a, a): ${hoverSecondA && hoverSecondA.contents ? '✅ HAS HOVER' : '❌ NO HOVER'}`);
    
    if (hoverFirstA && hoverFirstA.contents) {
      console.log('First a hover:', JSON.stringify(hoverFirstA.contents).substring(0, 80) + '...');
    }
    
    if (hoverSecondA && hoverSecondA.contents) {
      console.log('Second a hover:', JSON.stringify(hoverSecondA.contents).substring(0, 80) + '...');
    }
    
    // This is the consistency check - both should behave the same
    const consistent = (!!hoverFirstA) === (!!hoverSecondA);
    console.log(`\\nHover consistency: ${consistent ? '✅ CONSISTENT' : '❌ INCONSISTENT'}`);
    
    if (!consistent) {
      console.log('🎯 ORIGINAL BUG REPRODUCED: Inconsistent hover behavior between identical variables!');
    }
  });
});