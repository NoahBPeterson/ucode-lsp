// Test stray slash fix
const { UcodeLexer } = require('../src/lexer/ucodeLexer.ts');
const { TokenType } = require('../src/lexer/tokenTypes.ts');

console.log('🧪 Testing stray slash fix...\n');

const testCode = `/**
 * Block comment
 */ /
export function generate_bandwidth_overrides() {
    /* Capture timestamp now; append at end */
}`;

console.log('Testing code with line numbers:');
const lines = testCode.split('\n');
lines.forEach((line, i) => {
    console.log(`${i + 1}: ${line}`);
});

console.log('\n1. Lexing phase:');

function getTokenName(type) {
    for (const [key, value] of Object.entries(TokenType)) {
        if (value === type) {
            return key;
        }
    }
    return 'UNKNOWN';
}

try {
    const lexer = new UcodeLexer(testCode, { rawMode: true });
    const tokens = lexer.tokenize();
    
    console.log('All tokens with positions:');
    tokens.forEach((token, i) => {
        // Calculate line and column from position
        let line = 1;
        let col = 1;
        for (let pos = 0; pos < token.pos; pos++) {
            if (testCode[pos] === '\n') {
                line++;
                col = 1;
            } else {
                col++;
            }
        }
        
        const tokenName = getTokenName(token.type);
        console.log(`  ${i}: ${tokenName} (${JSON.stringify(token.value)}) at line ${line}, col ${col}`);
        
        // Highlight the error token
        if (token.type === TokenType.TK_ERROR) {
            console.log(`    ⚠️  ERROR TOKEN - This should point to the problematic '/' character`);
        }
    });
    
    // Check if the error is at the expected location
    const errorToken = tokens.find(token => token.type === TokenType.TK_ERROR);
    if (errorToken) {
        // Calculate line and column for error token
        let line = 1;
        let col = 1;
        for (let pos = 0; pos < errorToken.pos; pos++) {
            if (testCode[pos] === '\n') {
                line++;
                col = 1;
            } else {
                col++;
            }
        }
        
        console.log(`\n✅ SUCCESS: Error token found at line ${line}, col ${col}`);
        console.log(`   This should correspond to the stray '/' character on line 3, col 5`);
        
        if (line === 3 && col === 5) {
            console.log(`   🎉 PERFECT! Error location is correct.`);
        } else {
            console.log(`   ❌ Error location is incorrect. Expected line 3, col 5.`);
        }
    } else {
        console.log(`\n❌ FAIL: No error token found`);
    }
    
} catch (error) {
    console.log('❌ Exception:', error.message);
}