// Test case for unknown return types
// Function with early return that returns a parameter
function checkValue(val) {
    if (val < 0) {
        return "negative";
    }
    if (val > 100) {
        return "too high";
    }
    return val;  // This should make the return type "string | unknown"
}

// Function that returns only a parameter
function identity(x) {
    return x;  // This should be "unknown"
}

// Function that returns mixed types including parameter
function processValue(input) {
    if (input === null) {
        return 0;
    }
    if (typeof input === "string") {
        return "processed";
    }
    return input;  // This should be "integer | string | unknown"
}

// Test the functions
checkValue(40);   // Should infer string | unknown
checkValue(101);  // Should infer string | unknown

identity(42);     // Should infer unknown
identity("test"); // Should infer unknown

processValue(null);    // Should infer integer | string | unknown
processValue("hello"); // Should infer integer | string | unknown
processValue(123);     // Should infer integer | string | unknown