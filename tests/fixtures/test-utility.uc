// Test file for utility function validations

// min() function - these are actually VALID in ucode:
min("5");             // VALID: strings are accepted, uses comparison rules
min("10", "20");      // VALID: strings are accepted, returns "10" (lexicographic)

// max() function - these are actually VALID in ucode:
max("100");           // VALID: strings are accepted
max("50", "75");      // VALID: strings are accepted, returns "75" (lexicographic)

// uniq() function - these should show errors:
uniq("array");        // should be array, not string
uniq("1,2,3");        // should be array, not string

// These should be valid (no errors):
let numbers = [1, 2, 3, 2, 1];
let values = [10, 20, 30];
let duplicates = ["a", "b", "a", "c"];

// Valid min() functions - accepts ALL types
min(5);                       // valid: single number
min(10, 20, 30);             // valid: multiple numbers  
min(1.5, 2.7, 3.14);        // valid: double values
min("foo", "bar", "abc");     // valid: strings (returns "abc")
min(true, false, null);       // valid: mixed types (returns false)
min(values);                 // valid: array variable

// Valid max() functions - accepts ALL types
max(5);                       // valid: single number
max(10, 20, 30);             // valid: multiple numbers
max(1.5, 2.7, 3.14);        // valid: double values  
max("foo", "bar", "xyz");     // valid: strings (returns "xyz")
max(true, false, null);       // valid: mixed types (returns true)
max(values);                 // valid: array variable

// Valid uniq() functions
uniq(numbers);               // valid: array variable
uniq([1, 2, 2, 3]);         // valid: array literal
uniq(duplicates);           // valid: string array variable
uniq([]);                   // valid: empty array