// Test the type inference functionality programmatically
const fs = require('fs');
const { UcodeLexer } = require('../src/lexer/ucodeLexer.ts');
const { UcodeParser } = require('../src/parser/ucodeParser.ts');
const { SemanticAnalyzer } = require('../src/analysis/semanticAnalyzer.ts');
const { UcodeType, typeToString } = require('../src/analysis/symbolTable.ts');

console.log('🧪 Testing type inference functionality...\n');

// Read the test file
const testCode = fs.readFileSync('./tests/test-type-inference.uc', 'utf8');

// Parse the code
const lexer = new UcodeLexer(testCode, { rawMode: true });
const tokens = lexer.tokenize();
const parser = new UcodeParser(tokens, testCode);
const parseResult = parser.parse();

if (!parseResult.ast) {
    console.log('❌ Parse failed');
    console.log('Errors:', parseResult.errors);
    process.exit(1);
}

console.log('✅ Parse successful');

// Create a mock text document
const mockTextDocument = {
    getText: () => testCode,
    positionAt: (offset) => {
        // Simple position calculation for testing
        let line = 0;
        let character = 0;
        for (let i = 0; i < offset && i < testCode.length; i++) {
            if (testCode[i] === '\n') {
                line++;
                character = 0;
            } else {
                character++;
            }
        }
        return { line, character };
    },
    offsetAt: (position) => {
        // Simple offset calculation for testing
        const lines = testCode.split('\n');
        let offset = 0;
        for (let i = 0; i < position.line && i < lines.length; i++) {
            offset += lines[i].length + 1; // +1 for newline
        }
        return offset + position.character;
    }
};

// Analyze the code
const analyzer = new SemanticAnalyzer(
    mockTextDocument,
    {
        enableTypeChecking: true,
        enableScopeAnalysis: true,
        enableControlFlowAnalysis: true,
        enableUnusedVariableDetection: true,
        enableShadowingWarnings: true,
    }
);

const analysisResult = analyzer.analyze(parseResult.ast);

console.log(`\n📊 Analysis complete with ${analysisResult.diagnostics.length} diagnostics`);

// Check the symbol table for inferred types
console.log('\n🔍 Symbol table results:');
console.log('=======================');

// Helper to convert UcodeType enum to string - now imported from symbolTable

// Test specific variables we expect to have inferred types
const testCases = [
    { name: 'x', expectedType: UcodeType.INTEGER },
    { name: 'name', expectedType: UcodeType.STRING },
    { name: 'isActive', expectedType: UcodeType.BOOLEAN },
    { name: 'price', expectedType: UcodeType.DOUBLE },
    { name: 'getScore', expectedTypeString: 'integer | double | null' }, // Union type
    { name: 'calculate', expectedType: UcodeType.INTEGER }, // Should be INTEGER based on usage
    { name: 'greet', expectedType: UcodeType.STRING },
    { name: 'doSomething', expectedType: UcodeType.NULL },
    { name: 'checkValue', expectedTypeString: 'string | integer' }, // Union type
];

let passed = 0;
let failed = 0;

testCases.forEach(testCase => {
    const symbol = analysisResult.symbolTable.lookup(testCase.name);
    if (symbol) {
        const actualTypeStr = typeToString(symbol.dataType);
        
        let isCorrect = false;
        let expectedStr = '';
        
        if (testCase.expectedType) {
            // Simple type comparison
            expectedStr = typeToString(testCase.expectedType);
            isCorrect = symbol.dataType === testCase.expectedType;
        } else if (testCase.expectedTypeString) {
            // Union type comparison
            expectedStr = testCase.expectedTypeString;
            isCorrect = actualTypeStr === testCase.expectedTypeString;
        }
        
        if (isCorrect) {
            console.log(`✅ ${testCase.name}: ${actualTypeStr} (correct)`);
            passed++;
        } else {
            console.log(`❌ ${testCase.name}: ${actualTypeStr} (expected: ${expectedStr})`);
            failed++;
        }
    } else {
        console.log(`❌ ${testCase.name}: NOT FOUND in symbol table`);
        failed++;
    }
});

console.log(`\n📈 Results: ${passed} passed, ${failed} failed`);

// Show all symbols for debugging
console.log('\n🔍 All symbols in symbol table:');
console.log('================================');
// Note: We'd need to add a method to iterate through all symbols
// For now, just show the diagnostics
if (analysisResult.diagnostics.length > 0) {
    console.log('\n⚠️  Diagnostics:');
    analysisResult.diagnostics.forEach((diag, i) => {
        console.log(`${i + 1}. ${diag.message}`);
    });
}

console.log('\n✅ Type inference test completed!');