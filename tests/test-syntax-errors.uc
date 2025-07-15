// Test file with intentional syntax errors to test error recovery

// Missing semicolon
let x = 5
let y = 10;

// Mismatched braces
function testBraces() {
    let a = 1;
    if (true) {
        console.log("test");
    // Missing closing brace

// Incomplete variable declaration
let incomplete = ;

// Invalid assignment target
5 = x;

// Missing comma in object literal
let obj = {
    name: "test"
    age: 25
};

// Missing closing bracket
let array = [1, 2, 3;

// Incomplete if statement
if (x > 0
    console.log("positive");

// Missing function body
function incomplete();

// Invalid operator
let weird = x ++ y;

// Missing expression in return
function emptyReturn() {
    return;
}

// Unclosed string
let badString = "unclosed string

// Invalid member access
let bad = obj.;

// Missing function name
function () {
    return true;
}