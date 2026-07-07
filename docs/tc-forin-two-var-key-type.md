# Two-variable `for (k, v in …)`: key variable is `unknown` for union and unknown iterables

Status: **NOT STARTED.** Filed 2026-07-07 from the --type-coverage audit.

## The gap

The 0.6.189 union-aware for-in fix (`docs/done/for-in-union-element-type.md`) was applied to
the single loop variable, the bare-identifier iterator, and the two-var **value** variable —
but not to the two-var **key/index** variable. And unlike the value variable, the key variable
has a sound type for **every** iterable, including a completely unknown one.

Verified for-in semantics from the vendored C source (`ucode/vm.c`, `uc_vm_insn_next` +
iterators — NOT the outlier local binary):

- object iteration pushes the key as `ucv_string_new(...)` → key is **always `string`**
  (`uc_vm_object_iterator_next`, vm.c:2380).
- array iteration under `I_NEXTKV` pushes `ucv_uint64_new(n)` → index is **always `integer`**
  (`uc_vm_array_iterator_next`, vm.c:2420).
- every other iterable type — including `null` — hits the `default:` branch and the loop is a
  **no-op** (vm.c:2434-2463 switch). Strings are NOT for-in iterable (zero iterations).

So inside the body of `for (let k, v in X)`:

| type of X | k is |
|---|---|
| `object` | `string` (works today) |
| `array` / `array<T>` | `integer` (works today) |
| `object \| null` | `string` (**today: unknown**) |
| `array<T> \| null` | `integer` (**today: unknown**) |
| `object \| array<T>` | `string \| integer` (**today: unknown**) |
| `unknown` | `string \| integer` (**today: unknown**) — if the body runs at all, X was an object or array |

The `unknown` row is the big one: the key var of a two-var for-in can *never* hold anything but
a string or an integer, no matter how unknowable the iterable is, because the body only executes
when iteration actually happens.

Minimal repro (via the real `handleHover` path):

```ucode
function f(flag) {
    let nullable_obj = flag ? { a: 1 } : null;    // object | null
    for (let k2, v2 in nullable_obj) print(k2);   // k2: unknown — should be string
    let nullable_arr = flag ? ["x"] : null;        // array<string> | null
    for (let i2, val2 in nullable_arr) print(i2); // i2: unknown — should be integer
    // (val2 IS correctly string — the value var got the 0.6.189 union fix; only the key missed it)
}
```

Real corpus instances (194 unique key-var declaration sites flagged `unknown` in the audit, plus
their body reads — sampled across firewall4, hostapd.uc, wireless.uc, mdns.uc, cli/, uspot):

```ucode
for (let name, mld in hostapd.data.mld)        // hostapd.uc:175
for (let key, val in spec) {                    // fw4.uc:869
for (let name, dev in wireless.devices)         // wireless.uc:91
for (let idx, sobj in config[stype]) {          // mocklib/uci.uc:42
```

In every one, the key is used as a string (object key) downstream — `ret[name] = …`,
`sprintf("%s", name)` — and stays untyped today.

## Root cause

`visitForInStatement`, two-declaration branch, index-variable typing
(`src/analysis/semanticAnalyzer.ts:6192-6213`):

```ts
const rightBase = dataTypeToBase(this.typeChecker.checkNode(node.right));
let keyType: UcodeDataType;
if (rightBase === UcodeType.OBJECT)      keyType = UcodeType.STRING;
else if (rightBase === UcodeType.ARRAY)  keyType = UcodeType.INTEGER;
else                                      keyType = UcodeType.UNKNOWN;
```

`dataTypeToBase` collapses **any union to `UNKNOWN`** by documented design
(`src/analysis/symbolTable.ts:207-215`), so `object | null` and `array<T> | null` never match
the OBJECT/ARRAY arms and fall to `unknown`. The value variable right below (6215-6228) uses the
union-aware `iterableElementType`; the key variable was simply never given the equivalent.

## Proposed approach

Add a small union-aware `iterableKeyType(t: UcodeDataType | null): UcodeDataType` next to
`iterableElementType` (semanticAnalyzer.ts:6268), mirroring its structure:

- for each member of `getUnionTypes(t)`: `null` → skip (no-op); object/object-shape → `string`;
  array/`array<T>` → `integer`; `string` → skip (verified no-op, see above);
  `unknown` → contribute `string` AND `integer` (the only possible key kinds);
  anything else (int/bool/double/function/regex) → skip (no-op).
- `createUnionType` the contributions; if nothing contributed (provably uniterable), fall back
  to `unknown` (body is dead anyway).

Use it at the index-declarator site (6200-6209). Keep the existing pure-object/pure-array fast
answers (they fall out identically). ~15 lines, no new type-model surface; helpers
(`getUnionTypes`, `singleTypeToBase`, `isArrayType`, `createUnionType`) are already imported.

Note the asymmetry vs the value var is correct and should stay: over `unknown`/`object` the
*value* genuinely can be anything → `unknown` is right there; only the *key* is universally
constrained.

While in the file: the single-var/`iterableElementType` path treats a `string` iterable as
yielding chars (`base === STRING → STRING` at 6276 and the `rightBase === STRING` arms at
6082/6140). Per the vm.c switch above, a string iterable is a **no-op** — `for (x in "abc")`
never runs. That's a separate (tiny, low-impact) correctness question — worth re-verifying
against a current interpreter build and fixing in the same pass if confirmed, since the same
function is being touched.

## Classification

**Solvable.** Small, mirrors an existing adjacent fix (0.6.189), C-source-verified semantics.

**Occurrence estimate:** 194 unique two-var key declaration sites flagged in the audit
(107 plain-identifier iterables, 83 member/index iterables, 4 calls) + their body reads in the
`read-of-forin-var`/`decl-no-init` buckets (the audit's regex clustering filed two-var keys under
`decl-no-init`, which contains zero genuine `let x;` findings — all 233 are these keys plus
template-read misclassifications). Because the `unknown`-iterable row is also fixable
(`string | integer`), this ticket is independent of ALL four upstream root causes — it improves
the key type even when the iterable's own type never improves.
