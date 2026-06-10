# Importing a name that matches a builtin → false UC3001 "already declared" + cascading member errors

> **STATUS: FIXED in 0.6.197.** `SymbolTable.declare()` now lets an `IMPORTED` symbol
> shadow a seeded builtin (replaces the builtin entry, returns success) instead of failing
> with UC3001 — so the imported binding wins for member/call resolution. `let`/`function`
> shadows are unchanged. Tests: `tests/test-import-builtin-name-collision.test.js` (10).
> Repro: `import-builtin-name-demo.uc` + `import-builtin-name-lib.uc`.

**Severity: high.** Importing a symbol whose name happens to match a ucode builtin function (e.g. `assert`, `split`, `join`, `index`, `match`, `replace`, `trim`, `keys`, `values`, `push`, `pop`, …) raises a false `UC3001 "Imported symbol 'X' is already declared in current scope"` **error**, and the builtin's type then shadows the import so every member access on the imported value produces a second false error.

## Reproduction

This breaks the entire `utest` unit-testing framework. Every test file starts with:

```ucode
import { describe, it, assert, mock, truthy, falsy } from 'utest';

assert.match(42, 42);   // <-- "Property 'match' does not exist on function type. ucode functions are not objects."
```

* `import { assert } from 'utest';` → `UC3001 Imported symbol 'assert' is already declared in current scope` (because `assert` is a builtin).
* `assert.match(...)` → the local `assert` resolves to the **builtin function** (not the imported object), so `.match` raises `does not exist on function type` — **271 occurrences** across `utest/examples/unit/*.uc`.

It is not specific to `assert`. Importing any of these builtin-named symbols triggers the UC3001:

> assert, print, printf, length, type, keys, values, split, join, index, match, replace, push, pop, substr, trim, uc, json, sprintf, require, include — **21 of 26** tested builtin names.

## Why it is wrong

Verified against `/usr/local/bin/ucode`: importing a name that shadows a builtin is **legal** — the import simply shadows the builtin in module scope:

```ucode
// mod_b.uc:  function myassert(x){return x;}  export { myassert as assert };
import { assert } from "./mod_b.uc";
print(assert("custom\n"));    // prints "custom" — works fine
```

So `UC3001` (an *error* that blocks the import) is a false positive, and the imported symbol — not the builtin — should win for type resolution.

## Notes

* Importing a name from an **unresolvable** module does *not* cascade (only `UC3002 Cannot find module` fires) — so the cascade is specifically caused by the builtin shadowing, not by missing-module handling.
* Two distinct bugs share this root: (1) the spurious `UC3001`, and (2) the builtin type winning over the imported binding for member-access checking.
