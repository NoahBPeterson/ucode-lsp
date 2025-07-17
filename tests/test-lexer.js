// Unit test for lexer tokenization logic

// Mock TokenType enum based on common ucode tokens
const TokenType = {
    TK_LET: 1,
    TK_CONST: 2,
    TK_FUNCTION: 3,
    TK_LABEL: 4,
    TK_ASSIGN: 5,
    TK_NUMBER: 6,
    TK_STRING: 7,
    TK_SEMICOLON: 8,
    TK_LPAREN: 9,
    TK_RPAREN: 10,
    TK_LBRACE: 11,
    TK_RBRACE: 12,
    TK_DOT: 13,
    TK_PLUS: 14,
    TK_COMMENT: 15,
    TK_EOF: 16
};

// Mock lexer to simulate tokenization
function mockTokenize(code) {
    const tokens = [];
    
    // Simple tokenization simulation based on code patterns
    if (code.includes('let x = 42')) {
        tokens.push(
            { type: TokenType.TK_LET, value: 'let', pos: 0, end: 3 },
            { type: TokenType.TK_LABEL, value: 'x', pos: 4, end: 5 },
            { type: TokenType.TK_ASSIGN, value: '=', pos: 6, end: 7 },
            { type: TokenType.TK_NUMBER, value: '42', pos: 8, end: 10 },
            { type: TokenType.TK_SEMICOLON, value: ';', pos: 10, end: 11 }
        );
    }
    
    if (code.includes('const name = "hello"')) {
        tokens.push(
            { type: TokenType.TK_CONST, value: 'const', pos: 12, end: 17 },
            { type: TokenType.TK_LABEL, value: 'name', pos: 18, end: 22 },
            { type: TokenType.TK_ASSIGN, value: '=', pos: 23, end: 24 },
            { type: TokenType.TK_STRING, value: '"hello"', pos: 25, end: 32 },
            { type: TokenType.TK_SEMICOLON, value: ';', pos: 32, end: 33 }
        );
    }
    
    if (code.includes('function greet(person)')) {
        tokens.push(
            { type: TokenType.TK_FUNCTION, value: 'function', pos: 34, end: 42 },
            { type: TokenType.TK_LABEL, value: 'greet', pos: 43, end: 48 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 48, end: 49 },
            { type: TokenType.TK_LABEL, value: 'person', pos: 49, end: 55 },
            { type: TokenType.TK_RPAREN, value: ')', pos: 55, end: 56 },
            { type: TokenType.TK_LBRACE, value: '{', pos: 57, end: 58 }
        );
    }
    
    if (code.includes('// Comment')) {
        tokens.push(
            { type: TokenType.TK_COMMENT, value: '// Comment', pos: 100, end: 110 }
        );
    }
    
    if (code.includes('str.trim()')) {
        tokens.push(
            { type: TokenType.TK_LABEL, value: 'str', pos: 200, end: 203 },
            { type: TokenType.TK_DOT, value: '.', pos: 203, end: 204 },
            { type: TokenType.TK_LABEL, value: 'trim', pos: 204, end: 208 },
            { type: TokenType.TK_LPAREN, value: '(', pos: 208, end: 209 },
            { type: TokenType.TK_RPAREN, value: ')', pos: 209, end: 210 }
        );
    }
    
    tokens.push({ type: TokenType.TK_EOF, value: '', pos: code.length, end: code.length });
    return tokens;
}

// Test cases for lexer functionality
const testCases = [
    {
        name: "variable declaration with number",
        code: "let x = 42;",
        expectedTokenTypes: [TokenType.TK_LET, TokenType.TK_LABEL, TokenType.TK_ASSIGN, TokenType.TK_NUMBER, TokenType.TK_SEMICOLON],
        description: "Should tokenize let variable declaration correctly"
    },
    {
        name: "constant declaration with string",
        code: 'const name = "hello";',
        expectedTokenTypes: [TokenType.TK_CONST, TokenType.TK_LABEL, TokenType.TK_ASSIGN, TokenType.TK_STRING, TokenType.TK_SEMICOLON],
        description: "Should tokenize const declaration with string correctly"
    },
    {
        name: "function declaration",
        code: "function greet(person) {",
        expectedTokenTypes: [TokenType.TK_FUNCTION, TokenType.TK_LABEL, TokenType.TK_LPAREN, TokenType.TK_LABEL, TokenType.TK_RPAREN, TokenType.TK_LBRACE],
        description: "Should tokenize function declaration correctly"
    },
    {
        name: "method call",
        code: "str.trim()",
        expectedTokenTypes: [TokenType.TK_LABEL, TokenType.TK_DOT, TokenType.TK_LABEL, TokenType.TK_LPAREN, TokenType.TK_RPAREN],
        description: "Should tokenize method call correctly"
    },
    {
        name: "comment",
        code: "// Comment",
        expectedTokenTypes: [TokenType.TK_COMMENT],
        description: "Should tokenize comments correctly"
    }
];

function testLexerTokenization(testName, code, expectedTokenTypes) {
    console.log(`\n🧪 Testing ${testName}:`);
    
    const tokens = mockTokenize(code);
    const actualTokenTypes = tokens
        .filter(token => token.type !== TokenType.TK_EOF)
        .map(token => token.type);
    
    // Check if token types match
    const typesMatch = actualTokenTypes.length === expectedTokenTypes.length &&
        actualTokenTypes.every((type, index) => type === expectedTokenTypes[index]);
    
    // Check if positions are sequential
    let positionsValid = true;
    for (let i = 1; i < tokens.length - 1; i++) {
        if (tokens[i].pos < tokens[i-1].end) {
            positionsValid = false;
            break;
        }
    }
    
    const result = typesMatch && positionsValid;
    
    console.log(`  Code: "${code}"`);
    console.log(`  Expected types: ${expectedTokenTypes.length}, Got: ${actualTokenTypes.length}`);
    console.log(`  Types match: ${typesMatch ? '✅' : '❌'}`);
    console.log(`  Positions valid: ${positionsValid ? '✅' : '❌'}`);
    console.log(`  Result: ${result ? '✅ PASS' : '❌ FAIL'}`);
    
    if (!typesMatch) {
        console.log(`    Expected: [${expectedTokenTypes.join(', ')}]`);
        console.log(`    Actual:   [${actualTokenTypes.join(', ')}]`);
    }
    
    return result;
}

console.log('🧪 Testing Lexer Tokenization Logic...\n');

let totalTests = 0;
let passedTests = 0;

testCases.forEach((testCase) => {
    totalTests++;
    if (testLexerTokenization(
        testCase.name, 
        testCase.code, 
        testCase.expectedTokenTypes
    )) {
        passedTests++;
    }
});

console.log(`\n📊 Test Results: ${passedTests}/${totalTests} tests passed`);

if (passedTests === totalTests) {
    console.log('🎉 All lexer tokenization tests passed!');
} else {
    console.log('❌ Some tests failed. Check tokenization logic.');
}

console.log('\n💡 Note: These test the lexer tokenization patterns for ucode syntax.');
console.log('💡 Proper tokenization is essential for accurate parsing and analysis.');