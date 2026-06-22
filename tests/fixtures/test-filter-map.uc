// Test file for filter and map function validations

// Filter function - these should show errors:
filter("string", someFunc);    // first param should be array
filter(123, someFunc);         // first param should be array
filter(myArray, "string");     // second param should be function
filter(myArray, 456);          // second param should be function

// Map function - these should show errors:
map("string", someFunc);       // first param should be array
map(789, someFunc);            // first param should be array
map(myArray, "string");        // second param should be function  
map(myArray, 123);             // second param should be function

// These should be valid (no errors):
let myArray = [1, 2, 3, 4, 5];

function isEven(x) {
    return x % 2 == 0;
}

function double(x) {
    return x * 2;
}

filter(myArray, isEven);       // valid: array and function
map(myArray, double);          // valid: array and function

// Arrow functions should also be valid
filter(myArray, (x) => x > 2);
map(myArray, (x) => x + 1);