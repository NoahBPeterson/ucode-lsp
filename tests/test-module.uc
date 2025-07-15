// Test file for module function validations

// require() function - these should show errors:
require(123);             // should be string path, not number
require(45.67);           // should be string path, not double
require([]);              // should be string path, not array
require({});              // should be string path, not object

// include() function - these should show errors:
include(789);             // should be string path, not number
include(12.34);           // should be string path, not double
include([1, 2]);          // should be string path, not array
include({key: "value"});  // should be string path, not object

// loadstring() function - these should show errors:
loadstring(456);          // should be string code, not number
loadstring(7.89);         // should be string code, not double
loadstring([]);           // should be string code, not array
loadstring({});           // should be string code, not object

// loadfile() function - these should show errors:
loadfile(101);            // should be string path, not number
loadfile(2.71);           // should be string path, not double
loadfile([]);             // should be string path, not array
loadfile({file: "test"}); // should be string path, not object

// These should be valid (no errors):
let modulePath = "./utils";
let configFile = "config.uc";
let scriptCode = "return 42";
let filename = "data.uc";

// Valid require() functions
require(modulePath);      // valid: string variable
require("./helpers");     // valid: string literal
require("math");          // valid: built-in module
require("../lib/utils");  // valid: relative path

// Valid include() functions
include(configFile);      // valid: string variable
include("header.uc");     // valid: string literal
include("./common.uc");   // valid: relative path
include("/etc/config");   // valid: absolute path

// Valid loadstring() functions
loadstring(scriptCode);   // valid: string variable
loadstring("let x = 5");  // valid: string literal
loadstring("print('hi')"); // valid: code string
loadstring(getCode());    // valid: function returning string

// Valid loadfile() functions
loadfile(filename);       // valid: string variable
loadfile("script.uc");    // valid: string literal
loadfile("./test.uc");    // valid: relative path
loadfile("/tmp/temp.uc"); // valid: absolute path