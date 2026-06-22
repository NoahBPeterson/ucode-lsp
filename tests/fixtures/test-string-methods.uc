// Test string method validation
let text = "hello world";
let mac = "00:11:22:33:44:55";

// This should be valid - strings have a length property
let len = text.length;

// These should show errors - strings don't have methods in ucode
let upper = text.toUpperCase();
let lower = mac.toLowerCase();
let replaced = text.replace("world", "ucode");
let split_result = mac.split(":");

// String methods from JS that don't exist in ucode
let trimmed = text.trim();
let substr = text.substring(0, 5);
let char = text.charAt(0);
let index = text.indexOf("world");