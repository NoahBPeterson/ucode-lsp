# UC2009 FP: branch-reassignment resurrects an uninitialized `let`'s declared null

Status: **IMPLEMENTED 0.7.81 (uncommitted, awaiting user test).** effectiveSymbolType now
consults typeHistory for positions between assignments, returning the UNION of the
preceding write's type and the declared type (union, not the write alone: a loop back-edge
can carry a later write to the position, and the position-based lookup has no loop context
- the union keeps null-reachability visible while the non-provable member silences the
impossible-comparison lint). glinet repeater.uc: 4 UC2009 -> 0. CONTRACT CHANGE flagged
for review: tests/test-tc-loop-carried-flow.test.js test 08 no longer expects a UC5006
may-null warning - the receiver now types `array | null`, matching the always-silent
`let x = c ? [1] : null; x[0]` baseline, so the definite-null UC5005 the loop filter used
to downgrade never fires. Tests: tests/diagnostics/test-branch-reassign-declared-null.test.js.
Spin-offs: docs/uc2009-member-prewrite-read-fallback.md (member twin, firewall.uc 5 FPs),
docs/uc2009-split-return-element-null.md (vpn-client.uc 2 FPs). Was: **NOT STARTED - HIGH PRIORITY** (~14 hard-error FPs on glinet; the trigger is the
canonical empty-string-normalization idiom `if (x == "") x = null;`). Replaces the earlier
`nullish-default-object-member-null-collapse.md`, whose `?? {}` theory was DISPROVEN by the
2026-08-01 bisection below - `?? {}` is incidental.

## The verified trigger (probe matrix, 0.7.80)

UC2009 "a value of type `null` can never be == \"\"" fires iff ALL THREE hold:

1. the variable is declared WITHOUT an initializer (`let p;` - declared type null), and
2. it is later assigned a non-provable value (`p = params.password;` - unknown), and
3. the comparison's own then-branch REASSIGNS the variable (`if (p == "") p = null;`).

| shape | fires? |
|---|---|
| `let p; p = params.password; if (p == "") p = null;` | ❌ FP |
| `let p; p = params.password; if (p == "") p = 7;` | ❌ FP - **still claims `null`**, not integer |
| `let p; p = params.password; if (p == "") q = 1;` (other var) | ok |
| `let p = params.password; if (p == "") p = null;` (initializer form) | ok |
| `let p; p = params.password; if (p == "") return null;` (no reassign) | ok |

The x2 row is the smoking gun: the claimed type is `null` even when the branch assigns `7` -
the lint is reading the DECLARATION's null (`let p;`), not the branch value and not the
immediately-preceding assignment's unknown. Guard shape and `?? {}` are irrelevant (fires
with and without `params = params ?? {}`, with member-guards, alias-guards, type()-guards,
and with no branch context at all).

## Why it's wrong (oracle-verified)

```ucode
function set_password(params) {
    let password;
    password = params.password;
    if (password == "") password = null;   // LSP: "always false"
    return password;
}
set_password({ password: "" });        // -> null   (the branch RAN)
set_password({ password: "hunter2" }); // -> "hunter2"
```

Real ucode executes the "always false" branch. At the comparison, `password` holds
`params.password` (unknown - the caller controls it); the declared null was overwritten one
line earlier.

## Root-cause hunt (for the fix session)

The comparison lint's type query for a variable that is (a) declared-null and (b) written
inside the comparison's own then-branch collapses to the declared type. Suspects: the flow
join/phi for the branch write shadowing the straight-line reaching definition (the 0.7.69
loop-carried/assign-expr narrowing machinery), or `getNarrowedTypeAtPosition` picking an SSA
version keyed past the branch write. Note visitVariableDeclarator's comment "SSA-style
immediate type inference ... to prevent later assignments from affecting initial type" -
the initial-null may be being treated as immutable-declared-type the same way literal
initializers are.

## Real-world shape (glinet repeater.uc:346-357, firewall.uc:523-527, vpn-client.uc)

```ucode
let username, password, voucher, one_click;
...
} else if (auth_mode == 2) {
    password = params.password;
    if (password == "") password = null;      // UC2009 FP x3 per function
```

## What must NOT regress

- True positives: `let p; if (p == "") ...` (genuinely still null at the test) MUST keep
  firing; `let p = null; if (p == "") p = null;` likewise.
- The initializer form and no-reassign forms already behave; keep them.
- 0.7.69 assign-expr guard narrowing + falsy-branch suites.
