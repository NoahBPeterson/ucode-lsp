# `for (let x in array<T> | null)` types `x` as `unknown` instead of `T`

Status: **DONE (0.6.189)** — implemented the union-aware `iterableElementType` helper
below, applied to all three for-in sites + tests (test-for-in-union-element-type.test.js).
Verified vs `/usr/local/bin/ucode`. Date: 2026-06-08.

## Symptom

```js
let cols = fs.lsdir(lib, "*.uc");   // cols : array<string> | null
for (let col in cols) {             // col  : unknown   ← should be string
```

`col` should be `string`. The user is right.

## Verified ucode `for-in` semantics (vs interpreter)

- `for (x in array)` iterates the array's **values** → `x : <element type>`.
  (`for (x in ["a","b"])` yields `"a"`, `"b"` — values, not indices.)
- `for (k in object)` iterates **keys** → `k : string`.
- `for (x in null)` is a **no-op** — no error, zero iterations. (Verified: the loop body
  never runs and execution continues.)

So iterating `array<string> | null`: the `array<string>` arm gives element `string`, the
`null` arm contributes nothing → the loop variable is **`string`**.

## Root cause

`visitForInStatement` (semanticAnalyzer.ts) infers the element type like this (single-var
case, ~2756; identical logic in the bare-iterator case ~2699 and the 2-var value case ~2835):

```ts
const rightFullType = this.getIterableFullType(node.right);   // → array<string> | null
let iterType;
if (rightFullType && isArrayType(rightFullType)) {            // FALSE for a union
  iterType = getArrayElementType(rightFullType);
} else if (rightBase === OBJECT) iterType = STRING;
else if (rightBase === STRING) iterType = STRING;
else iterType = UNKNOWN;                                      // ← lands here → col: unknown
```

`getIterableFullType` (semanticAnalyzer.ts:2866) returns the **narrowed** type at position
if one exists, else the declared type. For `cols` there is no narrowing guard before the
loop, so it returns the full declared union `array<string> | null`. Then
`isArrayType(union)` is **false** (it matches only a pure `ArrayType`, not a union
containing one — symbolTable.ts:169), every other branch misses, and the var falls to
`unknown`.

The code comment claims it "works even when the declared type is a union the loop narrows,
e.g. `string | array<T> | null` → `array<T>`" — but that only holds when an explicit
`type(x) == 'array'` guard *already* narrowed the union via `getNarrowedTypeAtPosition`.
An **unguarded** union (the common `array<T> | null` from `fs.lsdir`/`split`/`json`/…) never
gets narrowed, so it hits this gap. This is the typical shape for every nullable-array
builtin return, so it's broad.

## Fix design

Make the element-type inference **union-aware**: compute the iterable element type as the
union of each member's iterable element type, dropping non-iterable members (`null` →
nothing; verified no-op at runtime).

```ts
// pseudo, applied in all three for-in branches (bare ~2702, single-decl ~2759, 2-var value ~2837)
function iterableElementType(t): UcodeDataType | null {
  const members = getUnionTypes(t);                 // symbolTable.ts:155 — [t] if not a union
  const elems = [];
  for (const m of members) {
    if (isNull(m)) continue;                          // null: for-in is a no-op
    if (isArrayType(m)) elems.push(getArrayElementType(m));
    else if (base(m) === OBJECT || base(m) === STRING) elems.push(STRING);
    else return null;                                 // an unknown/uniterable member ⇒ give up (stay unknown)
  }
  return elems.length ? createUnionType(dedupe(elems)) : null;
}
```

Helpers already exist: `getUnionTypes`, `isArrayType`, `getArrayElementType`,
`createUnionType` (all from `symbolTable.ts`). Apply in all three for-in element-type sites
so the bare-iterator, single-`let`, and 2-variable value cases stay consistent. Keep the
existing narrowed-type fast path (an explicit guard still produces the pure array type, which
this handles trivially).

### Payoff

`col : string` for `for (let col in fs.lsdir(...))` and every other
`for (… in <nullable array>)` — restoring member/arg type-checking inside the loop body.
Conservative: if any union member is genuinely uniterable/unknown, it still falls back to
`unknown` (no false element type).

### Note

This is purely about the **element type** — the `array<string> | null` *declared* type of
`cols` is correct (`fs.lsdir` can return null). The bug is only that the for-in didn't see
through the union to the element type.
