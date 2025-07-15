// Test file for JSON utility function validations

// json() function - these should NOT show errors (accepts any type):
json(123);                      // valid: number
json(3.14);                     // valid: double
json("string");                 // valid: string
json([1, 2, 3]);                // valid: array
json({key: "value"});           // valid: object
json(true);                     // valid: boolean
json(null);                     // valid: null

// call() function - these should show errors:
call(123, "arg1");              // first param should be function, not number
call("function_name", "arg1");  // first param should be function, not string
call([], "arg1");               // first param should be function, not array
call({}, "arg1");               // first param should be function, not object

// signal() function - these should show errors:
signal("SIGTERM");              // first param should be signal number, not string
signal([]);                     // first param should be signal number, not array
signal({});                     // first param should be signal number, not object
signal(15, 123);                // second param should be handler function, not number
signal(15, "handler");          // second param should be handler function, not string
signal(15, []);                 // second param should be handler function, not array
signal(15, {});                 // second param should be handler function, not object

// These should be valid (no errors):
let functionVar = print;
let signalNumber = 15;
let handlerFunc = function() { print("signal received"); };

// Valid json() functions
let data = {name: "John", age: 30};
let jsonString = json(data);         // valid: object to JSON
let parsedData = json(jsonString);   // valid: JSON string to object
json(getValue());                    // valid: function call result

// Valid call() functions
call(functionVar, "arg1", "arg2");   // valid: function variable
call(print, "Hello World");          // valid: builtin function
call(getUserFunction(), data);       // valid: function call result

// Valid signal() functions
signal(signalNumber);                // valid: number only
signal(15, handlerFunc);             // valid: number and function
signal(2, function() {});            // valid: number and inline function
signal(getSignalNumber(), handler);  // valid: function calls