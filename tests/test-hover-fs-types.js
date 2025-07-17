// Test hover information for fs types
import { UcodeLexer } from '../src/lexer/ucodeLexer.ts';
import { UcodeParser } from '../src/parser/ucodeParser.ts';
import { SemanticAnalyzer } from '../src/analysis/semanticAnalyzer.ts';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { typeToString } from '../src/analysis/symbolTable.ts';

console.log('🧪 Testing Hover Type Display for FS Objects\n');

function testHoverTypeDisplay(testName, code, variableName, expectedType) {
    console.log(`🔍 Testing ${testName}:`);
    console.log(`  Code: ${code}`);
    
    try {
        const document = TextDocument.create('test://test.uc', 'ucode', 1, code);
        const lexer = new UcodeLexer(code, { rawMode: true });
        const tokens = lexer.tokenize();
        const parser = new UcodeParser(tokens);
        const ast = parser.parse();
        const analyzer = new SemanticAnalyzer(document);
        const result = analyzer.analyze(ast.ast);
        
        const symbol = result.symbolTable.lookup(variableName);
        if (symbol) {
            const displayType = typeToString(symbol.dataType);
            console.log(`  Expected: ${expectedType}`);
            console.log(`  Actual: ${displayType}`);
            
            if (displayType === expectedType) {
                console.log(`  Result: ✅ PASS`);
                return true;
            } else {
                console.log(`  Result: ❌ FAIL`);
                return false;
            }
        } else {
            console.log(`  Result: ❌ FAIL - Variable ${variableName} not found`);
            return false;
        }
    } catch (error) {
        console.log(`  Result: ❌ FAIL - Error: ${error.message}`);
        return false;
    }
}

// Test cases
const testCases = [
    {
        name: "fs.file from open() direct assignment",
        code: 'let file = open("test.txt", "r");',
        variable: 'file',
        expectedType: 'fs.file'
    },
    {
        name: "fs.file from open() separate assignment",
        code: 'let file_content; file_content = open("test.txt", "r");',
        variable: 'file_content',
        expectedType: 'fs.file'
    },
    {
        name: "fs.dir from opendir()",
        code: 'let dir = opendir("/tmp");',
        variable: 'dir',
        expectedType: 'fs.dir'
    },
    {
        name: "fs.proc from popen()",
        code: 'let proc = popen("ls", "r");',
        variable: 'proc',
        expectedType: 'fs.proc'
    },
    {
        name: "fs.file from fdopen()",
        code: 'let fd = fdopen(1, "w");',
        variable: 'fd',
        expectedType: 'fs.file'
    },
    {
        name: "fs.file from mkstemp()",
        code: 'let temp = mkstemp("tmpXXXXXX");',
        variable: 'temp',
        expectedType: 'fs.file'
    },
    {
        name: "user scenario - try block assignment",
        code: `let file_content;
try {
    file_content = open(constants.DT_HOSTINFO_FINAL_PATH, "r");
} catch (e) {
    print("Error: " + e);
}`,
        variable: 'file_content',
        expectedType: 'fs.file'
    }
];

let totalTests = 0;
let passedTests = 0;

testCases.forEach((testCase) => {
    totalTests++;
    if (testHoverTypeDisplay(testCase.name, testCase.code, testCase.variable, testCase.expectedType)) {
        passedTests++;
    }
    console.log(''); // Add spacing
});

console.log('='.repeat(60));
console.log('📊 HOVER TYPE DISPLAY TEST RESULTS');
console.log('='.repeat(60));
console.log(`Tests passed: ${passedTests}/${totalTests}`);

if (passedTests === totalTests) {
    console.log('\n🎉 ALL HOVER TYPE TESTS PASSED! 🎉');
    console.log('✅ Hover will now show "fs.file" instead of "object"');
    console.log('✅ All fs object types display correctly in hover');
    console.log('✅ Assignment expression type inference working correctly');
    console.log('\n💡 The user\'s hover issue is now fixed!');
    console.log('   Hovering over file_content will show: fs.file');
} else {
    console.log('\n❌ Some hover type tests failed');
    console.log('⚠️  Hover display may still need work');
}

console.log(`\nTest Status: ${passedTests === totalTests ? 'PASS' : 'FAIL'}`);