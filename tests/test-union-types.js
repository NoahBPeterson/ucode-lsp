// Test union type functionality using compiled code
const fs = require('fs');
const path = require('path');

// Since the compiled server code is bundled, we need to test at a higher level
// Let's test the hover functionality with the actual ucode test file

const testCode = `
function getScore(difficulty) {
    if (difficulty == "easy") {
        return 10;
    } else if (difficulty == "hard") {
        return 20.5;
    } else {
        return null;
    }
}

function checkValue(input) {
    if (input == 42) {
        return "magic";
    } else {
        return input;
    }
}

let x = 5;
let name = "test";
let price = 29.99;
let isActive = true;
`;

// Write test file
fs.writeFileSync('./tests/test-union-types.uc', testCode);

console.log('✅ Test file created: test-union-types.uc');
console.log('');
console.log('📋 Expected union types in this test:');
console.log('- getScore function: integer | double | null');
console.log('- checkValue function: string | integer');
console.log('- x variable: integer');
console.log('- name variable: string');
console.log('- price variable: double');
console.log('- isActive variable: boolean');
console.log('');
console.log('🔍 To test manually:');
console.log('1. Open this file in VS Code with the ucode extension');
console.log('2. Hover over the function names and variables');
console.log('3. Check that the types are correctly inferred and displayed');
console.log('');
console.log('Expected hover information:');
console.log('- getScore: (function) getScore(): integer | double | null');
console.log('- checkValue: (function) checkValue(): string | integer');
console.log('- x: (variable) x: integer');
console.log('- name: (variable) name: string');
console.log('- price: (variable) price: double');
console.log('- isActive: (variable) isActive: boolean');