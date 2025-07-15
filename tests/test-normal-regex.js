// Test that normal regex parsing still works
const { UcodeLexer } = require('../src/lexer/ucodeLexer.ts');
const { TokenType } = require('../src/lexer/tokenTypes.ts');

console.log('🧪 Testing normal regex parsing still works...\n');

const testCases = [
    {
        name: 'Simple regex',
        code: 'let pattern = /test/;'
    },
    {
        name: 'Regex with flags',
        code: 'let pattern = /test/gi;'
    },
    {
        name: 'Regex with escaped characters',
        code: 'let pattern = /test\\/path/;'
    },
    {
        name: 'Division operator (should not be regex)',
        code: 'let result = 10 / 2;'
    }
];

function getTokenName(type) {
    for (const [key, value] of Object.entries(TokenType)) {
        if (value === type) {
            return key;
        }
    }
    return 'UNKNOWN';
}

testCases.forEach((testCase, index) => {
    console.log(`Test ${index + 1}: ${testCase.name}`);
    console.log(`  Code: ${testCase.code}`);
    
    try {
        const lexer = new UcodeLexer(testCase.code, { rawMode: true });
        const tokens = lexer.tokenize();
        
        const regexTokens = tokens.filter(token => token.type === TokenType.TK_REGEXP);
        const divTokens = tokens.filter(token => token.type === TokenType.TK_DIV);
        const errorTokens = tokens.filter(token => token.type === TokenType.TK_ERROR);
        
        console.log(`  Regex tokens: ${regexTokens.length}`);
        console.log(`  Division tokens: ${divTokens.length}`);
        console.log(`  Error tokens: ${errorTokens.length}`);
        
        if (errorTokens.length > 0) {
            console.log(`  ❌ Unexpected errors: ${errorTokens.map(t => t.value).join(', ')}`);
        } else {
            console.log(`  ✅ No errors`);
        }
        
    } catch (error) {
        console.log(`  ❌ Exception: ${error.message}`);
    }
    
    console.log('');
});

console.log('✅ Normal regex parsing tests completed!');