// Test file for network function validations

// iptoarr() function - these should show errors:
iptoarr(192);             // should be IP string, not number
iptoarr(168.1);           // should be IP string, not double
iptoarr(127001);          // should be IP string, not number

// arrtoip() function - these should show errors:
arrtoip("192.168.1.1");   // should be array, not string
arrtoip(192);             // should be array, not number
arrtoip(255.255);         // should be array, not double

// These should be valid (no errors):
let ipString = "192.168.1.1";
let ipv6String = "2001:db8::1";
let ipComponents = [192, 168, 1, 1];
let ipv6Components = [0x2001, 0xdb8, 0, 0, 0, 0, 0, 1];

// Valid iptoarr() functions
iptoarr(ipString);              // valid: string variable
iptoarr("10.0.0.1");            // valid: IPv4 string literal
iptoarr("127.0.0.1");           // valid: localhost IP
iptoarr(ipv6String);            // valid: IPv6 string
iptoarr("::1");                 // valid: IPv6 localhost

// Valid arrtoip() functions  
arrtoip(ipComponents);          // valid: array variable
arrtoip([10, 0, 0, 1]);         // valid: IPv4 array literal
arrtoip([127, 0, 0, 1]);        // valid: localhost array
arrtoip(ipv6Components);        // valid: IPv6 array variable
arrtoip([]);                    // valid: empty array