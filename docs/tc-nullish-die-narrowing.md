# `expr ?? die(...)` must narrow away null (never-typed RHS of ??/|| eliminates the fallback branch)

Status: **FIX IMPLEMENTED 2026-07-07 (uncommitted, awaiting user test).** die()/exit() are typed NEVER (bottom); `T ?? die()` → nonNull(T) and `T || die()` → truthy(T), so the "open or die" idiom drops null.

## Fix

Three small changes:

1. **die()/exit() return NEVER** (`src/analysis/typeChecker.ts` builtin signatures): both
   `returnType: NEVER_TYPE` (the empty-union bottom from the falsy work). Verified against the
   vendored source — `ucode/lib.c` `uc_die`/`uc_exit` both call `uc_vm_raise_exception` and their
   trailing `return NULL` is unreachable, so neither ever produces a value.
2. **`??` drops the never fallback** (`computeNullishCoalescingResult`): `if (isNeverType(rightType))
   return leftNonNull.narrowedType` — `T ?? die()` is exactly `T` with null removed. `unknown ?? die()`
   stays `unknown` (removeNullFromType(unknown) = unknown), as intended.
3. **`||` needs no new code**: `getUnionTypes(NEVER)` is the empty array, so the existing
   `inferLogicalOrFullType` already yields truthy(T) for `T || die()` — the falsy members
   contribute the (empty) RHS and drop out, leaving the truthy members of T.

NEVER never leaks to hover: `getNarrowedTypeAtPosition` already guards the narrowed path, and
`src/hover.ts` `resolveVariableTypeForHover` now sanitizes a `never` declared/SSA fallback to
`unknown` (covers the degenerate `let x = die()`).

Result on run_tests.uc: the `fp`/`proc` UC5006 warnings (lines 49×2, 161, 163) gone; the
`fout`/`ferr` mkstemp warnings (155/165/166/170/178, genuinely unguarded) correctly REMAIN.
Tests: `tests/test-tc-flow-fp-trio.test.js`. Repro: `zzzz/demo-tc-flow-fixes.uc`.

## The gap

The idiomatic ucode "open or die" pattern still carries null:

```ucode
let fp = fs.open(file, 'r') ?? die(`Unable to open ${file}: ${fs.error()}`);
for (let line = fp.read('line'); ...)   // UC5006: 'fp' may be null here — FP ×2

let proc = fs.popen(cmd, 'w') ?? die(`Error launching …`);
proc.write(testcase.code);              // UC5006 — FP
let exitcode = proc.close();            // UC5006 — FP
```

If the LHS is null, `die()` runs and **never returns** (it raises/terminates — the UC4001
unreachable-code machinery already knows die()/exit() as terminators). So after the
declaration, `fp` is provably non-null.

## Root cause

The `??` result-type computation unions LHS and RHS types without a never-check. `die()`'s
return type is presumably typed as null/unknown rather than never, and even if it were never,
the union path doesn't drop it.

## Proposed approach

The falsy-narrowing work (docs/tc-falsy-branch-narrow-to-unknown.md) introduced a real
`NEVER_TYPE` bottom (symbolTable.ts) with join-identity semantics. Build on it:

1. Type `die()` (and `exit()`? — verify: exit terminates the VM, die raises; both never
   produce a value) as returning `NEVER_TYPE`.
2. In `??` result typing: `T ?? never` → `nonNull(T)`. In `||` result typing:
   `T || never` → truthy(T) (reuse the falsy/truthy machinery: the result excludes falsy
   members of T). Same for a `?? <throwing-call>` if the throwing-call lint already proves
   no-return — keep scope to die/exit first.
3. The expression-statement form `fs.writefile(path, data) ?? die(...)` needs no typing
   change but must not warn either.

Watch interaction: `x ?? die()` where x is `unknown` stays `unknown` (nonNull(unknown) has no
representation — fine, unchanged).

## Classification

**Solvable.** Small, localized to the ??/|| type computation + die/exit return types; the
bottom type it needs now exists. Kills 5 UC5006 FPs in run_tests.uc alone; `?? die(...)` is a
pervasive OpenWrt idiom (grep shows dozens of corpus sites).
