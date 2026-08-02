# `for (let x, y = 0; …)` — leading declarator was never declared on deployed ucode

Status: **IMPLEMENTED 0.7.79 (uncommitted, awaiting user test).** UC6005 on the initializer-less leading declarator of a >=2-declarator counting for (strict-gated severity: Warning / Error-under-strict); quick fix inserts `= null`. Tests: tests/diagnostics/test-for-leading-declarator-gate.test.js + the quickfix e2e file. Demo: zzzz/for-leading-declarator-demo.uc. Was: **NOT STARTED — 🟡 MEDIUM PRIORITY.** Strict-mode scripts using this shape crash at
runtime on every deployed pin; non-strict scripts silently leak a global. Found 2026-08-01
reviewing upstream `3ec4e5c..81205a2`.

## TL;DR

Upstream `467fb44` ("compiler: declare leading variable in counting for loop initializer",
2026-07-04): to disambiguate for-in from counting loops, the compiler consumes up to two leading
labels; for a counting loop only the **last** label was forwarded, so in
`for (let x, y = 0; …)` the variable `x` was **never declared**:

- old, non-strict: assignments to `x` in the body create an **implicit global** (silent leak);
  reads before assignment → `null`.
- old, strict: assignment to `x` → **runtime reference error** ("access to undeclared variable").
- new (master ≥ `467fb44`): `x` is a proper loop-local, initialized `null` (verified with the
  built `81205a2` binary — non-strict AND strict both work, `x` starts `null`, and `x` is not
  visible after the loop).

**Updated 2026-08-01:** OpenWrt main's ucode pin is now `b885dd0` (2026-07-09), which CONTAINS
`467fb44` — main-target code is fine. All release pins (22.03–25.12) still lack it.

## What our LSP does today

Verified via CLI: we already model the **new** semantics — `acc` in
`for (let acc, i = 0; i < 3; i++) { acc ??= 0; }` is treated as a declared loop-local (no
UC8004/UC1001 in the body), and referencing `acc` **after** the loop correctly yields UC1001.
So for future targets we're right; for **all current targets** we're missing:

1. The strict-mode case: body assignments to the leading declarator will crash at runtime —
   deserves a version-gated warning/error.
2. The non-strict case: the body assignment actually writes a **global** named `x` — a silent
   pollution/aliasing hazard (another script's global `x` gets clobbered). Worth flagging too,
   same gate, lower severity.

## What to build

Version-gated diagnostic anchored on the leading (initializer-less) declarator of a counting
`for` with ≥2 declarators:

- Below `467fb44` (currently all targets): "on {target}, `x` here is NOT declared — the
  compiler drops the leading declarator; assignments create an implicit global (or raise a
  reference error in strict mode). Give `x` its own `let` before the loop, or initialize it:
  `for (let x = null, y = 0; …)`."

  Verified 2026-08-01: `for (let x = 7, y = 0; y < 1; y++) print(x)` prints `x=7` on BOTH the
  old binary and `81205a2` — the bug hits **only** an initializer-less leading declarator, so
  the "give it an initializer" remedy is sound on all versions.
- At/above the fix: no diagnostic.

Quick fix: hoist `let x;` above the loop (scope-preserving) — mirrors what authors targeting
deployed ucode must write anyway.

## Tests

- `for (let x, y = 0; …)` → gated diagnostic on 24.10/25.12/main; clean on target ≥ fix.
- `for (let y = 0; …)` single declarator → never flagged.
- for-in two-var `for (let k, v in obj)` → NOT this ticket (valid, different path — we already
  type it, see memory "for-in two-var keys").
- Post-loop reference of the leading declarator keeps UC1001 (matches new semantics + strict old).
