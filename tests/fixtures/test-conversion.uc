// Test file for conversion function validations

// int() function - these should show errors:
int([1, 2, 3]);           // should be string/number, not array
int([]);                  // should be string/number, not array
int({value: 123});        // should be string/number, not object
int({});                  // should be string/number, not object

// These should be valid (no errors):
let stringNumber = "123";
let intNumber = 456;
let floatNumber = 78.9;
let variable = someValue;

// Valid int() functions
int(stringNumber);        // valid: string variable
int("123");               // valid: string literal
int("-456");              // valid: negative string
int("0");                 // valid: zero string
int(intNumber);           // valid: number variable
int(456);                 // valid: number literal
int(-789);                // valid: negative number
int(0);                   // valid: zero
int(floatNumber);         // valid: double variable
int(78.9);                // valid: double literal
int(-12.34);              // valid: negative double
int(variable);            // valid: variable (could be string or number)
int(getValue());          // valid: function call returning string/number