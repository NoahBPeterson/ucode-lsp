// #106 — UC2008 (NaN) and UC2009 (impossible comparison) are now a fixed ERROR in
// BOTH modes. They were Warning-without-'use strict' / Error-with — but the bug is
// deterministic regardless of the pragma (strict only governs undeclared-variable
// access, never arithmetic or comparison). Toggle the leading 'use strict' on/off:
// every severity below stays Error.

// 'use strict';   // ← uncomment: nothing below changes severity anymore

// ── UC2008: always produces NaN ──
let n1 = 5 + {};                 // ❌ Error — object can't coerce to a number
let n2 = [1] - 1;                // ❌ Error
let n3 = -[1, 2];                // ❌ Error (unary)

// ── UC2009: comparison provably always true/false ──
let o = {};
let c1 = (o == 5);               // ❌ Error — object can never == a scalar
let c2 = (type(o) == "number");  // ❌ Error — type() never returns "number"
let s = "x";
let c3 = (index(s, "m") != -2);  // ❌ Error — index() ≥ -1, so != -2 is always true
let c4 = (1 in 2);               // ❌ Error — 'in' over a scalar is always false
                                 //    (was already a fixed Error; now its siblings match)
