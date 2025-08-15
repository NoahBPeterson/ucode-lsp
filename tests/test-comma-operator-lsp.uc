// Test comma operator parsing - the exact issue from the user
// This should NOT show "Expected ')' after expression" or "Unexpected token in expression" errors

// The exact failing example from the user:
const a = function(val) {
    if (val == null)
        return null;

    let rv = { invert: false };

    rv.val = trim(replace(val, /^[ \t]*!/, () => (rv.invert = true, '')));

    return length(rv.val) ? rv : null;
};

// Basic comma operator usage
let result1 = (x = 1, y = 2);

// Comma operator in function callbacks
let processed = data.map((item) => (console.log("Processing:", item), item * 2));

// Multiple comma operators
let result2 = (a = 1, b = 2, c = 3);

// Comma operator in conditional expressions
let result3 = flag ? (x = 100, x * 2) : (y = 200, y / 2);

// Comma operator in array literals
let arr = [
    (x = 1, x + 1),
    (y = 2, y * 2),
    (z = 3, z * 3)
];

// Comma operator in object literals
let obj = {
    a: (x = 5, x),
    b: (y = 10, y),
    c: (z = 15, z)
};

// Nested comma operators
let result4 = (a = (b = 5, b + 1), c = (a + 2, a * 2), a + c);

// Comma operator with function calls
let result5 = (console.log("test"), getValue());

// Comma operator in arrow function body
let arrowTest = (x) => (console.log(x), x * 2);

// Complex real-world example similar to user's case
const processInput = function(val) {
    if (val == null)
        return null;

    let rv = { invert: false };

    // This exact pattern was causing "Expected ')' after expression" error
    rv.val = trim(replace(val, /^[ \t]*!/, () => (rv.invert = true, '')));
    
    // Additional similar patterns
    rv.processed = someFunction(val, (item) => (rv.count++, item.toUpperCase()));
    rv.transformed = transform(val, () => (rv.modified = true, getDefaultValue()));

    return length(rv.val) ? rv : null;
};

// Test comma operator in for loop conditions  
function testLoops() {
    let i = 0, sum = 0;
    
    // Comma operator in for loop condition
    for (let j = 0; (j < 5, i < 10); j++, i++) {
        sum += j;
    }
    
    return sum;
}

// Test comma operator in return statements
function testReturns(flag) {
    if (flag) {
        return (console.log("Returning true"), true);
    } else {
        return (console.log("Returning false"), false);
    }
}