// Simple test case for type narrowing

// Test with known union type
let a = null; // Explicitly null type
let obj = {"test": 1};

// This should cause an error due to null
if (5 in a) {
    print("This should error");
}

// Test function argument issue with built-in function
let mixed_value = 5; // integer, but arrtoip expects array
arrtoip(mixed_value); // Should error: expects array, got integer