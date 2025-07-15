#!/usr/bin/env node

// Test import statement parsing
const { UcodeParser } = require('../src/parser/index.ts');
const { UcodeLexer } = require('../src/lexer/index.ts');

console.log('🧪 Testing Import Statement Parsing...\n');

// Test cases for import statements
const testCases = [
    {
        name: 'Named import',
        code: 'import { run_command } from "../lib/commands.uc";',
        expected: 'ImportDeclaration'
    },
    {
        name: 'Multiple named imports',
        code: 'import { func1, func2 } from "./module.uc";',
        expected: 'ImportDeclaration'
    },
    {
        name: 'Named import with alias',
        code: 'import { run_command as cmd } from "../lib/commands.uc";',
        expected: 'ImportDeclaration'
    },
    {
        name: 'Namespace import',
        code: 'import * as utils from "./utils.uc";',
        expected: 'ImportDeclaration'
    },
    {
        name: 'Default import',
        code: 'import myModule from "./myModule.uc";',
        expected: 'ImportDeclaration'
    }
];

let passedTests = 0;
let totalTests = testCases.length;

testCases.forEach((testCase, index) => {
    console.log(`Test ${index + 1}: ${testCase.name}`);
    console.log(`  Code: ${testCase.code}`);
    
    try {
        const lexer = new UcodeLexer(testCase.code);
        const tokens = lexer.tokenize();
        
        const parser = new UcodeParser(tokens);
        const result = parser.parse();
        
        if (result.errors && result.errors.length > 0) {
            console.log(`  ❌ FAIL - Parser errors: ${result.errors.map(e => e.message).join(', ')}`);
        } else if (result.ast && result.ast.body.length > 0) {
            const statement = result.ast.body[0];
            if (statement.type === testCase.expected) {
                console.log(`  ✅ PASS - Parsed as ${statement.type}`);
                
                // Additional validation for import statements
                if (statement.type === 'ImportDeclaration') {
                    console.log(`    - Specifiers: ${statement.specifiers.length}`);
                    console.log(`    - Source: ${statement.source.value}`);
                    if (statement.specifiers.length > 0) {
                        console.log(`    - First specifier type: ${statement.specifiers[0].type}`);
                    }
                }
                
                passedTests++;
            } else {
                console.log(`  ❌ FAIL - Expected ${testCase.expected}, got ${statement.type}`);
            }
        } else {
            console.log(`  ❌ FAIL - No AST produced`);
        }
    } catch (error) {
        console.log(`  ❌ FAIL - Exception: ${error.message}`);
    }
    
    console.log('');
});

console.log('📊 Test Results:');
console.log(`${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
    console.log('🎉 All import statement parsing tests passed!');
} else {
    console.log('❌ Some tests failed');
}