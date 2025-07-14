const { UcodeLexer, TokenType } = require('./dist/server.js');

// Test the lexer with some sample ucode
const testCode = `
let x = 42;
const name = "hello";
function greet(person) {
    print("Hello, " + person);
}

// Method call error test
let result = str.trim();

// Variable redeclaration test
let x = "redeclared";
`;

console.log('Testing ucode lexer...\n');

try {
    const lexer = new UcodeLexer(testCode, { rawMode: true });
    const tokens = lexer.tokenize();
    
    console.log('Generated tokens:');
    tokens.forEach((token, i) => {
        if (token.type !== TokenType.TK_EOF) {
            console.log(`${i}: ${UcodeLexer.getTokenName(token.type)} - "${token.value}" (${token.pos}-${token.end})`);
        }
    });
    
    console.log('\nTest completed successfully!');
} catch (error) {
    console.error('Lexer test failed:', error);
}