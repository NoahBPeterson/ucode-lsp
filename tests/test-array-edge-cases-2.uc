// Array<T> Edge Cases — Round 2 (polymorphic returns, chaining, narrowing)
// Expected: 0 diagnostics

// ============================================================
// 1. REVERSE() — polymorphic: array→array, string→string
// ============================================================

let rev_arr = reverse([1, 2, 3]);               // array<integer>
let rev_str = reverse("hello");                  // string
let rev_str_arr = reverse(["a", "b", "c"]);      // array<string>
let rev_mixed = reverse([1, "two"]);             // array<integer | string>

// Chain: reverse preserves element type from split
let rev_split = reverse(split("a,b,c", ","));   // array<string>

// ============================================================
// 2. SLICE() — preserves element type
// ============================================================

let nums = [10, 20, 30, 40, 50];
let sliced = slice(nums, 1, 3);                  // array<integer>
let sliced_str = slice(["a", "b", "c"], 0, 2);   // array<string>

// Slice of split result
let sliced_split = slice(split("x,y,z", ","), 1); // array<string>

// Element access on slice result
let slice_elem = slice(nums, 1, 3)[0];           // integer

// ============================================================
// 3. POP() / SHIFT() — extract element type
// ============================================================

let str_arr = ["hello", "world"];
let int_arr = [1, 2, 3];

// Basic pop/shift from literal arrays
let p1 = pop(str_arr);                           // string
let s1 = shift(int_arr);                         // integer

// Pop/shift from function results
let p2 = pop(split("a,b,c", ","));               // string
let s2 = shift(iptoarr("10.0.0.1"));             // integer
let p3 = pop(keys({ x: 1, y: 2 }));              // string
let s3 = shift(sort(["c", "a", "b"]));            // string

// Pop/shift from filtered arrays
let p4 = pop(filter([1, 2, 3, 4], (n) => n > 2)); // integer
let s4 = shift(filter(["ab", "c"], (s) => length(s) > 1)); // string

// Pop/shift from sorted arrays
let p5 = pop(sort([5, 3, 1]));                   // integer
let s5 = shift(sort(split("c,a,b", ",")));        // string

// Pop/shift from match (returns array<string>)
let p6 = pop(match("abc123", /([a-z]+)/));        // string

// Pop/shift from uniq
let p7 = pop(uniq([1, 2, 2, 3]));                // integer

// Pop/shift from reverse
let p8 = pop(reverse([10, 20]));                  // integer
let s8 = shift(reverse(["x", "y"]));              // string

// Pop/shift from splice
let p9 = pop(splice([1, 2, 3, 4], 1, 2));        // integer

// ============================================================
// 4. MAP() — always returns plain array (callback return unknown)
// ============================================================

let mapped_ints = map([1, 2, 3], (n) => n * 2);        // array
let mapped_strs = map(["a", "b"], (s) => uc(s));        // array
let mapped_to_str = map([1, 2], (n) => sprintf("%d", n)); // array

// Element access on map result — unknown type
let map_elem = map([1, 2, 3], (n) => n + 1)[0];  // unknown

// Map then sort — still plain array (no element type)
let map_sort = sort(map([3, 1, 2], (n) => n));    // array

// ============================================================
// 5. VALUES() — returns plain array (element type unknown)
// ============================================================

let obj = { name: "Alice", age: 30 };
let v = values(obj);                              // array
let v_elem = values(obj)[0];                      // unknown

// ============================================================
// 6. DEEP CHAINS — element type propagation
// ============================================================

// split → sort → filter → element access
let chain1 = filter(sort(split("banana,apple,cherry", ",")), (s) => length(s) > 5);
// chain1: array<string>
let chain1_elem = chain1[0];                      // string

// split → reverse → pop
let chain2 = pop(reverse(split("x,y,z", ",")));   // string

// iptoarr → sort → shift
let chain3 = shift(sort(iptoarr("192.168.1.1"))); // integer

// split → uniq → sort → element access
let chain4 = sort(uniq(split("a,b,a,c,b", ",")))[0]; // string

// keys → sort → reverse → pop
let chain5 = pop(reverse(sort(keys({ z: 1, a: 2 })))); // string

// iptoarr → filter → reverse → shift
let chain6 = shift(reverse(filter(iptoarr("10.20.30.40"), (n) => n > 15))); // integer

// ============================================================
// 7. SORT() with comparator — preserves element type
// ============================================================

let sorted_desc = sort([5, 3, 8, 1], (a, b) => b - a);  // array<integer>
let sorted_len = sort(["bb", "a", "ccc"], (a, b) => length(a) - length(b)); // array<string>
let sorted_desc_elem = sort([5, 3, 8, 1], (a, b) => b - a)[0]; // integer

// Sort of split with comparator
let sorted_split = sort(split("banana,apple,cherry", ","), (a, b) => length(a) - length(b)); // array<string>

// ============================================================
// 8. FILTER() — preserves element type
// ============================================================

let filtered_ints = filter([1, 2, 3, 4, 5], (n) => n % 2 == 0);  // array<integer>
let filtered_strs = filter(["", "a", "", "b"], (s) => length(s) > 0); // array<string>
let filtered_elem = filter([10, 20, 30], (n) => n > 15)[0]; // integer

// Filter of iptoarr result
let filtered_ip = filter(iptoarr("192.168.1.100"), (n) => n > 100); // array<integer>

// Filter then pop
let filter_pop = pop(filter([1, 2, 3], (n) => n > 1)); // integer

// ============================================================
// 9. UNIQ() — preserves element type
// ============================================================

let uniq_ints = uniq([1, 1, 2, 3, 3]);           // array<integer>
let uniq_strs = uniq(["a", "b", "a"]);            // array<string>
let uniq_elem = uniq([1, 2, 2])[0];              // integer

