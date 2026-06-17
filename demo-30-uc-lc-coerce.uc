// ============================================================================
// #30 — uc()/lc() on a non-string. (uncommitted; spot-check)
//
// uc/lc are TOTAL: they stringify ANY value (verified: uc([1,2]) -> "[[ 1, 2 ]]",
// uc(null) -> "NULL"). So a non-string is never a runtime error -> never a hard
// LSP error. But relying on implicit coercion is worth a nudge, so:
//   - DEFINITE non-string (non-null)  -> WARNING (non-strict) / ERROR ('use strict')
//                                        + a "Coerce to string" quick-fix
//   - possibly-null (string|null)     -> keeps the existing "possibly null" warning
//                                        (null is a separate concern: guard, don't coerce)
//   - a real string / guarded value   -> clean
//
// Toggle the leading 'use strict' to see the warnings flip to errors.
// ============================================================================

'use strict';

// ── DEFINITE non-string -> warning + quick-fix "Coerce to string" ──
print(uc("" + 5));              // warn: uc expects a string; integer will be coerced.  Quick-fix -> uc("" + 5)
print(lc("" + 255));            // warn (lc).                                            Quick-fix -> lc("" + 255)
print(uc("" + [1, 2]));         // warn: array will be coerced.                         Quick-fix -> uc("" + [1, 2])
print(uc("" + true));           // warn: boolean will be coerced.

let a = 10;
print(uc("" + a), '\n\n');


// ── quick-fix parenthesizes only when the arg's AST node needs it ──
uc("" + (1 + 2));          // Quick-fix -> uc("" + (1 + 2))      (binary -> parens)
function pick(x) {
    print(uc("" + (x ? 1 : false)));   // Quick-fix -> uc("" + (x ? 1 : 2))   (ternary -> parens)
    return uc("" + (x ? 1 : 2));   // Quick-fix -> uc("" + (x ? 1 : 2))   (ternary -> parens)
}

// ── valid: a real string is clean ──
uc("hello");        // clean
let name = "bob";
lc(name);           // clean (name is a string)

// ── possibly-null: keeps the "possibly null" warning, NOT the coerce path ──
/**
 * @param {string} line
 */
function f(line) {
    let parts = split(line, ",");   // array<string> | null -> parts[5] is string | null
    uc(parts[5]);                    // warn: argument is possibly 'null'  (no coerce fix here)
    if (parts[5])                    // guarded:
        uc(parts[5]);                //   clean (narrowed to string)
}

f(""+1);
