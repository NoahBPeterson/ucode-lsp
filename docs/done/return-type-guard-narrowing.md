# Return-type inference ignores type-guard narrowing on `return <var>`

> ✅ **FIXED 0.7.62.** At the return-type collection site (`SemanticAnalyzer`, where each `return`
> feeds `functionReturnTypes`), a bare returned identifier now takes its
> `typeChecker.getNarrowedTypeAtPosition(name, pos)` type (the guard-narrowed type) instead of
> `checkNode`'s SSA-effective type. So `as_list` infers `array`, `type(v)=="string"` → `string`,
> and a disjunctive guard → the union. Sound: no guard → still `unknown`; the else branch isn't
> narrowed. 5 tests (`tests/inference/test-return-type-guard-narrowing.test.js`).

Status: **NOT STARTED.** Reported 2026-07-05.

## Symptom

```ucode
function as_list(v) {          // hover: Returns: `array | unknown`   ← should be `array`
    if (type(v) == "array") return v;
    if (type(v) == "string" && length(v) > 0) return [v];
    return [];
}
```

Every return path provably yields an array:
1. `return v` — inside `if (type(v) == "array")`, so `v` is narrowed to `array` there.
2. `return [v]` — an array literal.
3. `return []` — an array literal.

So the inferred return type should be **`array`**, but the LSP infers **`array | unknown`**.
Confirmed via hover (2026-07-05): `(function) **as_list**: \`function\`  Returns: \`array | unknown\``.

## Root cause (hypothesis)

The return-type inference unions the type of each `return` argument. For paths 2 and 3 it gets
`array` from the literal. For path 1 (`return v`) it uses `v`'s **declared/param type** — which is
`unknown` (an unannotated param) — instead of the **flow-narrowed** type at that position. The
`type(v) == "array"` guard narrows `v` to `array` for member access / diagnostics (the guard
machinery already exists — `getNarrowedTypeAtPosition` / `applyTypeGuard`), but the return-type
collector isn't consulting it for the returned expression. So `unknown` leaks into the union, and
`array | unknown` should collapse to… well, it can't drop `unknown` soundly in general, but here
the returned value *is* narrowed to `array`, so the correct contribution is `array`.

## Fix sketch

Where return statements are collected for a function's return type (the inference that produces
the "Returns: …" hover), type the returned **expression at its position** using the flow/guard
engine (`getNarrowedTypeAtPosition` for a bare identifier, or the general narrowed type of the
expression) rather than the symbol's declared type. Then `return v` under `type(v)=="array"`
contributes `array`, and the union is just `array`.

Note the union-collapse angle too: `array | unknown` — if one arm is `unknown` and it originates
from a guarded value, the guard should have removed it upstream; this fix addresses the source
rather than post-hoc collapsing `| unknown`.

## Tests

- `as_list` above → `array`.
- Guard forms: `if (type(v) == "string") return v;` → the `v` path contributes `string`.
- Negative: without the guard, `function id(v) { return v; }` stays `unknown` (no false narrowing).
- A demo `.uc`.
