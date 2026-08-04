# UC8004 FP: `if (!exists(global, 'X')) global.X = v;` IS the definition guarantee

Status: **SHIPPED 0.7.91** — existence-guard rule in UC8004's must-assign
IfStatement case (semanticAnalyzer `existsGuard`), incl. inverted/boolean-literal
spellings and `global['X']` bracket-key targets (globalTargetName now reads
string-literal computed keys). Tests: tests/diagnostics/
test-exists-guard-seeding.test.js (10). Corpus differential byte-identical.

## The report

```ucode
/* strict mode compliance: ensure that global variables are defined */
if (!exists(global, 'REQUIRE_SEARCH_PATH'))
    global.REQUIRE_SEARCH_PATH = [];
// UC8004: "assigned only inside a conditional branch, so its existence at a
// later read isn't guaranteed" — WRONG here: after this if, existence IS
// guaranteed on BOTH paths (either it already existed, or we just assigned it).
```

Runtime-verified: the file runs and prints the interpreter-seeded search path —
the guard's whole purpose is "define only if absent" without clobbering a
pre-existing value. UC8004's must-assign analysis (0.7.31-32) is right that a
conditional assignment alone doesn't guarantee existence; it just can't see
that THIS condition is the existence test itself.

## Fix sketch

In the UC8004 must-assign machinery, treat an if-statement as an unconditional
definition point for global property NAME when:
- the test is `!exists(global, 'NAME')` (string literal matching the assigned
  property; also accept the `exists(global, 'NAME') == false` /
  `=== false` spellings and the inverted `if (exists(...)) {} else { assign }`
  shape), and
- the then-branch (or else-branch for the inverted form) assigns
  `global.NAME = ...` (or `global['NAME'] = ...`).

The exhaustive-if precision pass in the same analysis (both-arms-assign,
switch-with-default, etc.) is the natural place — this adds "one arm assigns,
the OTHER arm is proven-already-defined by the test". Mind the aliasing edge:
only literal `global` receivers (the analysis already scopes to those). A
`!exists(global, k)` with a VARIABLE key proves nothing about a specific name —
require the string literal.

## Tests

The exact idiom (no UC8004; later reads clean); inverted else-form; bracket
key form; a `!exists(global, 'OTHER')` MISMATCHED name still flags the
assignment of X; variable-key `!exists(global, k)` still flags; plain
`if (cond) global.X = 1` (unrelated condition) still flags — the existing
true-positive stays.
