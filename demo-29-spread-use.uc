// #29 — a variable used ONLY via spread (...a) must not be reported as
// "declared but never used" (UC1006). It IS used. Before the fix the LSP dropped
// SpreadElement nodes, so the identifier inside was never marked used.
//
// In the editor: no UC1006 squiggle on `oa`, `ar`, or `args`.
// Run: ucode demo-29-spread-use.uc   → prints 2 / 1 / [ 1, 2 ]

let oa = { x: 1 };
let merged = { ...oa, y: 2 };
print(merged.y, "\n");            // 2
print(merged.x, "\n");            // 1  — `x` is carried in from `...oa`, typed integer

let ar = [1, 2];
let bigger = [...ar, 3];
print(bigger[0], "\n");           // 1

function collect(...rest) { return rest; }
let args = [1, 2];
print(collect(...args), "\n");    // [ 1, 2 ]
