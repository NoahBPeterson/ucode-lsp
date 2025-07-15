// Test file with valid ucode syntax to verify AST generation

// Variable declarations
let x = 5;
const PI = 3.14159;
let name = "Hello World";
let isActive = true;
let emptyValue = null;

// Array and object literals
let numbers = [1, 2, 3, 4, 5];
let user = {
    name: "John Doe",
    age: 30,
    email: "john@example.com"
};

// Function declarations
function add(a, b) {
    return a + b;
}

function greet(name) {
    let message = "Hello, " + name + "!";
    return message;
}

// Control flow statements
if (x > 0) {
    console.log("Positive number");
} else if (x < 0) {
    console.log("Negative number");
} else {
    console.log("Zero");
}

// Loops
for (let i = 0; i < 10; i++) {
    console.log("Count: " + i);
}

let j = 0;
while (j < 5) {
    console.log("While loop: " + j);
    j++;
}

// Function calls
let result = add(10, 20);
let greeting = greet("Alice");

// String operations
let text = "Hello World";
let parts = split(text, " ");
let textLength = length(text);

// Array operations
push(numbers, 6);
let firstNumber = numbers[0];

// Object access
let userName = user.name;
user.age = 31;

// Expressions with operators
let calculation = (x + 5) * 2 - 1;
let comparison = x > 5 && name != "";
let ternary = x > 0 ? "positive" : "non-positive";

// Try-catch
try {
    let risky = someFunction();
} catch (error) {
    console.log("Error occurred: " + error);
}