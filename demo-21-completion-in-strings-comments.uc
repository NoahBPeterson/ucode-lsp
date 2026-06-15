// #21 — completion must NOT fire inside string literals or comments. Put the cursor right
// after each `.` below and trigger completion: nothing should pop up (before the fix, the 91
// global builtins were offered, and the first could auto-insert on Enter).

let path = "/etc/config.d/network";   // the dots in the path: no completion
let host = 'example.com';              // the dot before `com`: no completion
let msg  = sprintf("%d.%d", a, b);     // the dot in the format string: no completion

// A line comment with a dot like obj.method — no completion here either.

/*
   A block comment: writing fs.open or http.get — no completion in here.
*/

// Contrast (these SHOULD still complete — handled before the suppression):
import { open } from 'fs';   // cursor inside the 'fs' string -> module names
/** @param {strin} x */      // cursor in the JSDoc type -> type names
function f(x) { return x; }
