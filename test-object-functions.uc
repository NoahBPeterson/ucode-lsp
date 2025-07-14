// Test file for object function validations

// Keys function - these should show errors:
keys("string");        // should be object
keys(123);             // should be object

// Values function - these should show errors:
values("string");      // should be object
values(456);           // should be object

// Exists function - these should show errors:
exists("string", "key");    // first param should be object
exists(123, "key");         // first param should be object
exists(myObject, 456);      // second param should be string

// These should be valid (no errors):
let myObject = {
    name: "test",
    value: 42,
    active: true
};

keys(myObject);              // valid: object
values(myObject);            // valid: object
exists(myObject, "name");    // valid: object and string key
exists(myObject, "missing"); // valid: object and string key