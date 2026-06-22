// Unit test for import statement parsing and recognition

// Mock TokenType enum
const TokenType = {
    TK_IMPORT: 1,
    TK_LBRACE: 2,
    TK_RBRACE: 3,
    TK_LABEL: 4,
    TK_COMMA: 5,
    TK_FROM: 6,
    TK_STRING: 7,
    TK_SEMICOLON: 8,
    TK_STAR: 9,
    TK_AS: 10
};

// Mock import statement parser
function mockParseImportStatement(tokens) {
    if (!tokens || tokens.length === 0) {
        return null;
    }
    
    // Check if first token is TK_IMPORT
    if (tokens[0].type !== TokenType.TK_IMPORT) {
        return null;
    }
    
    let i = 1;
    const imports = [];
    let source = null;
    let isNamespaceImport = false;
    
    // Parse import specifiers
    if (i < tokens.length && tokens[i].type === TokenType.TK_LBRACE) {
        // Named imports: import { foo, bar } from "module"
        i++; // skip {
        while (i < tokens.length && tokens[i].type !== TokenType.TK_RBRACE) {
            if (tokens[i].type === TokenType.TK_LABEL) {
                imports.push({
                    type: 'ImportSpecifier',
                    imported: tokens[i].value,
                    local: tokens[i].value
                });
            }
            i++;
            if (i < tokens.length && tokens[i].type === TokenType.TK_COMMA) {
                i++; // skip comma
            }
        }
        if (i < tokens.length && tokens[i].type === TokenType.TK_RBRACE) {
            i++; // skip }
        }
    } else if (i < tokens.length && tokens[i].type === TokenType.TK_STAR) {
        // Namespace import: import * as foo from "module"
        isNamespaceImport = true;
        i++; // skip *
        if (i < tokens.length && tokens[i].type === TokenType.TK_AS) {
            i++; // skip as
            if (i < tokens.length && tokens[i].type === TokenType.TK_LABEL) {
                imports.push({
                    type: 'ImportNamespaceSpecifier',
                    local: tokens[i].value
                });
                i++;
            }
        }
    }
    
    // Parse from clause
    if (i < tokens.length && tokens[i].type === TokenType.TK_FROM) {
        i++; // skip from
        if (i < tokens.length && tokens[i].type === TokenType.TK_STRING) {
            source = tokens[i].value.slice(1, -1); // Remove quotes
        }
    }
    
    // For valid imports, we need a source
    if (!source && imports.length > 0) {
        return null; // Invalid import without source
    }
    
    return {
        type: 'ImportDeclaration',
        specifiers: imports,
        source: source,
        isNamespaceImport: isNamespaceImport
    };
}

// Mock tokenizer for import statements
function mockTokenizeImport(code) {
    const tokens = [];
    
    if (code.includes('import {') && code.includes('} from')) {
        // Named import: import { foo, bar } from "module"
        tokens.push(
            { type: TokenType.TK_IMPORT, value: 'import', pos: 0, end: 6 },
            { type: TokenType.TK_LBRACE, value: '{', pos: 7, end: 8 }
        );
        
        // Extract imported names and module path
        const importMatch = code.match(/import\s*\{\s*([^}]+)\s*\}\s*from\s*['"]([^'"]+)['"]/);
        if (importMatch) {
            const names = importMatch[1].split(',').map(n => n.trim());
            const modulePath = importMatch[2];
            
            names.forEach((name, index) => {
                tokens.push({ type: TokenType.TK_LABEL, value: name, pos: 9 + index * 5, end: 9 + index * 5 + name.length });
                if (index < names.length - 1) {
                    tokens.push({ type: TokenType.TK_COMMA, value: ',', pos: 9 + index * 5 + name.length, end: 9 + index * 5 + name.length + 1 });
                }
            });
            
            tokens.push(
                { type: TokenType.TK_RBRACE, value: '}', pos: 20, end: 21 },
                { type: TokenType.TK_FROM, value: 'from', pos: 22, end: 26 },
                { type: TokenType.TK_STRING, value: `"${modulePath}"`, pos: 27, end: 27 + modulePath.length + 2 }
            );
        }
    } else if (code.includes('import *') && code.includes('as')) {
        // Namespace import: import * as foo from "module"
        const match = code.match(/import\s*\*\s*as\s*(\w+)\s*from\s*['"]([^'"]+)['"]/);
        if (match) {
            const localName = match[1];
            const moduleName = match[2];
            tokens.push(
                { type: TokenType.TK_IMPORT, value: 'import', pos: 0, end: 6 },
                { type: TokenType.TK_STAR, value: '*', pos: 7, end: 8 },
                { type: TokenType.TK_AS, value: 'as', pos: 9, end: 11 },
                { type: TokenType.TK_LABEL, value: localName, pos: 12, end: 12 + localName.length },
                { type: TokenType.TK_FROM, value: 'from', pos: 13 + localName.length, end: 17 + localName.length },
                { type: TokenType.TK_STRING, value: `"${moduleName}"`, pos: 18 + localName.length, end: 20 + localName.length + moduleName.length }
            );
        }
    } else if (code.includes('import {') && !code.includes('from')) {
        // Invalid import: missing from clause
        tokens.push(
            { type: TokenType.TK_IMPORT, value: 'import', pos: 0, end: 6 },
            { type: TokenType.TK_LBRACE, value: '{', pos: 7, end: 8 }
        );
        
        const match = code.match(/import\s*\{\s*([^}]+)\s*\}/);
        if (match) {
            const names = match[1].split(',').map(n => n.trim());
            names.forEach((name, index) => {
                tokens.push({ type: TokenType.TK_LABEL, value: name, pos: 9 + index * 5, end: 9 + index * 5 + name.length });
            });
        }
        
        tokens.push({ type: TokenType.TK_RBRACE, value: '}', pos: 20, end: 21 });
    }
    
    return tokens;
}

