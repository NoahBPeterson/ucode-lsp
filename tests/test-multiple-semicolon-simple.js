// Simple test for multiple semicolon errors
const { UcodeLexer } = require('../src/lexer/ucodeLexer.ts');
const { UcodeParser } = require('../src/parser/ucodeParser.ts');

console.log('🧪 Testing multiple semicolon errors...\n');

const testCode = `
let x = 5
let y = 10
console.log("hello")
x + y
"test"
`;

console.log('Test code:');
console.log('===========');
console.log(testCode);
console.log('===========\n');

// Parse the code
const lexer = new UcodeLexer(testCode, { rawMode: true });
const tokens = lexer.tokenize();

console.log(`Total tokens: ${tokens.length}\n`);

const parser = new UcodeParser(tokens, testCode);
const result = parser.parse();

console.log(`Parser found ${result.errors.length} error(s):\n`);

result.errors.forEach((err, i) => {
    console.log(`Error ${i + 1}: "${err.message}"`);
    
    // Find line/col from position
    let line = 1, col = 1;
    for (let pos = 0; pos < err.start; pos++) {
        if (testCode[pos] === '\n') {
            line++;
            col = 1;
        } else {
            col++;
        }
    }
    console.log(`  Location: line ${line}, col ${col}`);
    console.log('');
});

if (result.errors.length > 1) {
    console.log('✅ SUCCESS: Multiple semicolon errors are now reported!');
} else {
    console.log('❌ FAIL: Still only reporting one error');
}