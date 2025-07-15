// Test file for utility function validations

// min() function - these should show errors:
min("5");             // should be number, not string
min("10", "20");      // should be numbers, not strings

// max() function - these should show errors:
max("100");           // should be number, not string
max("50", "75");      // should be numbers, not strings

// uniq() function - these should show errors:
uniq("array");        // should be array, not string
uniq("1,2,3");        // should be array, not string

// These should be valid (no errors):
let numbers = [1, 2, 3, 2, 1];
let values = [10, 20, 30];
let duplicates = ["a", "b", "a", "c"];

// Valid min() functions
min(5);                       // valid: single number
min(10, 20, 30);             // valid: multiple numbers
min(1.5, 2.7, 3.14);        // valid: double values
min(values);                 // valid: array variable

// Valid max() functions  
max(5);                       // valid: single number
max(10, 20, 30);             // valid: multiple numbers
max(1.5, 2.7, 3.14);        // valid: double values
max(values);                 // valid: array variable

// Valid uniq() functions
uniq(numbers);               // valid: array variable
uniq([1, 2, 2, 3]);         // valid: array literal
uniq(duplicates);           // valid: string array variable
uniq([]);                   // valid: empty array