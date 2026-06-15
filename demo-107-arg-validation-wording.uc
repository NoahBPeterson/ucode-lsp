// #107 — argument-validation diagnostics now use ONE consistent wording.
// Hover each squiggle: every "got" is ", got" (not "but got"), counts pluralize
// correctly ("1 argument" vs "2 arguments"), and too-many/too-few read uniformly.

'use strict';

// ── argument TYPE mismatch:  expects T for argument N, got C ──
regexp(456);             // Function 'regexp' expects string for argument 1, got integer
wildcard("f", []);       // Function 'wildcard' expects string for argument 2, got array
exists(5, "k");          // Function 'exists' expects object for argument 1, got integer

// ── argument COUNT (builtin): expects at least/at most N argument(s), got M ──
substr("x");             // Function 'substr' expects at least 2 arguments, got 1
require("a", "b");       // require() expects 1 argument, got 2   (singular: "1 argument")

// ── argument COUNT (user fn): same "expects at most …, got …" shape ──
function one(a) { return a; }
one("x", "y");           // Function 'one' expects at most 1 argument, got 2 (extra arguments are ignored)

// ── pluralization edge: a single specifier reads "1 specifier" / "1 argument" ──
sprintf("%d %s", 1);     // sprintf(): format string has 2 specifiers but only 1 argument provided
