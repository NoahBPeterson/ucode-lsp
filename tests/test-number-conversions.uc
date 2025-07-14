// Test file for number conversion function validations

// Hex function - these should show errors:
hex("string");         // should be number

// Hexdec function - these should show errors:
hexdec(123);          // should be string

// Hexenc function - these should show errors:
hexenc(456);          // should be string

// These should be valid (no errors):
hex(255);             // valid: number to hex
hexdec("FF");         // valid: hex string to number
hexdec("0xFF");       // valid: hex string to number
hexenc("hello");      // valid: string to hex encoding