// Test for-in loop with bare identifier (no let/const)
let all_stations = { station1: "data1", station2: "data2" };
let station_total = 0;

// This should work without diagnostic errors
for (s in all_stations) station_total++;

// This also should work
for (key in all_stations) {
    print(key);
}

// These should also work (with declarations)
for (let item in all_stations) {
    print(item);
}

for (const entry in all_stations) {
    print(entry);
}