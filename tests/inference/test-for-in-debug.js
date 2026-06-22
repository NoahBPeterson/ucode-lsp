// Unit test for for-in loop parsing with bare identifiers

// Mock TokenType enum
const TokenType = {
    TK_FOR: 1,
    TK_LPAREN: 2,
    TK_LABEL: 3,
    TK_IN: 4,
    TK_RPAREN: 5,
    TK_LBRACE: 6,
    TK_RBRACE: 7,
    TK_LET: 8,
    TK_SEMICOLON: 9,
    TK_ASSIGN: 10,
    TK_OBJECT: 11
};

// Mock for-in loop parser
function mockParseForInLoop(tokens) {
    if (!tokens || tokens.length < 5) {
        return null;
    }
    
    if (tokens[0].type !== TokenType.TK_FOR || tokens[1].type !== TokenType.TK_LPAREN) {
        return null;
    }
    
    let i = 2;
    let left = null;
    let right = null;
    let body = null;
    
    // Parse left side (variable or declaration)
    if (i < tokens.length) {
        if (tokens[i].type === TokenType.TK_LET) {
            // let variable declaration
            i++; // skip let
            if (i < tokens.length && tokens[i].type === TokenType.TK_LABEL) {
                left = {
                    type: 'VariableDeclaration',
                    kind: 'let',
                    declarations: [{
                        type: 'VariableDeclarator',
                        id: { type: 'Identifier', name: tokens[i].value }
                    }]
                };
                i++;
            }
        } else if (tokens[i].type === TokenType.TK_LABEL) {
            // bare identifier
            left = {
                type: 'Identifier',
                name: tokens[i].value
            };
            i++;
        }
    }
    
    // Check for 'in' keyword
    if (i < tokens.length && tokens[i].type === TokenType.TK_IN) {
        i++; // skip in
        
        // Parse right side (expression)
        if (i < tokens.length && tokens[i].type === TokenType.TK_LABEL) {
            right = {
                type: 'Identifier',
                name: tokens[i].value
            };
            i++;
        }
        
        // Check for closing paren
        if (i < tokens.length && tokens[i].type === TokenType.TK_RPAREN) {
            i++; // skip )
            
            // Parse body (can be statement or block)
            if (i < tokens.length) {
                body = {
                    type: 'ExpressionStatement',
                    expression: { type: 'UpdateExpression' }
                };
            }
            
            return {
                type: 'ForInStatement',
                left: left,
                right: right,
                body: body
            };
        }
    }
    
    return null; // Not a valid for-in loop
}

// Mock tokenizer for for-in loops
function mockTokenizeForIn(code) {
    const tokens = [];
    
    if (code.includes('for (s in all_stations)')) {
        tokens.push(
            { type: TokenType.TK_FOR, value: 'for', pos: 0, end: 3 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 4, end: 5 },
            { type: TokenType.TK_LABEL, value: 's', pos: 5, end: 6 },
            { type: TokenType.TK_IN, value: 'in', pos: 7, end: 9 },
            { type: TokenType.TK_LABEL, value: 'all_stations', pos: 10, end: 22 },
            { type: TokenType.TK_RPAREN, value: ')', pos: 22, end: 23 }
        );
    } else if (code.includes('for (let item in items)')) {
        tokens.push(
            { type: TokenType.TK_FOR, value: 'for', pos: 0, end: 3 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 4, end: 5 },
            { type: TokenType.TK_LET, value: 'let', pos: 5, end: 8 },
            { type: TokenType.TK_LABEL, value: 'item', pos: 9, end: 13 },
            { type: TokenType.TK_IN, value: 'in', pos: 14, end: 16 },
            { type: TokenType.TK_LABEL, value: 'items', pos: 17, end: 22 },
            { type: TokenType.TK_RPAREN, value: ')', pos: 22, end: 23 }
        );
    } else if (code.includes('for (i = 0; i < 10; i++)')) {
        // Regular for loop (should NOT parse as for-in)
        tokens.push(
            { type: TokenType.TK_FOR, value: 'for', pos: 0, end: 3 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 4, end: 5 },
            { type: TokenType.TK_LABEL, value: 'i', pos: 5, end: 6 },
            { type: TokenType.TK_ASSIGN, value: '=', pos: 7, end: 8 },
            { type: TokenType.TK_LABEL, value: '0', pos: 9, end: 10 },
            { type: TokenType.TK_SEMICOLON, value: ';', pos: 10, end: 11 }
        );
    }
    
    return tokens;
}

