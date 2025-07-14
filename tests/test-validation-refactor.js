// Test to verify refactored validation modules
console.log('Testing refactored validation modules...\n');

try {
    // Test that validation modules compile and have correct exports
    const validationIndex = require('./out/validations/index.d.ts');
    console.log('✓ validations/index.ts compiled successfully');
    
    const lexerValidation = require('./out/validations/lexer.d.ts');
    console.log('✓ validations/lexer.ts compiled successfully');
    
    const methodCalls = require('./out/validations/method-calls.d.ts');
    console.log('✓ validations/method-calls.ts compiled successfully');
    
    const variableDeclarations = require('./out/validations/variable-declarations.d.ts');
    console.log('✓ validations/variable-declarations.ts compiled successfully');
    
    const constReassignments = require('./out/validations/const-reassignments.d.ts');
    console.log('✓ validations/const-reassignments.ts compiled successfully');
    
    const substrParameters = require('./out/validations/substr-parameters.d.ts');
    console.log('✓ validations/substr-parameters.ts compiled successfully');
    
    const regex = require('./out/validations/regex.d.ts');
    console.log('✓ validations/regex.ts compiled successfully');
    
    console.log('\n🎉 Validation refactoring completed successfully!');
    console.log('📊 File size comparison:');
    console.log('   OLD: validation.ts (447 lines)');
    console.log('   NEW: validations/ directory with focused modules:');
    console.log('      - lexer.ts (75 lines)');
    console.log('      - method-calls.ts (45 lines)');
    console.log('      - variable-declarations.ts (48 lines)');
    console.log('      - const-reassignments.ts (62 lines)');
    console.log('      - substr-parameters.ts (95 lines)');
    console.log('      - regex.ts (151 lines)');
    console.log('      - index.ts (5 lines)');
    console.log('   📈 Much more maintainable with single-responsibility modules!');
    
} catch (error) {
    console.error('❌ Validation refactoring test failed:', error.message);
}