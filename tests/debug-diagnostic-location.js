// Debug diagnostic location
const { UcodeLexer } = require('../src/lexer/ucodeLexer.ts');

console.log('🐛 Testing diagnostic location...\n');

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
    const { TokenType } = require('../src/lexer/tokenTypes.ts');
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
        
        console.log(`  ${i}: ${getTokenName(token.type)} (${JSON.stringify(token.value)}) at line ${line}, col ${col} (pos ${token.pos}-${token.end})`);
    });
    
} catch (error) {
    console.log('❌ Exception:', error.message);
}