// Test case to demonstrate multiple "Expected ';' after expression" errors
const { UcodeLexer } = require('../src/lexer/ucodeLexer.ts');
const { TokenType } = require('../src/lexer/tokenTypes.ts');

console.log('🧪 Testing multiple semicolon errors...\n');

// Test code with multiple missing semicolons
const testCode = `
// Missing semicolon after expression statement
let x = 5

// Another missing semicolon
let y = 10

// Function call missing semicolon
console.log("hello")

// Multiple statements on one line, missing semicolons
let a = 1 let b = 2

// Expression statement missing semicolon
x + y

// Another expression
"test string"

function valid() {
    // This is fine
    return 42;
}
`;

console.log('Test code:');
console.log('===========');
testCode.split('\n').forEach((line, i) => {
    if (line.trim()) {
        console.log(`${i.toString().padStart(2)}: ${line}`);
    }
});
console.log('===========\n');

// First, let's see what tokens are produced
const lexer = new UcodeLexer(testCode, { rawMode: true });
const tokens = lexer.tokenize();

// Helper to get token name
function getTokenName(type) {
    for (const [key, value] of Object.entries(TokenType)) {
        if (value === type) return key;
    }
    return `UNKNOWN(${type})`;
}

// Look for patterns that would cause "Expected ';' after expression"
console.log('Analyzing token patterns that might need semicolons...\n');

let potentialErrors = [];
for (let i = 0; i < tokens.length - 1; i++) {
    const current = tokens[i];
    const next = tokens[i + 1];
    
    // Check for expression-ending tokens followed by statement-starting tokens
    const expressionEnders = [
        TokenType.TK_NUMBER,
        TokenType.TK_STRING,
        TokenType.TK_LABEL,
        TokenType.TK_RPAREN,
        TokenType.TK_RBRACK,
        TokenType.TK_RBRACE
    ];
    
    const statementStarters = [
        TokenType.TK_LOCAL,     // let
        TokenType.TK_CONST,     // const
        TokenType.TK_FUNC,      // function
        TokenType.TK_IF,        // if
        TokenType.TK_WHILE,     // while
        TokenType.TK_FOR,       // for
        TokenType.TK_RETURN,    // return
        TokenType.TK_LABEL,     // identifier (could start new statement)
        TokenType.TK_STRING,    // string literal
        TokenType.TK_NUMBER     // number literal
    ];
    
    if (expressionEnders.includes(current.type) && statementStarters.includes(next.type)) {
        // Special case: don't flag if there's already a semicolon
        if (next.type !== TokenType.TK_SCOL) {
            let line = 1, col = 1;
            for (let pos = 0; pos < current.pos; pos++) {
                if (testCode[pos] === '\n') {
                    line++;
                    col = 1;
                } else {
                    col++;
                }
            }
            
            potentialErrors.push({
                afterToken: getTokenName(current.type),
                beforeToken: getTokenName(next.type),
                line: line,
                col: col,
                value: current.value
            });
        }
    }
}

console.log(`Found ${potentialErrors.length} potential locations for semicolon errors:`);
potentialErrors.forEach((err, i) => {
    console.log(`  ${i + 1}. After ${err.afterToken} "${err.value}" at line ${err.line}, before ${err.beforeToken}`);
});

// Now let's see how many errors the parser actually reports
console.log('\nTesting with actual parser...');

// We need to find where the parser is used
const { UcodeParser } = require('../src/parser/ucodeParser.ts');

try {
    const parser = new UcodeParser(tokens, testCode);
    const result = parser.parse();
    
    if (result.errors && result.errors.length > 0) {
        console.log(`\nParser reported ${result.errors.length} error(s):`);
        result.errors.forEach((err, i) => {
            console.log(`  ${i + 1}. "${err.message}"`);
            if (err.token) {
                let line = 1, col = 1;
                for (let pos = 0; pos < err.token.pos; pos++) {
                    if (testCode[pos] === '\n') {
                        line++;
                        col = 1;
                    } else {
                        col++;
                    }
                }
                console.log(`     at line ${line}, col ${col} (token: ${getTokenName(err.token.type)})`);
            }
        });
    } else {
        console.log('\nNo parser errors reported (unexpected!)');
    }
} catch (e) {
    console.log('\nParser threw exception:', e.message);
    console.log('This suggests the parser stops on first error');
}