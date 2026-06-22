// Test file for trim validation
// These should show errors:
ltrim(0);
rtrim(123);
trim(456);

let someVariable = " test";
let myString = " test   ";

// These should be valid:
ltrim("hello");
rtrim("world");
trim("test");
ltrim(someVariable);
rtrim(myString);