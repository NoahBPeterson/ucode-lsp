// #103 — every diagnostic now carries a stable UC#### code (was: typeChecker /
// builtinValidation / parser diagnostics shipped un-coded). Open in the editor and
// hover each squiggle: the code appears in the diagnostic (and is filterable/linkable).

'use strict';

// ── typeChecker ──
undefined_fn_zzz();        // UC1002  Undefined function
(5)();                     // UC2010  Cannot call integer as function   (NEW code)
let s = "hi";
s.length;                  // UC5003  Property does not exist on string type
let a = [1, 2];
a.foo;                     // UC5003  Property does not exist on array type
let r = 1 in 2;            // UC2009  'in' over a integer is always false

// ── builtinValidation ──
substr("x");               // UC2003  expects at least 2 arguments
let m = require("fs", "x");// UC2003  require() expects 1 argument
exists(5, "k");            // UC2004  exists expects object for argument 1

// ── parser ──
break                      // UC6003  Expected ';' after 'break'   (missing-semicolon)
let broken = ;             // UC6001  syntax error (umbrella)
