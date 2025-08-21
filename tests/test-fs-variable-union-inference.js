// Test that variables assigned from fs function calls get the correct union types
console.log('🧪 Testing FS Variable Union Type Inference...\n');

// This is a mock test since we can't easily run the full LSP analysis
// In practice, this would test the semantic analyzer integration

// Mock the semantic analyzer behavior
const { SymbolTable, SymbolType, UcodeType, createUnionType } = require('../src/analysis/symbolTable');
const { fsModuleTypeRegistry } = require('../src/analysis/fsModuleTypes');

// Mock a simple scenario
function testVariableTypeInference() {
  console.log('🧪 Testing variable type inference for fs function calls:');
  
  // Simulate what should happen when we process:
  // import { chmod } from 'fs';
  // let result = chmod("/path", 0o755);
  
  // Check that chmod function returns the correct type info
  const chmodFunc = fsModuleTypeRegistry.getFunction('chmod');
  if (!chmodFunc) {
    console.log('  ❌ FAIL: chmod function not found');
    return false;
  }
  
  console.log(`  chmod() return type: "${chmodFunc.returnType}"`);
  
  // Test that we can parse the union type correctly
  const returnTypeStr = chmodFunc.returnType;
  if (returnTypeStr.includes(' | ')) {
    const types = returnTypeStr.split(' | ').map(s => s.trim());
    console.log(`  Parsed union types: [${types.join(', ')}]`);
    
    // Test that it includes both boolean and null
    const hasBoolean = types.includes('boolean');
    const hasNull = types.includes('null');
    
    console.log(`  Contains boolean: ${hasBoolean}`);
    console.log(`  Contains null: ${hasNull}`);
    
    if (hasBoolean && hasNull) {
      console.log('  Result: ✅ PASS - Union type correctly parsed');
      return true;
    } else {
      console.log('  Result: ❌ FAIL - Union type missing expected components');
      return false;
    }
  } else {
    console.log('  Result: ❌ FAIL - Not a union type');
    return false;
  }
}

function testUnionTypeCreation() {
  console.log('\n🧪 Testing union type creation:');
  
  try {
    // Test that we can create union types with the available functions
    const unionType = createUnionType([UcodeType.BOOLEAN, UcodeType.NULL]);
    console.log('  Union type created successfully');
    
    // Check that it has the union property
    if (unionType && typeof unionType === 'object' && 'types' in unionType) {
      console.log(`  Union contains types: [${unionType.types.join(', ')}]`);
      console.log('  Result: ✅ PASS - Union type creation works');
      return true;
    } else {
      console.log('  Result: ❌ FAIL - Union type structure incorrect');
      return false;
    }
  } catch (error) {
    console.log(`  Result: ❌ FAIL - Error creating union type: ${error.message}`);
    return false;
  }
}

// Run the tests
let totalTests = 0;
let passedTests = 0;

if (testVariableTypeInference()) passedTests++;
totalTests++;

if (testUnionTypeCreation()) passedTests++;
totalTests++;

console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
  console.log('🎉 Variable union type inference tests passed!');
  console.log('\n✨ Summary:');
  console.log('  • fs.chmod() correctly returns "boolean | null"');
  console.log('  • Union type parsing works correctly');
  console.log('  • Union type creation functions work');
  console.log('  • Variable assignments should now get proper union types');
} else {
  console.log('❌ Some variable type inference tests failed.');
}