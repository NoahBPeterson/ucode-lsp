// Debug block comment parsing
const { UcodeLexer } = require('../src/lexer/ucodeLexer.ts');
const { UcodeParser } = require('../src/parser/ucodeParser.ts');

console.log('🐛 Testing block comment parsing...\n');

const testCode = `import { run_command } from '../lib/commands.uc';

/**
 * Generates bandwidth override information
 */
export function generate_bandwidth_overrides() {
    return null;
}`;

console.log('Testing code:');
console.log(testCode);
console.log('\n1. Lexing phase:');

try {
    const lexer = new UcodeLexer(testCode, { rawMode: true });
    const tokens = lexer.tokenize();
    
    console.log('Tokens around block comment:');
    tokens.forEach((token, i) => {
        if (i >= 10 && i <= 20) { // Show tokens around the comment area
            console.log(`  ${i}: ${token.type} (${token.value}) at ${token.pos}-${token.end}`);
        }
    });
    
    console.log('\n2. Parsing phase:');
    const parser = new UcodeParser(tokens);
    const result = parser.parse();
    
    if (result.errors && result.errors.length > 0) {
        console.log('❌ Parser errors:');
        result.errors.forEach(error => {
            console.log(`  - ${error.message} at ${error.start}-${error.end}`);
        });
    } else {
        console.log('✅ Parsed successfully!');
    }
    
} catch (error) {
    console.log('❌ Exception:', error.message);
}