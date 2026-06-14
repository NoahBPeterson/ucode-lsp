# Stack-overflow on deep expression nesting — a second way to crash the server (distinct from the `}}` bug)

**Severity: medium-high (robustness / uncaught crash).** A sufficiently deep expression AST overflows the recursive `visit` traversal. In single-document analysis it surfaces as a bogus diagnostic; deeper, the `RangeError` is **uncaught and kills the server process**.

## Reproduction

```ucode
let x = 1+1+1+ ... ;     // a '+'-chain of ~2000+ terms (or any AST ~2000 deep)
```

* **~2000 terms** → caught, surfaced as `Semantic analysis error: Maximum call stack size exceeded` (a bogus diagnostic on valid code).
* **~8000 terms** → `RangeError: Maximum call stack size exceeded` escapes the analyzer's try/catch via a different traversal (`visit` at bundled `server.js:25697/25721`) and **kills the server** — that file and all subsequent diagnostic requests get nothing.

Verified: the interpreter handles 6000+ term chains and 5000-deep parens fine (exit 0), so this is valid ucode the LSP can't process.

## Root cause

The recursive AST walker(s) (`visit`, and the type-checker / CFG traversals) have no depth guard, and not all traversal entry points are wrapped in try/catch. This is a *different* crash from the `}}` lexer recursion (finding 01) — here the lexing/parsing succeed and the **analyzer** overflows.

## Fix

Add a depth guard to the recursive traversals (convert hot paths to iterative, or cap recursion and degrade gracefully), and wrap every top-level `visit`/traversal entry point in try/catch so an overflow can never kill the process. Real OpenWrt code with long `||`/`+` chains or deeply nested config literals can plausibly approach these depths.

---

## Resolution (FIXED 0.6.235)

Two-layer fix:

1. **Predictable depth guard** (`MAX_ANALYSIS_DEPTH = 1000` in `visitor.ts`). The two
   recursive expression walkers that own their stacks — `BaseVisitor.visit` and
   `TypeChecker.checkNode` — increment a per-traversal depth counter and throw a typed
   `AnalysisDepthExceeded` once it passes 1000, well below the native overflow point
   (~2000 in the original env, ~3050 here) and far above any realistic nesting.

2. **Comprehensive containment.** Every traversal entry point now converts an overflow
   (our `AnalysisDepthExceeded` OR a native `RangeError`) into ONE honest warning instead
   of crashing:
   - `SemanticAnalyzer.reportTraversalOverflow` handles the main `visit` catch AND the
     two traversals that ran *outside* it — `buildFlowEngines` and the flow-sensitive
     diagnostic filter. **That post-catch pair was the actual escape path** by which the
     `RangeError` killed the process.
   - `server.ts` wraps `computeRawInlayHints` (a full-AST walk outside the analyzer — the
     path that still killed the server at ~8000 after the analyzer was guarded) and adds an
     outer `validateAndAnalyzeDocument` net (`isStackOverflow`) so no document can crash the
     server regardless of which traversal overflows.

Message is now honest ("The code is valid; only deep semantic analysis is skipped") and a
**Warning**, not the old misleading "Maximum call stack size exceeded" error.

Verified: 3000 / 8000 / 20000 / 100000-term `+` chains, plus 6–8k-deep parens, array
literals, ternaries, and unary `!` — all degrade gracefully, server stays responsive, and
ordinary shallow code is completely unaffected. Tests: `test-deep-expression-depth-guard.test.js`.

## Follow-up (0.6.236): the feature-provider handlers were still unguarded

0.6.235 contained the diagnostics path but missed that EVERY feature-provider request handler
(`foldingRange`, `documentLink`, `codeLens`, `signatureHelp`, `hover`, `definition`,
`documentSymbol`, `completion`, …) runs its OWN recursive AST walk. On a deeply-nested open
document each overflowed inside the handler and returned an LSP `-32603 Maximum call stack
size exceeded` for every request (visible as a storm of "Request X failed" in the editor), and
`FileResolver.findExports` (cross-file export resolution) overflowed as "Error loading module
exports". Fixed:

- `server.ts` patches every request-registration method once (right after `createConnection`)
  so any handler that overflows returns an empty result (`[]` / `null`) instead of failing.
- `FileResolver.findExports` gained a depth cap (exports are top-level; it no longer recurses
  into pathologically deep expression subtrees).
- The "too deeply nested" warning now anchors on the actual deep top-level statement (found
  iteratively, so it can't itself overflow) instead of the whole-program range — it no longer
  appears to point at an innocent later line such as a trailing `print(...)`.
