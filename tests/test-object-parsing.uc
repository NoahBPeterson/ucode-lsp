// Test object literal parsing
let test_obj = {
    eth0: "network interface",
    rx_packets: 100,
    tx_packets: 50,
    "quoted_key": "value",
    123: "numeric key",
    simple: "basic key"
};

// Test nested objects
let nested = {
    interface: {
        eth0: { speed: 1000 },
        eth1: { speed: 100 }
    }
};

// Test mixed key types
let mixed = {
    foo: "bar",
    "complex key": "value",
    42: "number",
    baz_123: "underscore and number"
};

print(test_obj);
print(nested);
print(mixed);