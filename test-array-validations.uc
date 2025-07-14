// Test file for array function validations

// Basic array functions - these should show errors (non-arrays as first param):
push("string", "item");    // first param should be array
push(123, "item");         // first param should be array
pop("string");             // first param should be array
pop(456);                  // first param should be array
shift("string");           // first param should be array
shift(789);                // first param should be array
unshift("string", "item"); // first param should be array
unshift(101, "item");      // first param should be array

// Array manipulation functions - these should show errors:
sort("string");            // first param should be array
sort(123);                 // first param should be array
reverse("string");         // first param should be array
reverse(456);              // first param should be array

// Slice function - these should show errors:
slice("string", 1, 3);     // first param should be array
slice(myArray, "1", 3);    // second param should be number
slice(myArray, 1, "3");    // third param should be number

// Splice function - these should show errors:
splice("string", 1, 2);    // first param should be array
splice(myArray, "1", 2);   // second param should be number
splice(myArray, 1, "2");   // third param should be number

// Join function (special case: join(separator, array)) - these should show errors:
join(",", "string");       // second param should be array
join(",", 123);            // second param should be array

// These should be valid (no errors):
let myArray = [1, 2, 3];
push(myArray, "newItem");
pop(myArray);
shift(myArray);
unshift(myArray, "firstItem");
sort(myArray);
reverse(myArray);
slice(myArray, 1, 3);
splice(myArray, 1, 2, "replacement");
join(",", myArray);        // Note: uCode parameter order