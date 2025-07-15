// Test file for remaining utility function validations

// wildcard() function - these should show errors:
wildcard(123, "file.txt");   // first param should be string pattern, not number
wildcard([], "file.txt");    // first param should be string pattern, not array
wildcard({}, "file.txt");    // first param should be string pattern, not object
wildcard("*.txt", 456);      // second param should be string, not number
wildcard("*.txt", []);       // second param should be string, not array
wildcard("*.txt", {});       // second param should be string, not object

// regexp() function - these should show errors:
regexp(789, "g");            // first param should be pattern string, not number
regexp([], "g");             // first param should be pattern string, not array
regexp({}, "g");             // first param should be pattern string, not object
regexp("[0-9]+", 123);       // second param should be flags string, not number
regexp("[0-9]+", []);        // second param should be flags string, not array
regexp("[0-9]+", {});        // second param should be flags string, not object

// assert() function - these should ALL be valid (accepts any type):
assert(true);                // valid: boolean
assert(false);               // valid: boolean
assert(42);                  // valid: number
assert(3.14);                // valid: double
assert("message");           // valid: string
assert([1, 2, 3]);           // valid: array
assert({key: "value"});      // valid: object
assert(null);                // valid: null
assert(undefined);           // valid: undefined

// These should be valid (no errors):
let pattern = "*.txt";
let filename = "document.txt";
let regexPattern = "[0-9]+";
let flags = "gi";
let condition = true;
let message = "Assertion failed";

// Valid wildcard() functions
wildcard(pattern, filename);     // valid: string variables
wildcard("*.js", "script.js");   // valid: string literals
wildcard("test*", "test123");     // valid: wildcard pattern
wildcard("*.{js,ts}", filename); // valid: glob pattern

// Valid regexp() functions
regexp(regexPattern, flags);      // valid: string variables
regexp("[a-z]+", "i");           // valid: pattern with flags
regexp("\\d+");                  // valid: pattern only (no flags)
regexp(getPattern(), "g");       // valid: function call

// Valid assert() functions with messages
assert(condition, message);       // valid: condition with message
assert(x > 0, "x must be positive"); // valid: expression with message
assert(array.length > 0);         // valid: property access
assert(getValue());               // valid: function call