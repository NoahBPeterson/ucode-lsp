// Test file for encoding and I/O function validations

// Base64 encoding functions - these should show errors:
b64enc(123);           // should be string, not number
b64enc(456.78);        // should be string, not double
b64dec(789);           // should be string, not number  
b64dec(101.5);         // should be string, not double

// I/O functions - these should show errors:
printf(123);           // first param should be format string, not number
printf(456.78);        // first param should be format string, not double
sprintf(789);          // first param should be format string, not number
sprintf(101.5);        // first param should be format string, not double

// These should be valid (no errors):
let myString = "hello world";
let base64String = "aGVsbG8gd29ybGQ=";
let formatString = "Hello %s, you have %d messages";

// Valid encoding functions
b64enc(myString);              // valid: string input
b64enc("hello");               // valid: string literal
b64dec(base64String);          // valid: base64 string
b64dec("aGVsbG8=");            // valid: base64 string literal

// Valid I/O functions  
printf(formatString, "John", 5);     // valid: format string with args
printf("Simple message");            // valid: simple format string
sprintf(formatString, "Jane", 3);    // valid: format string with args  
sprintf("Value: %d", 42);            // valid: format string literal
print("This accepts anything", 123, 456.78);  // print() accepts any types