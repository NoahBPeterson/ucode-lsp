// Test file for system function validations

// System function - these should show errors:
system(123);           // should be string command, not number
system(456.78);        // should be string command, not double

// Sleep function - these should show errors:
sleep("5");            // should be number of seconds, not string
sleep("2.5");          // should be number of seconds, not string

// These should be valid (no errors):
let command = "ls -la";
let seconds = 5;
let duration = 2.5;

// Valid system functions
system(command);              // valid: string variable
system("pwd");                // valid: string literal
system("echo 'hello'");       // valid: string with quotes

// Valid sleep functions  
sleep(seconds);               // valid: number variable
sleep(5);                     // valid: number literal
sleep(duration);              // valid: double variable
sleep(2.5);                   // valid: double literal