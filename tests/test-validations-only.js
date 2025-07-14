// Test individual validation functions without language server
const { UcodeLexer, TokenType } = require('./out/lexer.js');
const { validateStringAnalysisFunctions } = require('./out/validations/string-analysis.js');
const { validateArrayFunctions } = require('./out/validations/array-functions.js');
const { validateObjectFunctions } = require('./out/validations/object-functions.js');
const { validateNumberConversions } = require('./out/validations/number-conversions.js');

// Mock text document
function createMockDocument(content) {
    return {
        getText: () => content,
        positionAt: (offset) => ({ line: 0, character: offset })
    };
}

function testValidation(testName, code, validationFunction) {
    console.log(`\n🧪 Testing ${testName}:`);
    console.log(`Code: ${code}`);
    
    try {
        const lexer = new UcodeLexer(code, { rawMode: true });
        const tokens = lexer.tokenize();
        const document = createMockDocument(code);
        const diagnostics = [];
        
        validationFunction(document, tokens, diagnostics);
        
        console.log(`Found ${diagnostics.length} diagnostic(s):`);
        diagnostics.forEach((diag, i) => {
            console.log(`  ${i + 1}. ${diag.message}`);
        });
        
        return diagnostics.length;
    } catch (error) {
        console.error(`Error during test: ${error.message}`);
        return -1;
    }
}

console.log('🧪 Testing individual validation functions...\n');

// Test string analysis functions
let errors = 0;

errors = testValidation('String Analysis - length with number', 'length(123);', validateStringAnalysisFunctions);
console.log(errors > 0 ? '✅ PASS: Found expected error' : '❌ FAIL: No error found');

errors = testValidation('String Analysis - index with number', 'index(456, "needle");', validateStringAnalysisFunctions);
console.log(errors > 0 ? '✅ PASS: Found expected error' : '❌ FAIL: No error found');

errors = testValidation('String Analysis - valid length', 'length("hello");', validateStringAnalysisFunctions);
console.log(errors === 0 ? '✅ PASS: No errors as expected' : '❌ FAIL: Unexpected error found');

// Test array functions
errors = testValidation('Array Functions - filter with string', 'filter("string", func);', validateArrayFunctions);
console.log(errors > 0 ? '✅ PASS: Found expected error' : '❌ FAIL: No error found');

errors = testValidation('Array Functions - filter with number as second param', 'filter(arr, 123);', validateArrayFunctions);
console.log(errors > 0 ? '✅ PASS: Found expected error' : '❌ FAIL: No error found');

errors = testValidation('Array Functions - valid filter', 'filter(myArray, myFunc);', validateArrayFunctions);
console.log(errors === 0 ? '✅ PASS: No errors as expected' : '❌ FAIL: Unexpected error found');

// Test object functions
errors = testValidation('Object Functions - keys with string', 'keys("string");', validateObjectFunctions);
console.log(errors > 0 ? '✅ PASS: Found expected error' : '❌ FAIL: No error found');

errors = testValidation('Object Functions - valid keys', 'keys(myObj);', validateObjectFunctions);
console.log(errors === 0 ? '✅ PASS: No errors as expected' : '❌ FAIL: Unexpected error found');

// Test number conversion functions
errors = testValidation('Number Conversions - hex with string', 'hex("string");', validateNumberConversions);
console.log(errors > 0 ? '✅ PASS: Found expected error' : '❌ FAIL: No error found');

errors = testValidation('Number Conversions - valid hex', 'hex(255);', validateNumberConversions);
console.log(errors === 0 ? '✅ PASS: No errors as expected' : '❌ FAIL: Unexpected error found');

console.log('\n🏁 Individual validation testing completed!');