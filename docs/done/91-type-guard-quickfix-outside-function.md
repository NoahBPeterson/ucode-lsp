# "Add type guard" quick fix inserts the guard OUTSIDE the function for arrow / function-expression / object-method / callback params → invalid ucode

> **STATUS: FIXED in 0.6.215.** `findEnclosingContext` now tracks the enclosing
> function *node* (`enclosingFunction`). When the guard subject's parameter belongs
> to an "inline" function — an expression-body arrow, or a single-line
> arrow/function-expression/object-method/callback whose block `{` opens on or after
> the diagnostic line — `generateTypeNarrowingQuickFixes` routes to the new
> `makeInlineFunctionGuardAction` (via the shared `inlineFn` branch in both the
> null-guard and type-mismatch identifier paths and the inner-guard member path):
> it inserts the guard right after the block `{`, or rewrites an expression-body
> arrow `=> EXPR` to `=> { if (...) return; return EXPR; }`. Multi-line callbacks /
> named functions keep their existing (correct) insert-before-line behavior.
> The companion **"Wrap in type/null guard"** action — which would wrap the
> function's own declaration line in `if (type(x) == "string") { … }`, guarding the
> param outside its scope — is now suppressed for inline-function params (and the
> complex-expression extract path offers nothing rather than hoisting an extract
> out of the function). Tests: `tests/test-inline-function-param-guard.test.js` (7).

**Severity: high (broken code-action output).** For a parameter of an arrow with an expression body, a function expression, an object-literal method, or a callback, the type-guard quick fix inserts the guard *before the enclosing statement at top level* — producing code that doesn't run (a top-level `return` and an out-of-scope reference).

## Reproduction

```ucode
'use strict';
const f = (x) => substr(x, 0);
```

Accept "Add type guard for `x`". The fix produces:

```ucode
'use strict';
if (type(x) != "string")
	return;
const f = (x) => substr(x, 0);
```

The guard lands before the `const`, at top level. `x` is the arrow's parameter (out of scope there) and `return` is outside any function:

```
Reference error: access to undeclared variable x
```

Same broken output for `const f = function(x){...}`, `let o = { m: function(x){...} }`, and `map(arr, function(x){ substr(x,0) })`.

## Root cause

`generateTypeNarrowingQuickFixes` (server.ts ~2928) detects the inline-decl insertion point with a regex that only matches `function NAME(...) {`. Arrows, function expressions, object methods, and callbacks fall through to `makeInsertBeforeAction` at the diagnostic line. Block-bodied arrows (`=> { ... }`) are handled correctly (guard goes inside the block); only the expression-body / function-expression forms are broken.

This is the most serious code-action issue — the fix is offered, ranked, and emits non-working code. (The hardcoded-tab indentation is the separate finding 45.)

## Fix

Resolve the enclosing function for any callee-parameter subject (arrow expr-body, function expression, object method, callback) and insert the guard inside that function's body — expanding an expression-body arrow to a block as needed.
