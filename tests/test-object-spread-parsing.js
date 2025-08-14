// Test suite for object spread parsing
console.log('🔧 Running Object Spread Parsing Tests...\n');

const { UcodeLexer } = require('../src/lexer/ucodeLexer');
const { UcodeParser } = require('../src/parser/ucodeParser');

const testCases = [
    {
        name: "Simple object literal",
        code: "let obj = {name: 'test'};",
        shouldError: false,
        description: "Basic object should parse without errors"
    },
    {
        name: "Object with spread element",
        code: "let obj = {...testcase};",
        shouldError: false,
        description: "Object spread should be supported"
    },
    {
        name: "Object with spread and additional property",
        code: "let obj = {...testcase, code: section[1]};",
        shouldError: false,
        description: "Mixed spread and regular properties should work"
    },
    {
        name: "Complex nested expression",
        code: "push(testcases ??= [], { ...testcase, code: section[1] });",
        shouldError: false,
        description: "The exact problematic syntax should parse correctly"
    }
];

function testObjectSpreadParsing(testName, code, shouldError, description) {
    console.log(`\n🧪 Testing ${testName}:`);
    console.log(`  Code: ${code}`);
    console.log(`  Description: ${description}`);
    
    try {
        // Tokenize
        const lexer = new UcodeLexer(code, { rawMode: true });
        const tokens = lexer.tokenize();
        
        // Parse
        const parser = new UcodeParser(tokens);
        const ast = parser.parse();
        
        console.log(`  Parsing successful: AST has ${ast.body?.length || 0} statements`);
        
        if (shouldError) {
            console.log(`  Result: ❌ FAIL - Expected parsing error but got success`);
            return false;
        } else {
            console.log(`  Result: ✅ PASS - Parsed successfully as expected`);
            return true;
        }
    } catch (error) {
        console.log(`  Parsing error: ${error.message}`);
        
        if (shouldError) {
            console.log(`  Result: ✅ PASS - Expected parsing error occurred`);
            return true;
        } else {
            console.log(`  Result: ❌ FAIL - Unexpected parsing error`);
            return false;
        }
    }
}

// Run all tests
let totalTests = 0;
let passedTests = 0;

testCases.forEach((testCase) => {
    totalTests++;
    if (testObjectSpreadParsing(
        testCase.name,
        testCase.code,
        testCase.shouldError,
        testCase.description
    )) {
        passedTests++;
    }
});

console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
    console.log('🎉 All object spread parsing tests passed!');
} else {
    console.log('❌ Some tests failed. Check the output above for details.');
    process.exit(1);
}