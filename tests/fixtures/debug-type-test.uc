// Debug test for type inference
let myString = "hello";
length(myString);      // Should be valid
length(123);           // Should be invalid

let myArray = [1, 2, 3];
length(myArray);       // Should be valid  
index(myArray, 2);     // Should be valid
index(123, "test");    // Should be invalid