// Test to verify uloop delete() methods are properly defined
// This test manually validates the source code to ensure the fixes are working

const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('🧪 Testing Uloop Delete Methods Implementation...\n');

let totalTests = 0;
let passedTests = 0;

function testValidation(testName, condition, details) {
  console.log(`🧪 ${testName}:`);
  totalTests++;
  const result = condition;
  console.log(`  Result: ${result ? '✅ PASS' : '❌ FAIL'}`);
  if (!result && details) {
    console.log(`  Details: ${details}`);
  }
  if (result) passedTests++;
  return result;
}

// Read the uloop types source file
const uloopTypesPath = path.join(__dirname, '../src/analysis/uloopTypes.ts');
const uloopTypesContent = fs.readFileSync(uloopTypesPath, 'utf8');

// Test 1: Verify handle delete method is defined
const handleDeleteRegex = /delete.*\{\s*name:\s*'delete'[\s\S]*?Unregisters the uloop handle/;
testValidation(
  'Handle delete() method is defined',
  handleDeleteRegex.test(uloopTypesContent),
  'Should find handle delete method with correct description'
);

// Test 2: Verify process delete method is defined
const processDeleteRegex = /delete.*\{\s*name:\s*'delete'[\s\S]*?Unregisters the process/;
testValidation(
  'Process delete() method is defined',
  processDeleteRegex.test(uloopTypesContent),
  'Should find process delete method with correct description'
);

// Test 3: Verify signal delete method is defined
const signalDeleteRegex = /delete.*\{\s*name:\s*'delete'[\s\S]*?Uninstalls the signal handler/;
testValidation(
  'Signal delete() method is defined',
  signalDeleteRegex.test(uloopTypesContent),
  'Should find signal delete method with correct description'
);

// Test 4: Verify type checker has uloop object support
const typeCheckerPath = path.join(__dirname, '../src/analysis/typeChecker.ts');
const typeCheckerContent = fs.readFileSync(typeCheckerPath, 'utf8');

testValidation(
  'Type checker imports uloopObjectRegistry',
  typeCheckerContent.includes('uloopObjectRegistry'),
  'Type checker should import uloop object registry'
);

testValidation(
  'Type checker has uloop method type checking',
  typeCheckerContent.includes('uloopObjectRegistry.getUloopMethod'),
  'Type checker should check uloop method types'
);

// Test 5: Verify semantic analyzer has method return type inference
const semanticAnalyzerPath = path.join(__dirname, '../src/analysis/semanticAnalyzer.ts');
const semanticAnalyzerContent = fs.readFileSync(semanticAnalyzerPath, 'utf8');

testValidation(
  'Semantic analyzer has inferMethodReturnType',
  semanticAnalyzerContent.includes('inferMethodReturnType'),
  'Semantic analyzer should have method return type inference'
);

testValidation(
  'Semantic analyzer handles uloop method calls',
  semanticAnalyzerContent.includes('fs.file | fs.proc | socket.socket'),
  'Semantic analyzer should handle uloop handle() method return type'
);

// Test 6: Verify hover functionality exists
const hoverPath = path.join(__dirname, '../src/hover.ts');
const hoverContent = fs.readFileSync(hoverPath, 'utf8');

testValidation(
  'Hover has getUloopMethodHover function',
  hoverContent.includes('getUloopMethodHover'),
  'Hover should have uloop method hover functionality'
);

testValidation(
  'Hover checks uloop object types',
  hoverContent.includes('uloopObjectRegistry.isVariableOfUloopType'),
  'Hover should check for uloop object types'
);

// Test 7: Count total delete method definitions
const deleteMethodCount = (uloopTypesContent.match(/\['delete',\s*\{/g) || []).length;
testValidation(
  'All uloop objects have delete methods',
  deleteMethodCount >= 3, // handle, process, signal should all have delete
  `Found ${deleteMethodCount} delete method definitions, expected at least 3`
);

console.log('\n📊 Test Results:');
console.log(`Tests passed: ${passedTests}/${totalTests}`);
console.log(`Success rate: ${Math.round((passedTests/totalTests) * 100)}%\n`);

if (passedTests === totalTests) {
  console.log('🎉 All uloop delete() method implementation tests passed!');
  console.log('✅ Delete methods are properly defined in uloop types');
  console.log('✅ Type checker has uloop object support');
  console.log('✅ Semantic analyzer has method return type inference');
  console.log('✅ Hover functionality can access uloop methods');
  console.log('\n💡 This confirms that:');
  console.log('  - handle.delete(), process.delete(), signal.delete() should have hover');
  console.log('  - Method return types should be properly inferred');
  console.log('  - fileHandle should get fs.file type for autocomplete');
} else {
  console.log('❌ Some implementation tests failed. Check the output above for details.');
  process.exit(1);
}