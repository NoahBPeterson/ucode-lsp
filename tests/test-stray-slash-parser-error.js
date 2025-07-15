// Test case that reproduces the "Expected ';' after expression" error on wrong line
const { UcodeLexer } = require('../src/lexer/ucodeLexer.ts');
const { TokenType } = require('../src/lexer/tokenTypes.ts');
const { validateProgram } = require('../src/validation.ts');

console.log('🧪 Testing stray slash causing parser errors...\n');

// Test case that should show the error on the wrong line
const testCode = `/**
 * Initial comment
 */ /
    
// Some other code here
let x = 5;

/* This is where the error will likely appear
 * even though the problem is the stray / above
 */
export function test() {
    return x;
}`;

console.log('Test code:');
console.log('----------');
testCode.split('\n').forEach((line, i) => {
    console.log(`${(i + 1).toString().padStart(2)}: ${line}`);
});
console.log('----------\n');

// First, let's see what tokens the lexer produces
console.log('1. Lexer output:');
const lexer = new UcodeLexer(testCode, { rawMode: true });
const tokens = lexer.tokenize();

// Helper to get token name
function getTokenName(type) {
    for (const [key, value] of Object.entries(TokenType)) {
        if (value === type) return key;
    }
    return 'UNKNOWN';
}

tokens.forEach((token, i) => {
    let line = 1, col = 1;
    for (let pos = 0; pos < token.pos; pos++) {
        if (testCode[pos] === '\n') {
            line++;
            col = 1;
        } else {
            col++;
        }
    }
    const tokenName = getTokenName(token.type);
    console.log(`  Token ${i}: ${tokenName} "${token.value}" at line ${line}, col ${col}`);
    if (tokenName === 'TK_ERROR' || tokenName === 'TK_REGEXP') {
        console.log(`    >>> PROBLEMATIC TOKEN <<<`);
    }
});

// Now let's see where the validation puts the error
console.log('\n2. Validation output:');
const diagnostics = validateProgram(testCode);
diagnostics.forEach((diag, i) => {
    const lines = testCode.substring(0, diag.range.start).split('\n');
    const line = lines.length;
    const col = lines[lines.length - 1].length + 1;
    console.log(`  Diagnostic ${i + 1}: "${diag.message}" at line ${line}, col ${col}`);
    
    // Show what text is highlighted
    const highlightedText = testCode.substring(diag.range.start, diag.range.end);
    console.log(`    Highlighted text: "${highlightedText}"`);
    
    // Check if this is the stray slash error appearing on wrong line
    if (diag.message.includes("Expected ';' after expression") && line > 5) {
        console.log(`    >>> ERROR IS ON WRONG LINE! Should be on line 3 <<<`);
    }
});