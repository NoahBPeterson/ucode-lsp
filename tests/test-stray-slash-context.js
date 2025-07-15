// Test stray slash in different contexts
const { UcodeLexer } = require('../src/lexer/ucodeLexer.ts');
const { TokenType } = require('../src/lexer/tokenTypes.ts');

console.log('🧪 Testing stray slash in different contexts...\n');

const testCases = [
    {
        name: 'Stray slash after opening brace',
        code: `export function test() { /
    /* comment */
}`,
        expectedErrorLine: 1,
        expectedErrorCol: 26
    },
    {
        name: 'Stray slash after semicolon',
        code: `let x = 5; /
    /* comment */`,
        expectedErrorLine: 1,
        expectedErrorCol: 12
    },
    {
        name: 'Stray slash after block comment',
        code: `/**
 * Block comment
 */ /
export function test() {}`,
        expectedErrorLine: 3,
        expectedErrorCol: 5
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

function getLineAndColumn(text, pos) {
    let line = 1;
    let col = 1;
    for (let i = 0; i < pos; i++) {
        if (text[i] === '\n') {
            line++;
            col = 1;
        } else {
            col++;
        }
    }
    return { line, col };
}

testCases.forEach((testCase, index) => {
    console.log(`Test ${index + 1}: ${testCase.name}`);
    console.log(`  Code: ${JSON.stringify(testCase.code)}`);
    
    try {
        const lexer = new UcodeLexer(testCase.code, { rawMode: true });
        const tokens = lexer.tokenize();
        
        const errorTokens = tokens.filter(token => token.type === TokenType.TK_ERROR);
        
        if (errorTokens.length > 0) {
            const errorToken = errorTokens[0];
            const { line, col } = getLineAndColumn(testCase.code, errorToken.pos);
            
            console.log(`  Error found at line ${line}, col ${col}`);
            console.log(`  Expected: line ${testCase.expectedErrorLine}, col ${testCase.expectedErrorCol}`);
            console.log(`  Message: ${errorToken.value}`);
            
            if (line === testCase.expectedErrorLine && col === testCase.expectedErrorCol) {
                console.log(`  ✅ PASS - Error location is correct`);
            } else {
                console.log(`  ❌ FAIL - Error location is incorrect`);
            }
        } else {
            console.log(`  ❌ FAIL - No error token found`);
        }
        
    } catch (error) {
        console.log(`  ❌ Exception: ${error.message}`);
    }
    
    console.log('');
});

console.log('✅ Context-sensitive stray slash tests completed!');