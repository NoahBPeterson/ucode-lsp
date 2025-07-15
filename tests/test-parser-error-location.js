// Test to check if parser errors appear on correct location
const fs = require('fs');
const { UcodeLexer } = require('../src/lexer/ucodeLexer.ts');
const { TokenType } = require('../src/lexer/tokenTypes.ts');

console.log('🧪 Testing parser error location with complex file...\n');

// Read the test file
const testCode = fs.readFileSync('./tests/test-parser-error-location.uc', 'utf8');

console.log('Test file preview:');
console.log('==================');
const lines = testCode.split('\n');
lines.forEach((line, i) => {
    if (i < 10 || (i >= 13 && i <= 16)) {
        console.log(`${(i + 1).toString().padStart(2)}: ${line}`);
    } else if (i === 10) {
        console.log('... (more lines) ...');
    }
});
console.log('==================\n');

// Tokenize
const lexer = new UcodeLexer(testCode, { rawMode: true });
const tokens = lexer.tokenize();

// Helper to get token name
function getTokenName(type) {
    for (const [key, value] of Object.entries(TokenType)) {
        if (value === type) return key;
    }
    return `UNKNOWN(${type})`;
}

// Find error tokens
console.log('Error tokens found:');
let errorCount = 0;
tokens.forEach((token, i) => {
    if (token.type === TokenType.TK_ERROR) {
        let line = 1, col = 1;
        for (let pos = 0; pos < token.pos; pos++) {
            if (testCode[pos] === '\n') {
                line++;
                col = 1;
            } else {
                col++;
            }
        }
        console.log(`  Error ${++errorCount}: "${token.value}" at line ${line}, col ${col}`);
        
        // Show surrounding tokens for context
        console.log('    Previous token:', i > 0 ? getTokenName(tokens[i-1].type) : 'START');
        console.log('    Next token:', i < tokens.length - 1 ? getTokenName(tokens[i+1].type) : 'END');
    }
});

if (errorCount === 0) {
    console.log('  No error tokens found (unexpected!)');
}

// Check for TK_REGEXP tokens that might be malformed
console.log('\nRegex tokens found:');
let regexCount = 0;
tokens.forEach((token, i) => {
    if (token.type === TokenType.TK_REGEXP) {
        let line = 1, col = 1;
        for (let pos = 0; pos < token.pos; pos++) {
            if (testCode[pos] === '\n') {
                line++;
                col = 1;
            } else {
                col++;
            }
        }
        console.log(`  Regex ${++regexCount}: "${token.value.replace(/\n/g, '\\n')}" at line ${line}, col ${col}`);
    }
});

if (regexCount === 0) {
    console.log('  No regex tokens found (good!)');
}

console.log('\n✅ Test complete');

// Now let's simulate what the parser would see
console.log('\n--- Parser simulation ---');
console.log('The parser would see these tokens after the stray slash:');
let slashIndex = -1;
tokens.forEach((token, i) => {
    if (token.type === TokenType.TK_ERROR && token.value.includes("Unexpected token '/'")) {
        slashIndex = i;
    }
});

if (slashIndex !== -1) {
    console.log(`Found stray slash error at token index ${slashIndex}`);
    console.log('Next 5 tokens:');
    for (let i = slashIndex + 1; i <= slashIndex + 5 && i < tokens.length; i++) {
        let line = 1, col = 1;
        for (let pos = 0; pos < tokens[i].pos; pos++) {
            if (testCode[pos] === '\n') {
                line++;
                col = 1;
            } else {
                col++;
            }
        }
        console.log(`  ${i - slashIndex}: ${getTokenName(tokens[i].type)} at line ${line}, col ${col}`);
    }
}