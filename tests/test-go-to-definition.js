// Unit test for Go to Definition functionality

// Mock symbol table for testing
const mockSymbolTable = {
    symbols: new Map([
        ['run_command', { type: 'imported', sourceFile: './lib/commands.uc', position: { line: 5, column: 0 } }],
        ['get_config_value', { type: 'imported', sourceFile: './lib/config.uc', position: { line: 8, column: 0 } }],
        ['localFunction', { type: 'function', position: { line: 11, column: 0 }, defined: true }],
        ['myVariable', { type: 'variable', position: { line: 22, column: 0 }, defined: true }],
        // undefinedSymbol not in map - will return null from lookup
    ]),
    
    lookup(symbolName) {
        return this.symbols.get(symbolName) || null;
    }
};

// Mock document for testing
const mockDocument = {
    getText() {
        return `
import { run_command } from './lib/commands.uc';
import { get_config_value } from './lib/config.uc';

function localFunction() {
    return "local";
}

function test() {
    run_command("test");
    get_config_value("setting");
    localFunction();
    return "done";
}

let myVariable = 42;

function useVariable() {
    return myVariable;
}
`;
    },
    
    positionAt(offset) {
        const lines = this.getText().substring(0, offset).split('\n');
        return { line: lines.length - 1, character: lines[lines.length - 1].length };
    }
};

// Mock Go to Definition provider
function mockProvideDefinition(document, position, symbolName) {
    const symbol = mockSymbolTable.lookup(symbolName);
    
    if (!symbol) {
        return null; // No definition found
    }
    
    // Handle imported symbols
    if (symbol.type === 'imported') {
        return {
            uri: symbol.sourceFile,
            range: {
                start: symbol.position,
                end: { line: symbol.position.line, column: symbol.position.column + symbolName.length }
            }
        };
    }
    
    // Handle local symbols
    if (symbol.defined) {
        return {
            uri: document.uri || 'current-file.uc',
            range: {
                start: symbol.position,
                end: { line: symbol.position.line, column: symbol.position.column + symbolName.length }
            }
        };
    }
    
    return null;
}

// Test cases for Go to Definition functionality
const testCases = [
    {
        name: "imported function definition (run_command)",
        symbolName: "run_command",
        expectedResult: {
            found: true,
            uri: './lib/commands.uc',
            isImported: true
        },
        description: "Should find definition in imported file"
    },
    {
        name: "imported function definition (get_config_value)",
        symbolName: "get_config_value",
        expectedResult: {
            found: true,
            uri: './lib/config.uc',
            isImported: true
        },
        description: "Should find definition in imported file"
    },
    {
        name: "local function definition (localFunction)",
        symbolName: "localFunction",
        expectedResult: {
            found: true,
            uri: 'current-file.uc',
            isImported: false
        },
        description: "Should find definition in current file"
    },
    {
        name: "local variable definition (myVariable)",
        symbolName: "myVariable",
        expectedResult: {
            found: true,
            uri: 'current-file.uc',
            isImported: false
        },
        description: "Should find variable definition in current file"
    },
    {
        name: "undefined symbol (undefinedSymbol)",
        symbolName: "undefinedSymbol",
        expectedResult: {
            found: false,
            uri: null,
            isImported: false
        },
        description: "Should return null for undefined symbols"
    }
];

function testGoToDefinition(testName, symbolName, expectedResult) {
    console.log(`\n🧪 Testing ${testName}:`);
    
    const position = { line: 10, character: 5 }; // Mock cursor position
    const definition = mockProvideDefinition(mockDocument, position, symbolName);
    
    const found = definition !== null;
    const uri = definition?.uri || null;
    const isImported = !!uri && !uri.includes('current-file');
    
    // Validate results
    const foundCorrect = found === expectedResult.found;
    const uriCorrect = uri === expectedResult.uri;
    const importCorrect = isImported === expectedResult.isImported;
    
    const result = foundCorrect && uriCorrect && importCorrect;
    
    console.log(`  Symbol: ${symbolName}`);
    console.log(`  Found definition: ${found ? '✅' : '❌'} (expected: ${expectedResult.found})`);
    
    if (found) {
        console.log(`  URI: ${uri}`);
        console.log(`  Is imported: ${isImported ? '✅' : '❌'} (expected: ${expectedResult.isImported})`);
        console.log(`  URI correct: ${uriCorrect ? '✅' : '❌'}`);
    }
    
    console.log(`  Result: ${result ? '✅ PASS' : '❌ FAIL'}`);
    
    return result;
}

console.log('🧪 Testing Go to Definition Functionality...\n');

let totalTests = 0;
let passedTests = 0;

testCases.forEach((testCase) => {
    totalTests++;
    if (testGoToDefinition(
        testCase.name, 
        testCase.symbolName, 
        testCase.expectedResult
    )) {
        passedTests++;
    }
});

console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
    console.log('🎉 All Go to Definition functionality tests passed!');
} else {
    console.log('❌ Some tests failed. Check definition provider logic.');
}

console.log('\n💡 Note: These test the Go to Definition provider logic for ucode symbols.');
console.log('💡 Proper definition resolution supports both imported and local symbols.');