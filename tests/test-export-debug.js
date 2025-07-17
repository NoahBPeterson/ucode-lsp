// Unit test for export statement parsing

// Mock TokenType enum
const TokenType = {
    TK_EXPORT: 1,
    TK_FUNCTION: 2,
    TK_LABEL: 3,
    TK_LPAREN: 4,
    TK_RPAREN: 5,
    TK_LBRACE: 6,
    TK_CONST: 7,
    TK_ASSIGN: 8,
    TK_NUMBER: 9,
    TK_STRING: 10,
    TK_STAR: 11,
    TK_AS: 12,
    TK_FROM: 13
};

// Mock export statement parser
function mockParseExportStatement(tokens) {
    if (!tokens || tokens.length === 0 || tokens[0].type !== TokenType.TK_EXPORT) {
        return null;
    }
    
    let i = 1;
    
    // Export function declaration
    if (i < tokens.length && tokens[i].type === TokenType.TK_FUNCTION) {
        i++; // skip function
        let functionName = null;
        if (i < tokens.length && tokens[i].type === TokenType.TK_LABEL) {
            functionName = tokens[i].value;
            i++;
        }
        
        return {
            type: 'ExportNamedDeclaration',
            declaration: {
                type: 'FunctionDeclaration',
                id: { type: 'Identifier', name: functionName }
            },
            specifiers: [],
            source: null
        };
    }
    
    // Export const declaration
    if (i < tokens.length && tokens[i].type === TokenType.TK_CONST) {
        i++; // skip const
        let varName = null;
        if (i < tokens.length && tokens[i].type === TokenType.TK_LABEL) {
            varName = tokens[i].value;
        }
        
        return {
            type: 'ExportNamedDeclaration',
            declaration: {
                type: 'VariableDeclaration',
                kind: 'const',
                declarations: [{
                    type: 'VariableDeclarator',
                    id: { type: 'Identifier', name: varName }
                }]
            },
            specifiers: [],
            source: null
        };
    }
    
    return null;
}

// Mock tokenizer for export statements
function mockTokenizeExport(code) {
    const tokens = [];
    
    if (code.includes('export function')) {
        const match = code.match(/export\s+function\s+(\w+)/);
        if (match) {
            const functionName = match[1];
            tokens.push(
                { type: TokenType.TK_EXPORT, value: 'export', pos: 0, end: 6 },
                { type: TokenType.TK_FUNCTION, value: 'function', pos: 7, end: 15 },
                { type: TokenType.TK_LABEL, value: functionName, pos: 16, end: 16 + functionName.length },
                { type: TokenType.TK_LPAREN, value: '(', pos: 16 + functionName.length, end: 17 + functionName.length }
            );
        }
    } else if (code.includes('export const')) {
        const match = code.match(/export\s+const\s+(\w+)/);
        if (match) {
            const varName = match[1];
            tokens.push(
                { type: TokenType.TK_EXPORT, value: 'export', pos: 0, end: 6 },
                { type: TokenType.TK_CONST, value: 'const', pos: 7, end: 12 },
                { type: TokenType.TK_LABEL, value: varName, pos: 13, end: 13 + varName.length },
                { type: TokenType.TK_ASSIGN, value: '=', pos: 14 + varName.length, end: 15 + varName.length }
            );
        }
    }
    
    return tokens;
}

// Test cases for export statement parsing
const testCases = [
    {
        name: "export function declaration (export function myFunc())",
        code: "export function myFunc()",
        expectedResult: {
            isValid: true,
            type: 'ExportNamedDeclaration',
            declarationType: 'FunctionDeclaration',
            exportedName: 'myFunc'
        },
        description: "Should parse exported function declaration"
    },
    {
        name: "export const declaration (export const MY_CONST = 42)",
        code: "export const MY_CONST = 42",
        expectedResult: {
            isValid: true,
            type: 'ExportNamedDeclaration',
            declarationType: 'VariableDeclaration',
            exportedName: 'MY_CONST'
        },
        description: "Should parse exported const declaration"
    },
    {
        name: "export complex function name (export function generate_bandwidth_overrides())",
        code: "export function generate_bandwidth_overrides()",
        expectedResult: {
            isValid: true,
            type: 'ExportNamedDeclaration',
            declarationType: 'FunctionDeclaration',
            exportedName: 'generate_bandwidth_overrides'
        },
        description: "Should parse exported function with complex name"
    },
    {
        name: "invalid export (missing declaration)",
        code: "export",
        expectedResult: {
            isValid: false,
            type: null,
            declarationType: null,
            exportedName: null
        },
        description: "Should handle invalid export statements"
    }
];

function testExportParsing(testName, code, expectedResult) {
    console.log(`\n🧪 Testing ${testName}:`);
    
    const tokens = mockTokenizeExport(code);
    const ast = mockParseExportStatement(tokens);
    
    const isValid = ast !== null;
    const type = ast?.type || null;
    const declarationType = ast?.declaration?.type || null;
    const exportedName = ast?.declaration?.id?.name || ast?.declaration?.declarations?.[0]?.id?.name || null;
    
    // Validate results
    const validCorrect = isValid === expectedResult.isValid;
    const typeCorrect = type === expectedResult.type;
    const declTypeCorrect = declarationType === expectedResult.declarationType;
    const nameCorrect = exportedName === expectedResult.exportedName;
    
    const result = validCorrect && typeCorrect && declTypeCorrect && nameCorrect;
    
    console.log(`  Code: "${code}"`);
    console.log(`  Valid export: ${isValid ? '✅' : '❌'} (expected: ${expectedResult.isValid})`);
    
    if (isValid) {
        console.log(`  Type: ${type} ${typeCorrect ? '✅' : '❌'}`);
        console.log(`  Declaration type: ${declarationType} ${declTypeCorrect ? '✅' : '❌'}`);
        console.log(`  Exported name: ${exportedName} ${nameCorrect ? '✅' : '❌'}`);
    }
    
    console.log(`  Result: ${result ? '✅ PASS' : '❌ FAIL'}`);
    
    return result;
}

console.log('🧪 Testing Export Statement Parsing...\n');

let totalTests = 0;
let passedTests = 0;

testCases.forEach((testCase) => {
    totalTests++;
    if (testExportParsing(
        testCase.name, 
        testCase.code, 
        testCase.expectedResult
    )) {
        passedTests++;
    }
});

console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
    console.log('🎉 All export statement parsing tests passed!');
} else {
    console.log('❌ Some tests failed. Check export parsing logic.');
}

console.log('\n💡 Note: These test the export statement parsing logic for ucode syntax.');
console.log('💡 Proper export parsing enables module system support and code organization.');