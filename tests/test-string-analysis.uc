// Test file for string analysis function validations

// Length function - these should show errors (numbers not allowed):
length(1234);           // should be string, array, or object
length(4564.78);        // should be string, array, or object

// Index function - these should show errors (numbers as haystack not allowed):
index(1234, "needle");  // first param should be string or array
index(4564, "search");  // first param should be string or array

// Rindex function - these should show errors (numbers not allowed):
rindex(1234, "needle"); // first param should be string
rindex(4564, "search"); // first param should be string

// Match function - these should show errors:
match(1234, /pattern/); // first param should be string
match("text", 4564);    // second param should be regex or string

// These should be valid (no errors):
let myString = "hello world";
let myArray = [1, 2, 3, 4, 5];
let myObject = { a: 1, b: 2 };

length(myString);      // valid: string
length(myArray);       // valid: array  
length(myObject);      // valid: object
index(myString, /world/);     // valid: string haystack
index(myArray, 3);            // valid: array haystack
rindex(myString, "l");        // valid: string search
match(myString, /world/);     // valid: string and regex
match(myString, "world");     // valid: string and string pattern