# Reassigning a `const` is never flagged (dead validator)

> **STATUS: FIXED in 0.6.202.** The AST `SemanticAnalyzer` now stamps `isConstant` on
> `const` bindings (`visitVariableDeclarator` uses the declaration `kind`) and flags
> **UC1010** on any identifier-target assignment (`x = …`, every compound form `x += …`)
> or increment/decrement (`x++`, `--x`), including from a nested scope. Mutating a const
> object's PROPERTY or array ELEMENT (`const o={}; o.x=1`) is legal in ucode, so member
> targets are not flagged (verified vs `/usr/local/bin/ucode`). The dead lexer-based
> validator is left as-is. Tests: `tests/test-const-reassignment.test.js` (33). Repro:
> `const-reassignment-demo.uc`.

**Severity: high (false negative).** Assigning to a `const` is a hard error in ucode (`Syntax error: Invalid assignment to constant`), but the LSP reports **nothing** — in any context.

## Reproduction

```ucode
const x = 1;
x = 2;        // LSP: no diagnostic.  ucode: "Invalid assignment to constant"
```

Also undetected: `const x = 1; x += 2;`, `const x = 1; x++;`. Verified all rejected by `/usr/local/bin/ucode`.

## Root cause

A correct validator exists — `src/validations/const-reassignments.ts` (`validateConstReassignments`) detects const declarations and every compound-assignment form. But it is **dead code**:

* It is only reachable through the lexer-based / hybrid validation path (`src/validations/lexer.ts` → `src/validations/hybrid-validator.ts`).
* The server never uses that path. `src/server.ts:54` has the hybrid-validator import **commented out**; the live pipeline is `validateAndAnalyzeDocument` → the AST `SemanticAnalyzer`.
* The `SemanticAnalyzer` has **no** const-reassignment check (only special-casing for `import { const }` from nl80211/rtnl).

So the check never runs. Even the one path that could trigger it (the hybrid-validator's "AST produced 0 diagnostics → also run lexer") is gated behind a code path the server doesn't call, and produces nothing even for an isolated `const x=1; x=2;`.

## Fix

Add a const-reassignment check to the AST `SemanticAnalyzer` (it already tracks symbol kinds, so it can flag an assignment whose target is a `const` symbol), or re-wire the hybrid validator. The lexer-based detector's logic can be ported directly.
