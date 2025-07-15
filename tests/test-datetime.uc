// Test file for date/time function validations

// localtime() function - these should show errors:
localtime("123456");      // should be number timestamp, not string
localtime("now");         // should be number timestamp, not string

// gmtime() function - these should show errors:
gmtime("timestamp");      // should be number timestamp, not string
gmtime("2024-01-01");     // should be number timestamp, not string

// timelocal() function - these should show errors:
timelocal("array");       // should be array, not string
timelocal(123456);        // should be array, not number
timelocal(2024);          // should be array, not number

// timegm() function - these should show errors:
timegm("components");     // should be array, not string
timegm(987654);           // should be array, not number
timegm(2024.5);           // should be array, not double

// These should be valid (no errors):
let timestamp = 1640995200;
let timeComponents = [2024, 0, 1, 12, 0, 0]; // year, month, day, hour, min, sec

// Valid localtime() functions
localtime();              // valid: no parameters (uses current time)
localtime(timestamp);     // valid: number timestamp
localtime(1640995200);    // valid: number literal
localtime(Date.now());    // valid: function call returning number

// Valid gmtime() functions  
gmtime();                 // valid: no parameters (uses current time)
gmtime(timestamp);        // valid: number timestamp
gmtime(1609459200);       // valid: number literal
gmtime(time());           // valid: function call returning number

// Valid timelocal() functions
timelocal(timeComponents); // valid: array variable
timelocal([2024, 0, 1, 12, 0, 0]); // valid: array literal
timelocal([]);            // valid: empty array

// Valid timegm() functions
timegm(timeComponents);   // valid: array variable
timegm([2024, 0, 1, 12, 0, 0]); // valid: array literal
timegm(getTimeArray());   // valid: function call returning array