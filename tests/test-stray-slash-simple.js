// Simple test to understand stray slash behavior
const { UcodeLexer } = require('../src/lexer/ucodeLexer.ts');
const { TokenType } = require('../src/lexer/tokenTypes.ts');

console.log('🧪 Testing different stray slash scenarios...\n');

// Helper to get token name
function getTokenName(type) {
    for (const [key, value] of Object.entries(TokenType)) {
        if (value === type) return key;
    }
    return `UNKNOWN(${type})`;
}

function testCase(name, code) {
    console.log(`\nTest: ${name}`);
    console.log('Code:');
    code.split('\n').forEach((line, i) => {
        console.log(`  ${(i + 1).toString().padStart(2)}: ${line}`);
    });
    
    const lexer = new UcodeLexer(code, { rawMode: true });
    const tokens = lexer.tokenize();
    
    console.log('Tokens:');
    tokens.forEach((token, i) => {
        let line = 1, col = 1;
        for (let pos = 0; pos < token.pos; pos++) {
            if (code[pos] === '\n') {
                line++;
                col = 1;
            } else {
                col++;
            }
        }
        const tokenName = getTokenName(token.type);
        const value = token.value.toString().replace(/\n/g, '\\n');
        console.log(`  ${i}: ${tokenName} "${value}" at line ${line}:${col}`);
    });
}

// Test 1: The original case
testCase('Original stray slash after block comment', `/**
 * Block comment
 */ /
export function test() {}`);

// Test 2: Stray slash without my lookahead pattern
testCase('Stray slash with different following content', `/**
 * Block comment
 */ /
let x = 5;`);

// Test 3: Stray slash followed by nothing
testCase('Stray slash at end of line', `let x = 5;
/
// comment`);

// Test 4: Multiple stray slashes
testCase('Multiple stray slashes', `let x = 5; /
let y = 10; /
function test() {}`);

// Test 5: Stray slash in middle of code
testCase('Stray slash between statements', `function foo() {}
/
function bar() {}`);

console.log('\n✅ Test complete');