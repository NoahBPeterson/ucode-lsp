// Test cases for type validation

// Length function - these should show errors (numbers not allowed):
length(123);           // ERROR: Function 'length' expects string, array, or object, got integer
length(456.78);        // ERROR: Function 'length' expects string, array, or object, got double

// Index function - these should show errors (numbers as haystack not allowed):
index(123, "needle");  // ERROR: Function 'index' expects string or array as first argument, got integer
index(456, "search");  // ERROR: Function 'index' expects string or array as first argument, got integer

// Rindex function - these should show errors (numbers not allowed):
rindex(123, "needle"); // ERROR: Function 'rindex' expects string as first argument, got integer
rindex(456, "search"); // ERROR: Function 'rindex' expects string as first argument, got integer

// Valid cases - these should NOT show errors:
length("hello");       // string - valid
length([1, 2, 3]);     // array - valid
length({a: 1, b: 2});  // object - valid

index("hello", "l");   // string haystack - valid
index([1, 2, 3], 2);   // array haystack - valid

rindex("hello", "l");  // string haystack - valid

// Some additional test cases:
split("hello", 123);   // ERROR: Function 'split' expects string for argument 2, got integer
substr(123, 0, 5);     // ERROR: Function 'substr' expects string for argument 1, got integer