// Test file for type inference and hover functionality

// Variable with integer literal
let x = 42;

// Variable with string literal  
let name = "Alice";

// Variable with boolean literal
let isActive = true;
print(isActive);

// Variable with double literal
let price = 19.99;
print(price);

// Function with multiple return types
function getScore(player) {
    if (player == "Alice") {
        return 100;
    } else if (player == "Bob") {
        return 85.5;
    } else {
        return null;
    }
}

// Function with consistent return type
function calculate(a, b) {
    return a + b;
}

// Function with string return
function greet(name) {
    return "Hello, " + name;
}

// Function with no return (should be null)
function doSomething() {
    let temp = 123;
    // No return statement
}

// Function with early return
function checkValue(val) {
    if (val < 0) {
        return "negative";
    }
    if (val > 100) {
        return "too high";
    }
    return val;
}

checkValue(40);
checkValue(101);

// Using the variables and functions
let result = calculate(x, 10);
let message = greet(name);
let score = getScore("Charlie");
doSomething();

// This should show inferred types on hover for:
// - x: INTEGER 
// - name: STRING
// - isActive: BOOLEAN
// - price: DOUBLE
// - getScore: function returning DOUBLE (common type of INTEGER, DOUBLE, NULL)
// - calculate: function returning INTEGER (if both params are integers)
// - greet: function returning STRING
// - doSomething: function returning NULL
// - checkValue: function returning UNKNOWN (STRING vs INTEGER mismatch)
// - result: should show the return type of calculate
// - message: should show STRING  
// - score: should show return type of getScore