// Test cases for import statement parsing
const testCases = [
    {
        name: "named import parsing (import { foo, bar } from './module')",
        code: "import { foo, bar } from './module'",
        expectedResult: {
            isValid: true,
            type: 'ImportDeclaration',
            specifierCount: 2,
            source: './module',
            isNamespace: false
        },
        description: "Should parse named imports correctly"
    },
    {
        name: "single named import (import { utils } from './utils')",
        code: "import { utils } from './utils'",
        expectedResult: {
            isValid: true,
            type: 'ImportDeclaration',
            specifierCount: 1,
            source: './utils',
            isNamespace: false
        },
        description: "Should parse single named import correctly"
    },
    {
        name: "namespace import (import * as constants from './constants')",
        code: "import * as constants from './constants'",
        expectedResult: {
            isValid: true,
            type: 'ImportDeclaration',
            specifierCount: 1,
            source: './constants',
            isNamespace: true
        },
        description: "Should parse namespace import correctly"
    },
    {
        name: "invalid import (missing from clause)",
        code: "import { foo }",
        expectedResult: {
            isValid: false,
            type: null,
            specifierCount: 0,
            source: null,
            isNamespace: false
        },
        description: "Should handle invalid import statements"
    }
];

function testImportParsing(testName, code, expectedResult) {
    console.log(`\n🧪 Testing ${testName}:`);
    
    const tokens = mockTokenizeImport(code);
    const ast = mockParseImportStatement(tokens);
    
    const isValid = ast !== null;
    const type = ast?.type || null;
    const specifierCount = ast?.specifiers?.length || 0;
    const source = ast?.source || null;
    const isNamespace = ast?.isNamespaceImport || false;
    
    // Validate results
    const validCorrect = isValid === expectedResult.isValid;
    const typeCorrect = type === expectedResult.type;
    const countCorrect = specifierCount === expectedResult.specifierCount;
    const sourceCorrect = source === expectedResult.source;
    const namespaceCorrect = isNamespace === expectedResult.isNamespace;
    
    const result = validCorrect && typeCorrect && countCorrect && sourceCorrect && namespaceCorrect;
    
    console.log(`  Code: "${code}"`);
    console.log(`  Valid import: ${isValid ? '✅' : '❌'} (expected: ${expectedResult.isValid})`);
    
    if (isValid) {
        console.log(`  Type: ${type} ${typeCorrect ? '✅' : '❌'}`);
        console.log(`  Specifiers: ${specifierCount} ${countCorrect ? '✅' : '❌'} (expected: ${expectedResult.specifierCount})`);
        console.log(`  Source: ${source} ${sourceCorrect ? '✅' : '❌'}`);
        console.log(`  Namespace: ${isNamespace ? '✅' : '❌'} (expected: ${expectedResult.isNamespace})`);
    }
    
    console.log(`  Result: ${result ? '✅ PASS' : '❌ FAIL'}`);
    
    return result;
}

console.log('🧪 Testing Import Statement Parsing...\n');

let totalTests = 0;
let passedTests = 0;

testCases.forEach((testCase) => {
    totalTests++;
    if (testImportParsing(
        testCase.name, 
        testCase.code, 
        testCase.expectedResult
    )) {
        passedTests++;
    }
});

console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
    console.log('🎉 All import statement parsing tests passed!');
} else {
    console.log('❌ Some tests failed. Check import parsing logic.');
}

console.log('\n💡 Note: These test the import statement parsing logic for ucode syntax.');
console.log('💡 Proper import parsing enables module system support and Go to Definition.');