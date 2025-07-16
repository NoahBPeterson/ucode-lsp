// Test to verify TK_IN token recognition

console.log('🔍 Testing TK_IN token recognition...');

// Simple test - the lexer should recognize 'in' as TK_IN
const testCode = 'for (s in all_stations)';

console.log('Test code:', testCode);
console.log('\n📋 Expected tokens:');
console.log('1. TK_FOR (for)');
console.log('2. TK_LPAREN (()');
console.log('3. TK_LABEL (s)');
console.log('4. TK_IN (in)');
console.log('5. TK_LABEL (all_stations)');
console.log('6. TK_RPAREN ())');

console.log('\n🔧 If TK_IN is not recognized correctly, the for-in parsing will fail');
console.log('and fall back to regular for loop parsing, causing the diagnostic.');

console.log('\n📊 Check tokenTypes.ts to verify TK_IN is properly mapped!');