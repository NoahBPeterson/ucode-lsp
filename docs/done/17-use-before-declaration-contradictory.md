# Using a `let`/`const` before its declaration emits two contradictory diagnostics

**Severity: medium.** Referencing a `let`/`const` variable above its declaration produces both `UC1001 "Undefined variable: X"` (at the use) **and** `UC1006 "Variable 'X' is declared but never used"` (at the declaration) — for the *same* variable. The two diagnostics contradict each other (X is simultaneously "undefined" and "unused"), and neither matches ucode's actual behaviour.

## Reproduction

```ucode
print(C);        // UC1001 "Undefined variable: C"
const C = 5;     // UC1006 "Variable 'C' is declared but never used"
```

```ucode
function f(){ let y = x; let x = 5; return y; }   // UC1001 "Undefined variable: x"
```

## Why it is wrong / inconsistent

* The LSP fails to connect the forward reference to the declaration, so it both invents an "undefined" symbol at the use site and marks the real declaration "unused". A variable that is referenced cannot be "never used".
* In ucode (non-strict, verified) reading a `let` before its declaration returns `null` with **no error** — `function f(){ print(x); let x = 5; }` prints a blank line. So `UC1001` here is not even matching the runtime.
* The codebase already has a coherent model for the analogous *function* case — `UC1009 "Function 'f' is used before its declaration. Move its declaration above this use."` Variables should get the same single, accurate diagnostic (or none), not the contradictory `UC1001` + `UC1006` pair.

## Fix

Resolve a use that precedes a same-scope `let`/`const` declaration to that declaration (so it counts as a use → no false `UC1006`), and emit one `UC1009`-style "used before its declaration" message instead of `UC1001`.