// Uniq of split
let uniq_split = uniq(split("a,b,a,c", ","));     // array<string>

// ============================================================
// 10. SPLICE() — preserves element type
// ============================================================

let spliced_ints = splice([1, 2, 3, 4, 5], 1, 2); // array<integer>
let spliced_strs = splice(["a", "b", "c"], 0, 1);  // array<string>
let splice_elem = splice([10, 20, 30], 1, 1)[0];   // integer

// Splice of sorted result
let splice_sorted = splice(sort([3, 1, 2]), 0, 1); // array<integer>

// ============================================================
// 11. FOR-IN with function results (element type flows through)
// ============================================================

// For-in over split result
for (let part in split("a,b,c", ",")) {
    // part: string
    print(length(part));
}

// For-in over iptoarr result
for (let octet in iptoarr("10.0.0.1")) {
    // octet: integer
    print(octet + 1);
}

// For-in over sorted split
for (let word in sort(split("c,a,b", ","))) {
    // word: string
    print(word);
}

// For-in over filter result
for (let n in filter([1, 2, 3, 4], (x) => x > 2)) {
    // n: integer
    print(n);
}

// For-in with index over keys()
for (let i, key in keys({ a: 1, b: 2 })) {
    // i: integer, key: string
    print(i, key);
}

// For-in over reverse of array
for (let val in reverse([10, 20, 30])) {
    // val: integer
    print(val);
}

// For-in over match result
for (let group in match("hello123", /([a-z]+)([0-9]+)/)) {
    // group: string
    print(group);
}

// ============================================================
// 12. ASSIGNMENT TRACKING — type changes through reassignment
// ============================================================

// Start as string, become array<string> via split, then element via pop
let pipeline = "hello world";                    // string
pipeline = split(pipeline, " ");                 // array<string>
let pipe_elem = pop(pipeline);                   // string

// Start as array<integer>, filter, sort
let nums2 = [5, 3, 8, 1, 9];                    // array<integer>
nums2 = filter(nums2, (n) => n > 3);            // array<integer>
nums2 = sort(nums2);                             // array<integer>
let nums2_first = nums2[0];                      // integer

// ============================================================
// 13. NESTED ARRAY OPERATIONS
// ============================================================

// Array of arrays — map over inner arrays
let rows = [[1, 2], [3, 4], [5, 6]];            // array<array<integer>>
let first_row = rows[0];                          // array<integer>
let first_cell = rows[0][0];                      // integer

// Sort of array of arrays
let sorted_rows = sort(rows, (a, b) => a[0] - b[0]); // array<array<integer>>

// Reverse of nested
let rev_rows = reverse(rows);                     // array<array<integer>>

// Pop from nested — should get inner array type
let last_row = pop(rows);                         // array<integer>

// ============================================================
// 14. INDEX() / RINDEX() — always return integer regardless of array type
// ============================================================

let idx1 = index([1, 2, 3], 2);                  // integer
let idx2 = index(["a", "b", "c"], "b");           // integer
let idx3 = rindex([1, 2, 3, 2], 2);              // integer
let idx4 = index(split("a,b,c", ","), "b");       // integer

// ============================================================
// 15. LENGTH() — always returns integer regardless of input type
// ============================================================

let len1 = length([1, 2, 3]);                    // integer
let len2 = length(split("a,b,c", ","));           // integer
let len3 = length(sort([3, 1, 2]));               // integer
let len4 = length(filter([1, 2, 3], (n) => n > 1)); // integer

// ============================================================
// 16. JOIN() — always returns string
// ============================================================

let j1 = join(",", [1, 2, 3]);                   // string
let j2 = join("-", split("a,b,c", ","));          // string
let j3 = join("", sort(["c", "a", "b"]));         // string
let j4 = join(",", iptoarr("10.0.0.1"));          // string

// ============================================================
// 17. PUSH() / UNSHIFT() — return integer (new length)
// ============================================================

let arr = [1, 2, 3];
let push_ret = push(arr, 4);                     // integer
let unshift_ret = unshift(arr, 0);               // integer

// Array still typed after push/unshift
let after_push = arr[0];                          // integer

// ============================================================
// 18. ARRTOIP() — string return, array<integer> input
// ============================================================

let ip1 = arrtoip([192, 168, 1, 1]);             // string
let ip2 = arrtoip(iptoarr("10.0.0.1"));          // string

// ============================================================
// Suppress unused variable warnings
// ============================================================
print(rev_arr, rev_str, rev_str_arr, rev_mixed, rev_split);
print(nums, sliced, sliced_str, sliced_split, slice_elem);
print(str_arr, int_arr, p1, s1, p2, s2, p3, s3);
print(p4, s4, p5, s5, p6, p7, p8, s8, p9);
print(mapped_ints, mapped_strs, mapped_to_str, map_elem, map_sort); // map_elem unknown => but expected ;)
print(obj, v, v_elem);
print(chain1, chain1_elem, chain2, chain3, chain4, chain5, chain6);
print(sorted_desc, sorted_len, sorted_desc_elem, sorted_split);
print(filtered_ints, filtered_strs, filtered_elem, filtered_ip, filter_pop);
print(uniq_ints, uniq_strs, uniq_elem, uniq_split);
print(spliced_ints, spliced_strs, splice_elem, splice_sorted);
print(pipeline, pipe_elem);
print(nums2, nums2_first);
print(rows, first_row, first_cell, sorted_rows, rev_rows, last_row);
print(idx1, idx2, idx3, idx4);
print(len1, len2, len3, len4);
print(j1, j2, j3, j4);
print(arr, push_ret, unshift_ret, after_push);
print(ip1, ip2);
