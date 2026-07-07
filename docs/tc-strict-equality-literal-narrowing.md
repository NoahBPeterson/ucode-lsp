# `x === <literal>` guards don't narrow `x` (strict equality is a sound type guard)

Status: **NOT STARTED.** Filed 2026-07-07 from the --type-coverage audit.

## The gap

ucode's `===`/`!==` compile to `I_EQS`/`I_NES` → `uc_vm_test_strict_equality` (vendored
`ucode/vm.c:2981` dispatch; function at vm.c~1065), whose first check is `if (t1 != t2) return
false;` — **strict equality can only be true between same-typed values**. So inside the true
branch of `x === "foo"`, `x` is provably a `string` (in fact exactly `"foo"`); inside
`x === 5`, an `integer`; `x === null`, `null`. None of this is narrowed today:

```ucode
function f(x) {
    if (x === "bar") {
        print(x);        // hover: unknown — provably string
    }
    let r = x === "baz" ? length(x) : 0;   // x in consequent: provably string
}
```

Real corpus instances (guards on unknown params — the reads inside stay unknown even though the
guard fully determines the type):

```ucode
// utest/examples/unit/99_property_test.uc:144
(s) => assert.match(true, s === "a" || s === "b" || s === "c"),
// utest/src/utest/mock/engine.uc:33
if (type(m.channels) === 'array') {          // type() form already narrows (existing feature)
// luci corpus, many:  if (x == 'literal') …  — see the == caveat below
```

~672 string-literal equality comparisons corpus-wide (160 in direct `if (x == '...')`/
`if (x === '...')` guard position).

**The `==` form is NOT the same guard.** Plain `==`/`!=` are `I_EQ`/`I_NE` →
`uc_vm_insn_rel` → coercing `ucv_compare` (verified: `1 == "1"` is `true`). A true
`x == "1"` does not prove `x` is a string. A safe subset likely exists (a **non-numeric**
string literal can only compare equal to another string under `ucv_compare`'s coercion
rules), but it needs its own careful oracle verification pass — do `===`/`!==` first, treat
`==` as a possible follow-on.

## Root cause

The guard extractor behind `getNarrowedTypeAtPosition` (typeChecker.ts) understands
`type(x) == '<t>'` comparisons (`checkTypeStringComparison` / the type()-narrowing machinery,
plus truthiness/length/filter guards), but has no case for a **literal-operand strict
equality** on a bare identifier (or member path — the machinery already supports member-path
narrowing per `docs/…` 0.6.158). There's simply no rule mapping
`Identifier === Literal` → "narrow identifier to typeof(literal) in the true branch".

## Proposed approach

Extend the guard extraction that already powers `type(x) == 's'`:

- `x === <literal>` / `<literal> === x` in a test position → true-branch narrowing of `x` to
  the literal's type (`string`/`integer`/`double`/`boolean`/`null`). Bonus: `x !== null` in the
  false-branch sense — `!==` with a literal narrows the FALSE branch the same way `===` narrows
  the true branch (and for `x !== null` specifically, the TRUE branch can drop `null` from a
  nullable union, complementing the existing truthiness guard for falsy-but-non-null values
  like `0`/`""`).
- OR-chains of same-variable strict equalities (`s === "a" || s === "b"`) → union of the
  literal types (all string here → string), mirroring however the existing type()-guard handles
  `||`.
- Member paths (`x.kind === "phy"`) can piggyback on the existing member-path narrowing
  (0.6.158) if cheap; identifier-only is a fine first cut.
- Do NOT touch `==`/`!=` in the first pass (coercing — unsound without a verified
  non-numeric-literal carve-out).

## Classification

**Partially solvable** — `===`/`!==` narrowing is fully sound and mechanical; the far more
common corpus form `==` needs a separate soundness analysis before it can participate, so a
majority of the *sites* stay un-narrowed until that follow-on.

**Occurrence estimate:** the direct beneficiaries are reads inside `===`-guarded branches of
unknown-typed variables — a modest slice (dozens of the audit's `other-read`/`read-of-param`
occurrences; utest's property/combinator files are the densest). Filed because it's a cheap,
sound extension of an existing mechanism rather than a large win; the `==` follow-on (if
verified) would multiply the coverage by ~4x.
