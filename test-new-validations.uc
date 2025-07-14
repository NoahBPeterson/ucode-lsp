// Test file for new function validations

// String functions - these should show errors:
uc(123);
lc(456);

// Character functions - these should show errors:
chr("hello");  // should be number
ord(789);      // should be string
uchr("world"); // should be number

// Split function - these should show errors:
split(123, ",");        // first param should be string
split("hello", 456);    // second param should be string/regex

// Replace function - these should show errors:
replace(123, "old", "new");     // first param should be string
replace("hello", 456, "new");   // second param should be string/regex
replace("hello", "old", 789);   // third param should be string

// These should be valid (no errors):
uc("hello");
lc("WORLD");
chr(65);
ord("A");
uchr(8364);
split("hello,world", ",");
replace("hello world", "world", "universe");