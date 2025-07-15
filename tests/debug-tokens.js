// Debug what tokens floating point numbers produce
const testCode = `
length(123);
length(456.78);
length("string");
`;

console.log('Debug: Checking token types for different number formats...\n');
console.log('Code to analyze:');
console.log(testCode);