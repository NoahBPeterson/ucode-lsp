// Test file for object property key diagnostics
let obj = {};
let iface = "eth0";
let cols = [100, 200, 300];

function to_num(val) {
    return parseInt(val);
}

// This should NOT show "Undefined variable" errors on the property keys
obj[iface] = {
    rx_bytes:      to_num(cols[0]),
    rx_packets:    to_num(cols[1]),
    rx_err:        to_num(cols[2]),
    rx_drop:       to_num(cols[3]),
    rx_fifo:       to_num(cols[4]),
    rx_frame:      to_num(cols[5]),
    rx_cmp:        to_num(cols[6]),
    rx_mcast:      to_num(cols[7]),
    tx_bytes:      to_num(cols[8]),
    tx_packets:    to_num(cols[9]),
    tx_err:        to_num(cols[10]),
    tx_drop:       to_num(cols[11]),
    tx_fifo:       to_num(cols[12]),
    tx_coll:       to_num(cols[13]),
    tx_carrier:    to_num(cols[14]),
    tx_cmp:        to_num(cols[15])
};

print("Object created successfully");