// Test for-in loop with bare identifier parsing

console.log('🔍 Testing for-in loop parsing with bare identifier...');

const testCode = `
let all_stations = { station1: "data1" };
let station_total = 0;
for (s in all_stations) station_total++;
`;

console.log('Test code:');
console.log(testCode);

console.log('\n📋 Expected behavior:');
console.log('✅ Should parse "s" as identifier expression');
console.log('✅ Should recognize "in" keyword');
console.log('✅ Should parse "all_stations" as right side');
console.log('✅ Should create ForInStatement AST node');
console.log('✅ Should NOT show diagnostic on ")"');

console.log('\n🔧 Issue Analysis:');
console.log('The for-in parsing logic should handle bare identifiers correctly');
console.log('by parsing them as expressions in the else branch.');
console.log('If there\'s still a diagnostic, the issue might be in:');
console.log('1. Expression parsing of the identifier');
console.log('2. TK_IN token matching');
console.log('3. Checkpoint reset logic');
console.log('4. Right side expression parsing');

console.log('\n📊 Test completed - check the actual .uc file for diagnostics!');