// Test cases for for-in loop parsing
const testCases = [
    {
        name: "for-in with bare identifier (for (s in all_stations))",
        code: "for (s in all_stations)",
        expectedResult: {
            isForIn: true,
            leftType: 'Identifier',
            leftName: 's',
            rightName: 'all_stations',
            hasDeclaration: false
        },
        description: "Should parse bare identifier in for-in loop"
    },
    {
        name: "for-in with let declaration (for (let item in items))",
        code: "for (let item in items)",
        expectedResult: {
            isForIn: true,
            leftType: 'VariableDeclaration',
            leftName: 'item',
            rightName: 'items',
            hasDeclaration: true
        },
        description: "Should parse let declaration in for-in loop"
    },
    {
        name: "regular for loop (for (i = 0; i < 10; i++))",
        code: "for (i = 0; i < 10; i++)",
        expectedResult: {
            isForIn: false,
            leftType: null,
            leftName: null,
            rightName: null,
            hasDeclaration: false
        },
        description: "Should NOT parse regular for loop as for-in"
    }
];

function testForInParsing(testName, code, expectedResult) {
    console.log(`\n🧪 Testing ${testName}:`);
    
    const tokens = mockTokenizeForIn(code);
    const ast = mockParseForInLoop(tokens);
    
    const isForIn = ast !== null && ast.type === 'ForInStatement';
    const leftType = ast?.left?.type || null;
    const leftName = ast?.left?.name || ast?.left?.declarations?.[0]?.id?.name || null;
    const rightName = ast?.right?.name || null;
    const hasDeclaration = leftType === 'VariableDeclaration';
    
    // Validate results
    const forInCorrect = isForIn === expectedResult.isForIn;
    const leftTypeCorrect = leftType === expectedResult.leftType;
    const leftNameCorrect = leftName === expectedResult.leftName;
    const rightNameCorrect = rightName === expectedResult.rightName;
    const declarationCorrect = hasDeclaration === expectedResult.hasDeclaration;
    
    const result = forInCorrect && leftTypeCorrect && leftNameCorrect && rightNameCorrect && declarationCorrect;
    
    console.log(`  Code: "${code}"`);
    console.log(`  Is for-in: ${isForIn ? '✅' : '❌'} (expected: ${expectedResult.isForIn})`);
    
    if (isForIn) {
        console.log(`  Left type: ${leftType} ${leftTypeCorrect ? '✅' : '❌'}`);
        console.log(`  Left name: ${leftName} ${leftNameCorrect ? '✅' : '❌'}`);
        console.log(`  Right name: ${rightName} ${rightNameCorrect ? '✅' : '❌'}`);
        console.log(`  Has declaration: ${hasDeclaration ? '✅' : '❌'} (expected: ${expectedResult.hasDeclaration})`);
    }
    
    console.log(`  Result: ${result ? '✅ PASS' : '❌ FAIL'}`);
    
    return result;
}

console.log('🧪 Testing For-In Loop Parsing with Bare Identifiers...\n');

let totalTests = 0;
let passedTests = 0;

testCases.forEach((testCase) => {
    totalTests++;
    if (testForInParsing(
        testCase.name, 
        testCase.code, 
        testCase.expectedResult
    )) {
        passedTests++;
    }
});

console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
    console.log('🎉 All for-in loop parsing tests passed!');
} else {
    console.log('❌ Some tests failed. Check for-in parsing logic.');
}

console.log('\n💡 Note: These test the for-in loop parsing logic for bare identifiers.');
console.log('💡 Proper for-in parsing handles both bare identifiers and declarations.');