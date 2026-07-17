# Reference equality — `==`/`===` on objects/arrays/functions/regexes is identity, never contents

**Status:** BUILT 0.7.70 (uncommitted, awaiting user test).
**Codes:** UC2009 (error, extended) + UC2016 (`REFERENCE_EQUALITY`, warning, new).
**Quick fix:** rewrite `a == b` → `is_equal(a, b)` (structural deep-equal).

## Ground truth (verified against the `ucode` binary)

`ucode/types.c ucv_compare` (loose `==`/`!=`) and `ucode/vm.c uc_vm_test_strict_equality`
(strict `===`/`!==`) both compare **references by pointer identity**, never by contents:

- `ucv_compare`: two operands of the same non-scalar type → compare memory addresses
  (`(uintptr_t)v1 == (uintptr_t)v2`). Different type / a scalar → coerce via `ucv_to_number`;
  every reference/resource coerces to **NaN** (default of `ucv_to_number`), and NaN equals nothing.
- `uc_vm_test_strict_equality`: `t1 != t2 → false`; scalars by value; `default: return v1 == v2`
  (pointer identity for object/array/function/regexp/resource).

Empirically (all confirmed by running the binary):

| expression | result | why |
|---|---|---|
| `let o={a:1}; o == o` | `true` | same pointer |
| `{a:1} == {a:1}` | **`false`** | two separate allocations |
| `{a:1,b:2} == {b:2,a:1}` | **`false`** | key order is irrelevant — still distinct pointers |
| `[1]==[1]`, `f1==f2`, `/x/==/x/` | **`false`** | distinct references |
| `{a:1} == 5`, `[1] == "x"`, `handle == 0` | **`false`** | reference → NaN, matches nothing |
| `5=="5"` T · `5==="5"` F · `5==5.0` T · `5===5.0` F | (scalars) | coercion, unchanged (UC2015) |

**A reference `==`/`===` never compares contents.** The only value comparison is a recursive
deep-equal (OpenWrt's `is_equal` shape).

## Behaviour

### 1. Fresh reference literal → UC2009 error (always false / `!=` always true)
A literal `{…}`, `[…]`, `function(){}`/`() => …`, or `/re/` allocates a brand-new value whose
pointer is shared with nothing, so `==`/`===` against it can never be true — **regardless of the
other operand, even an unknown one** (`x == {a:1}` is always false: the fresh alloc can't be `x`'s
pre-existing value). Applies to both `==` and `===`, and to `!=`/`!==` (always true).

### 2. Two reference VARIABLES → UC2016 warning (all four operators)
`o1 == o2` where both sides are (non-nullable) references and could alias: not provably false, but
it compares **by reference** (are they the *same* object?), never **by value** (do they have equal
contents?). Because `==` and `===` are **identical for references** in ucode — both do a pointer
compare (runtime-verified: `o1 == o2` and `o1 === o2` give the same result for all reference pairs)
— **all of `==` `!=` `===` `!==` are warned alike**. Using `===` is not a way to opt out; it does
the exact same thing. A nullable reference (`object | null`, e.g. every module handle) is **not**
warned (the comparison could legitimately be `null == null`).

### 3. Quick fix — `is_equal(a, b)`
On UC2009 (fresh-literal) and UC2016, offer “Compare by value with is_equal(a, b)”: rewrites
`a == b` → `is_equal(a, b)` (`a != b` → `!is_equal(a, b)`).

The fix is offered only when a value comparison is **meaningful**: at least one operand is an
object, array, or regexp (a literal, or so typed), AND neither operand is a pure scalar. Two fix
shapes:
- **object / array** → `is_equal(a, b)` (insert the recursive helper if the file lacks one);
- **regexp** (both operands regexps) → **in-place string coercion** `("" + a) == ("" + b)` — no
  helper. `"" + re` includes pattern **and** flags (`("" + /x/i) == ("" + /x/)` is false), verified
  against the runtime. `is_equal` deliberately does NOT carry regex logic (it stays the canonical
  OpenWrt shape: object / array / scalar).

Not offered:
- `{a:1} == 5` (reference vs scalar) → error, **no fix** (a value-compare against `5` is nonsense);
- `f1 == f2` (functions) → error/warning, **no fix** — a function's string coercion elides the body
  (`function() { … }`), so two distinct functions collide (verified).

**Reuse over injection:** the helper is injected **only when the file has no `is_equal` of its
own** (a module-scope function/let/const/import/global). If one already exists, the fix reuses it —
it never injects a second copy or a renamed clone (a duplicate top-level `is_equal` would be a
`'use strict'` redeclaration error, UC1007). If the existing `is_equal` happens to sit *below* the
call, that is a plain forward reference (UC1009 — ucode has no hoisting), which has its own
"move the declaration up" fix; papering over it by cloning the helper is not this fix's job.

## Known module handles
Handle constructors (`fs.open/popen/opendir`, `socket.create`, `ubus.connect`, …) return
`object | null`, so `handle == <scalar>` is always false (UC2009 — already covered by the reference
branch) and `handle == <fresh literal>` errors too. `handle == handle` is **silent** (nullable →
could be `null == null`). *Aliased* imports (`import { create as x }`) currently drop the handle
typing (separate known limitation), which would mask the check — use unaliased imports.

## Soundness / non-goals
- `x == null` / `x != null` — owned by the null-safety engine, silent here.
- `type(x) == "object"` — a type-guard (handled by `checkTypeStringComparison`), not flagged.
- `unknown`/`any` operand — never flagged, EXCEPT when the other side is a fresh literal (still
  provably false).

## Where
- `src/analysis/typeChecker.ts`: `checkIncompatibleEquality` (fresh-literal branch +
  reference-identity branch), `isFreshReferenceLiteral`, `isReferenceIdentitySet`,
  `isReferenceComparableOperand`, `emitImpossibleReference`, `emitReferenceIdentityWarning`,
  `referenceEqualityData`.
- `src/server.ts`: `generateReferenceEqualityQuickFix` + `IS_EQUAL_HELPER`.
- Tests: `tests/test-tc-reference-equality.test.js` (44), `tests/test-tc-equality-matrix.test.js`
  (now UC2016-aware).
