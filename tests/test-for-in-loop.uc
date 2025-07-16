// Test for-in loop parsing
let snap1 = { eth0: { rx_packets: 100, tx_packets: 50 } };
let snap2 = { eth0: { rx_packets: 200, tx_packets: 75 } };

let lines = [];

// This should NOT produce syntax errors - complex for-in loop
for (let iface in snap1) {

    push(lines, iface);
}

// Test other for-in variations
for (const key in snap2) {
    print(key);
}

// Test regular for loop (should still work)
for (let i = 0; i < 10; i++) {
    print(i);
}