// Test arrow function parsing
current_line = current_line.replace(mac_regex, (match) => {
    const upper_mac = match.toUpperCase();
    return mac_to_hostname[upper_mac] || match;
});

// Test simple arrow function
let square = x => x * x;

// Test arrow function with parentheses
let add = (a, b) => a + b;