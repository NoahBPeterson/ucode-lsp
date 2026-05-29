# TODO: Exhaustive builtin argument-matrix audit

**Status:** planned
**Motivation:** 0.6.94 fixed `replace(str, /regex/, "")` being typed `null` — the
builtin's signature modeled arg 1 as `string`, so a *valid* regex search arg
tripped the `nullMeansWrongType` narrowing. 0.6.88 fixed `split()` dropping its
`<string>` element type. Both are the same class of defect: **a builtin's
modeled signature (parameter types, accepted-type sets, `nullMeansWrongType`,
`narrowingArgs`, return type, coercion) disagrees with the actual ucode C
runtime for some argument-count × argument-type combination.** These are found
one-at-a-time by users. We want to find them *conclusively*.

## Goal

For **every** core builtin, test **every** combination of `0..maxParams`
arguments where **each argument is each ucode type**, and compare the LSP's
behavior against ground truth from the real runtime. Flag every mismatch.

The two observable things to compare per combination:
1. **Return type** — what the LSP infers for `let a = BUILTIN(args...)` vs.
   `type()` of the same call in `/usr/local/bin/ucode`.
2. **Diagnostics** — whether the LSP emits an argument diagnostic
   (`incompatible-function-argument` / `nullable-argument`) when the runtime
   actually accepts the call (false positive), or stays silent when the runtime
   throws/returns null for a wrong type (false negative).

## The ucode type universe (per argument)

`null`, `integer`, `double`, `string`, `boolean`, `array`, `object`,
`function`, `regex`. (9 types.) Plus the absent case (fewer args than the slot).

## Methodology

1. **Enumerate builtins.** Source of truth: `src/builtins.ts` + the signature
   tables in `typeChecker.ts` (the `builtinFunctions` map) and the special
   validators in `checkers/builtinValidation.ts`. ~50 core builtins.
2. **Determine arity.** For each builtin: `minParams`, `maxParams`, `variadic`.
   For variadic (`print`, `sprintf`, `printf`, `push`, …) test `0..K` (K≈3).
3. **Generate probe programs.** For each arg-count and each assignment of types
   to slots, emit a minimal program:
   ```
   let a0 = <typed literal/expr for type T0>;
   ...
   let r = BUILTIN(a0, a1, ...);
   print(type(r), "\n");   // oracle
   ```
   Use canonical literals per type: `1` (int), `1.5` (double), `"s"` (string),
   `true` (bool), `[1]` (array), `{a:1}` (object), `()=>1` (function),
   `/x/` (regex), `null` (null).
4. **Oracle.** Run each probe through `/usr/local/bin/ucode`. Capture the
   printed `type(r)` (and whether it errored / threw). This is ground truth.
   (See `reference_ucode_runtime_oracle` memory note.)
5. **LSP side.** Run the same source through the analyzer (createLSPTestServer /
   the in-process `analyze`), read the inferred type of `r` and the diagnostics
   on the `BUILTIN(...)` call.
6. **Compare & report.** Emit a table of mismatches:
   - LSP return type ≠ runtime `type(r)` (modulo the legitimate `T | null`
     widening where the LSP is intentionally conservative).
   - LSP diagnostic present but runtime accepts → **false positive** (the
     replace+regex class — the highest priority).
   - LSP silent but runtime returns null/throws → **false negative**.

## Combinatorics / scoping

- Naive: `~50 builtins × 9^arity`. For arity ≤ 3 that's `50 × 9^3 ≈ 36k` probes —
  fine for an offline/CI audit, too slow for the normal suite.
- Prune: most builtins have 1–2 *meaningful* typed params; collapse "don't-care"
  trailing slots. Run the full matrix as a **separate offline audit script**
  (e.g. `scripts/audit/builtin-matrix.cjs`), not in `test-all-validations`.
- Output a committed report (`docs/builtin-matrix-report.md`) so regressions are
  diffable; promote any confirmed mismatch into a focused regression test.

## Specifically verify (known smell areas)

- **Accepted-type completeness** of search/pattern args: `split` & `replace`
  accept `string | regex` (replace+regex was the bug); `match` requires `regex`.
- **`narrowingArgs` correctness** — which args actually cause a `null` return
  (e.g. `replace` → arg 0 only; many → the receiver only).
- **Coercion** — `replace`/`length`/`substr` coerce or tolerate non-string
  subjects differently; the runtime coerces a non-null subject of `replace` to
  string (only `null` → `null`).
- **arg-count** `minParams`/`maxParams` vs runtime (the flaky `int()` arg-count
  test lives here too).
- **Element-type preservation** through array-returning builtins (`split`,
  `keys`, `values`, `sort`, `map`, `filter`, `slice`, `splice`).

## Already-found instances (seed the regression set)

- `replace(string, regex, string)` → was `null`, should be `string` (0.6.94).
- `split(unknown, sep)` → dropped `<string>` element type (0.6.88).
- computed access on `array<T> | null` → was `unknown` (0.6.88).

## Deliverable

`scripts/audit/builtin-matrix.cjs`: runs the oracle vs. the analyzer across the
matrix, prints a mismatch report. Each confirmed mismatch → a fix + a focused
test. Re-runnable against any installed ucode version to catch drift when the
runtime or our models change.
