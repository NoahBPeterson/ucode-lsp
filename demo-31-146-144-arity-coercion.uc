// ============================================================================
// #31 splice arity · #146 zero-arg builtins · #144 sleep union   (uncommitted)
// Toggle the leading 'use strict' to see the strict-gated warnings become errors.
// ============================================================================

// 'use strict';

// ── #31 splice — real minimum arity is 1, not 2 ──
let a = [1, 2, 3];
splice(a);          // clean — the 1-arg form removes ALL elements (was a FALSE "expects 2 args")
splice(a, 1);       // clean — 2-arg
splice(a, 1, 1);    // clean — 3-arg
let b = splice();           // UC2012 warn — no args: returns null, modifies nothing // (variable) b: null (narrowed)
print(b);
splice(5);          // ERROR — non-array first arg returns null (graceful-null, stays strict)

// ── #146 zero-arg builtins — valid in ucode (return null/""), but useless → UC2012 warn ──
let a = min();              // warn: min() has no effect (returns null) — and type of `a` is now `null` (narrowed) // NO HOVER ON `a`
a = max();              // warn — reassignment also narrows: type of `a` here is `null`, not `integer` // (variable) a: null
a = chr();              // warn: returns an empty string // (variable) a: string
a = ord();              // warn // (variable) a: null  — zero-arg ord() is deterministically null
a = type();             // warn // (variable) a: null  — zero-arg type() is deterministically null
a = uchr();             // warn // (variable) a: string
// ...with args they're fine:
a = min(3, 1, 2);       // clean // (variable) a: integer
a = chr(65);            // clean ("A") // (variable) a: string

// ── #144 sleep — arg coerces to a number; union check is now per-member ──
sleep(250);         // clean — integer ms
sleep(10.5);        // clean — double
function pace() {
    let wait = clock()[0] * 1000 + 0.5;   // inferred unknown | double
    sleep(wait);                           // clean — every union member is numeric (was a FALSE error)
}
sleep("250");       // clean — numeric string coerces
sleep("soon");      // warn — non-numeric string coerces to 0 ms (footgun)
sleep([1]);         // warn — array coerces to 0 ms (footgun)
