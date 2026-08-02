# Named function expression initializing a `let`/`const` crashes on EVERY deployed ucode

Status: **IMPLEMENTED 0.7.79 (uncommitted, awaiting user test).** Version-gated UC6005 ERROR on any named funcexpr inside a let/const initializer (walk stops at nested fn boundaries); quick fix removes the name when the body doesn't use it; self-recursive case points to a function declaration. Tests: tests/diagnostics/test-named-funcexpr-gate.test.js + tests/providers/test-named-funcexpr-quickfix.test.js. Demo: zzzz/named-funcexpr-demo.uc. Spin-off ticket: docs/self-reference-in-own-initializer.md. Was: **NOT STARTED — 🔴 HIGH PRIORITY.** This is a guaranteed runtime crash on all current
OpenWrt pins and the LSP says nothing today. Found 2026-08-01 reviewing upstream
`3ec4e5c..81205a2`.

## TL;DR

Upstream `e2493b5` ("compiler: scope named function expression names to their own body",
2026-07-06, + regression test `99_bugs/53_named_funcexpr_scope`) fixed a longstanding compiler
bug: a named function expression (`let f = function g() {…}`) declared its name `g` in the
**enclosing** scope like a declaration. That both leaked the name and shifted the local-slot
count, so the `initialize_local` for a `let`/`const` initialized by the expression marked the
wrong slot. Consequences on **old** (= all currently deployed) ucode:

```ucode
let f = function g(n) { return n; };
print(f(5));
```
→ **runtime "Syntax error: Can't access lexical declaration 'f' before initialization"**
(verified against the old local binary). Self-recursion via the name (`g(n-1)` inside the body)
is likewise broken.

On **new** ucode (master ≥ `e2493b5`): works; the name is visible only inside its own body
(self-recursion OK — `f(5)` → 120 verified), and does **not** leak into the enclosing scope
(`g` after the statement → not a function, verified).

## Version status

**Updated 2026-08-01:** OpenWrt main bumped its ucode pin to `b885dd0` (2026-07-09), which
CONTAINS `e2493b5` — so on the `main` target this now works. On every release pin
(22.03/23.05/24.10 `3f64c808`/25.12 `85922056`) the pattern is still a guaranteed crash.
Gate: `introducedIn: 'main'` — flag on 25.12 and below, clean on main.

## What our LSP does today

**Nothing.** Verified via CLI: `let fact = function fact_impl(n) { … fact_impl(n-1) … };
fact(5);` produces zero diagnostics. Our scope model (semanticAnalyzer.ts
`visitFunctionExpression`, ~line 4640) already implements the **new** semantics — name declared
in the function's own scope only — so hover/refs are fine for the future, but users deploying to
24.10/25.12/main-pin get no warning about code that cannot run.

## What to build

A version-gated diagnostic (UC6005-family or its own code) on a **named** function expression,
anchored on the name:

- Target below `e2493b5` (currently: every target): flag any named function expression whose
  value initializes a `let`/`const` (and arguably *any* named funcexpr, since the name-leak and
  slot-shift can corrupt other locals in the same scope) — "on {target}, the name of a named
  function expression corrupts enclosing `let`/`const` initialization ('Can't access lexical
  declaration') — drop the name or use a function declaration". Quick fix: remove the name /
  convert to `function f() {}` declaration or anonymous expression.
- Target at/above the fix: no diagnostic; semantics we already model.

Severity on gated targets should be **error**-like: the old binary raises it unconditionally at
compile time of the enclosing chunk.

Scope-model nuance NOT to implement: the old leak of the name into the enclosing scope. We
deliberately keep modeling new semantics (a leaked name that only exists because of a bug that
also crashes the script is not worth supporting).

## Tests

- `let f = function g() {}` → gated error on 24.10/25.12/main; clean on a future target ≥ fix.
- `const f = function g() {}` same.
- Bare statement-position `!function g(){}()` (no let/const involved) — decide whether to flag;
  old ucode leaked `g` but did not necessarily crash. At minimum don't crash the analyzer.
- Anonymous `let f = function (n) {}` → never flagged.
- Function **declarations** `function g() {}` → never flagged.
- Self-recursion hover/def on the inner name still resolves (existing behavior, keep).
