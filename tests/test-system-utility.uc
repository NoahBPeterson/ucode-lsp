// Test file for system utility function validations

// type() function - these should NOT show errors (accepts any type):
type(123);                      // valid: number
type(3.14);                     // valid: double
type("string");                 // valid: string
type([1, 2, 3]);                // valid: array
type({key: "value"});           // valid: object
type(true);                     // valid: boolean
type(null);                     // valid: null
type(undefined);                // valid: undefined
type(function() {});            // valid: function

// print() function - these should NOT show errors (accepts any types):
print("Hello World");           // valid: string
print(42);                      // valid: number
print(3.14);                    // valid: double
print([1, 2, 3]);               // valid: array
print({name: "John"});          // valid: object
print(true, false);             // valid: multiple values
print("Name:", "John", "Age:", 30); // valid: mixed types
print();                        // valid: no arguments

// time() function - these should NOT show errors (no parameters):
time();                         // valid: no parameters
let currentTime = time();       // valid: assignment

// clock() function - these should NOT show errors (no parameters):
clock();                        // valid: no parameters
let cpuTime = clock();          // valid: assignment

// sourcepath() function - these should NOT show errors (no parameters):
sourcepath();                   // valid: no parameters
let scriptPath = sourcepath();  // valid: assignment

// gc() function - these should NOT show errors (no parameters):
gc();                           // valid: no parameters
let gcResult = gc();            // valid: assignment

// These should be valid (no errors):
let value = getValue();
let data = {test: true};
let numbers = [1, 2, 3];

// Valid type() functions with variables
type(value);                    // valid: variable
type(data.test);                // valid: property access
type(numbers[0]);               // valid: array access
type(getUserName());            // valid: function call

// Valid print() functions with expressions
print("Result:", calculate());  // valid: function call in print
print("Items:", numbers.length); // valid: property access
print(data);                    // valid: object
print(...numbers);              // valid: spread operator

// Valid system functions in expressions
if (time() > lastUpdate) {      // valid: time in condition
    print("Data is stale");
}

let info = {
    timestamp: time(),           // valid: time in object
    path: sourcepath(),          // valid: sourcepath in object
    cpu: clock()                 // valid: clock in object
};