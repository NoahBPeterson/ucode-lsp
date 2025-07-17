// Final comprehensive test for all fs fixes
import { UcodeLexer } from '../src/lexer/ucodeLexer.ts';
import { UcodeParser } from '../src/parser/ucodeParser.ts';
import { SemanticAnalyzer } from '../src/analysis/semanticAnalyzer.ts';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { handleCompletion } from '../src/completion.ts';
import { typeToString } from '../src/analysis/symbolTable.ts';

console.log('🧪 Final Comprehensive Test for All FS Fixes\n');

// Test scenarios
const testScenarios = [
    {
        name: "User's exact scenario - undeclared variable",
        code: `file_content = open(constants.DT_HOSTINFO_FINAL_PATH, "r");
file_content.write("lol");`,
        variable: 'file_content',
        expectedType: 'fs.file',
        expectedMethods: ['read', 'write', 'close', 'seek', 'tell', 'flush'],
        expectedNonMethods: ['break', 'continue', 'uc', 'print', 'printf', 'length', 'let', 'const', 'if', 'for'],
        completionPos: { line: 1, character: 13 } // after dot in file_content.
    },
    {
        name: "Declared variable scenario",
        code: `let file_content = open(constants.DT_HOSTINFO_FINAL_PATH, "r");
file_content.write("lol");`,
        variable: 'file_content',
        expectedType: 'fs.file',
        expectedMethods: ['read', 'write', 'close', 'seek', 'tell', 'flush'],
        expectedNonMethods: ['break', 'continue', 'uc', 'print', 'printf', 'length', 'let', 'const', 'if', 'for'],
        completionPos: { line: 1, character: 13 }
    },
    {
        name: "Try-catch scenario",
        code: `let file_content;
try {
    file_content = open(constants.DT_HOSTINFO_FINAL_PATH, "r");
} catch (e) {
    print("Error: " + e);
}
file_content.read();`,
        variable: 'file_content',
        expectedType: 'fs.file',
        expectedMethods: ['read', 'write', 'close', 'seek', 'tell', 'flush'],
        expectedNonMethods: ['break', 'continue', 'uc', 'print', 'printf', 'length', 'let', 'const', 'if', 'for'],
        completionPos: { line: 6, character: 13 }
    }
];

// Mock components
const mockDocuments = {
    get: (uri) => {
        const scenario = testScenarios.find(s => uri.includes(s.name.replace(/[^a-zA-Z0-9]/g, '_')));
        if (scenario) {
            return TextDocument.create(uri, 'ucode', 1, scenario.code);
        }
        return null;
    }
};

const mockConnection = {
    console: {
        log: (message) => {} // Silent logging for cleaner output
    }
};

function testScenario(scenario) {
    console.log(`🔍 Testing: ${scenario.name}`);
    console.log(`Code:`);
    console.log(scenario.code);
    console.log('-'.repeat(50));
    
    try {
        // 1. Test semantic analysis and hover type
        const document = TextDocument.create(`test://${scenario.name.replace(/[^a-zA-Z0-9]/g, '_')}.uc`, 'ucode', 1, scenario.code);
        const lexer = new UcodeLexer(scenario.code, { rawMode: true });
        const tokens = lexer.tokenize();
        const parser = new UcodeParser(tokens);
        const ast = parser.parse();
        const analyzer = new SemanticAnalyzer(document);
        const result = analyzer.analyze(ast.ast);
        
        // Check symbol and type
        const symbol = result.symbolTable.lookup(scenario.variable);
        const actualType = symbol ? typeToString(symbol.dataType) : 'NOT_FOUND';
        const typeMatch = actualType === scenario.expectedType;
        
        console.log(`✅ Symbol found: ${symbol ? 'YES' : 'NO'}`);
        console.log(`✅ Hover type: ${actualType} (expected: ${scenario.expectedType}) ${typeMatch ? '✅' : '❌'}`);
        
        // Check diagnostics (should not include problematic ones)
        const diagnostics = result.diagnostics;
        const problematicDiags = diagnostics.filter(d => 
            d.message.includes('Undefined variable: ' + scenario.variable) ||
            d.message.includes('Undefined variable: write') ||
            d.message.includes('Undefined variable: read')
        );
        
        console.log(`✅ Problematic diagnostics: ${problematicDiags.length === 0 ? 'NONE' : problematicDiags.map(d => d.message).join(', ')} ${problematicDiags.length === 0 ? '✅' : '❌'}`);
        
        // 2. Test completion
        const params = {
            textDocument: { uri: document.uri },
            position: scenario.completionPos
        };
        
        const completions = handleCompletion(params, mockDocuments, mockConnection, result);
        const foundMethods = completions.filter(c => scenario.expectedMethods.includes(c.label));
        const foundNonMethods = completions.filter(c => scenario.expectedNonMethods.includes(c.label));
        const foundBuiltins = completions.filter(c => ['print', 'printf', 'length'].includes(c.label));
        const foundKeywords = completions.filter(c => ['let', 'const', 'if', 'for'].includes(c.label));
        
        console.log(`✅ Completion count: ${completions.length}`);
        console.log(`✅ FS methods found: ${foundMethods.length}/${scenario.expectedMethods.length} ${foundMethods.length >= 3 ? '✅' : '❌'}`);
        console.log(`✅ Non-methods found: ${foundNonMethods.length} (should be 0) ${foundNonMethods.length === 0 ? '✅' : '❌'}`);
        console.log(`✅ Builtin functions: ${foundBuiltins.length} ${foundBuiltins.length === 0 ? '✅' : '❌'}`);
        console.log(`✅ Keywords: ${foundKeywords.length} ${foundKeywords.length === 0 ? '✅' : '❌'}`);
        
        // Overall result
        const success = typeMatch && problematicDiags.length === 0 && foundMethods.length >= 3 && foundNonMethods.length === 0 && foundBuiltins.length === 0 && foundKeywords.length === 0;
        console.log(`\n🎯 Result: ${success ? '✅ PASS' : '❌ FAIL'}\n`);
        
        return success;
        
    } catch (error) {
        console.log(`❌ ERROR: ${error.message}\n`);
        return false;
    }
}

// Run all tests
console.log('='.repeat(60));
console.log('🚀 RUNNING ALL SCENARIOS');
console.log('='.repeat(60));

let totalTests = 0;
let passedTests = 0;

testScenarios.forEach(scenario => {
    totalTests++;
    if (testScenario(scenario)) {
        passedTests++;
    }
});

console.log('='.repeat(60));
console.log('📊 FINAL RESULTS');
console.log('='.repeat(60));

if (passedTests === totalTests) {
    console.log(`\n🎉 ALL ${totalTests} TESTS PASSED! 🎉`);
    console.log('\n✅ User issues completely resolved:');
    console.log('   ✅ Hover shows "fs.file" instead of "object|null"');
    console.log('   ✅ Completion shows only fs.file methods (no builtins/keywords)');
    console.log('   ✅ No error diagnostics on write() method');
    console.log('   ✅ Works with both declared and undeclared variables');
    console.log('   ✅ Works with try-catch assignments');
    console.log('\n🚀 The uCode LSP fs object support is now fully functional!');
} else {
    console.log(`\n⚠️  ${totalTests - passedTests}/${totalTests} tests failed`);
    console.log('Some issues may still need to be addressed.');
}

console.log(`\nTest Status: ${passedTests === totalTests ? 'SUCCESS' : 'NEEDS_WORK'}`);