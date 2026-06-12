# Function-valued variables don't argument-check their call sites (JSDoc `@param` ignored at calls)

> **STATUS: FIXED in 0.6.216.** Function-valued variable declarators now stamp the
> param signature onto the variable symbol, so calls are argument-checked like a
> named function. Tests: `tests/test-function-valued-param-argcheck.test.js` (5).

## Symptom

```ucode
/**
 * @param {string} x
 */
const f2 = function(x) { return substr(x, 0); };

let a = f2(1);   // expected an "incompatible-function-argument" warning — got nothing
```

A **named** function with the same JSDoc *does* flag the call:

```ucode
/** @param {string} x */
function f3(x) { return substr(x, 0); }
f3(1);   // ✅ "Function 'f3': Argument is possibly 'integer', expected 'string'."
```

But the `const f = (x) => …` and `const f = function(x){…}` forms did not — the
argument type contract (whether from JSDoc `@param {T}` or callback inference) was
silently dropped at every call site.

## Root cause

`checkCallExpression` (typeChecker.ts ~1677) gates user-function argument checking on
`symbol.parameters`:

```ts
if (symbol.parameters) {
  this.checkUserFunctionCall(node, symbol);   // arity + per-arg type checks
}
```

The 0.6.193 work made function-valued variables stamp `dataType = FUNCTION` and a
`returnType` onto the bound symbol (so `f(...)`'s *result* type resolves), but it
never stamped `.parameters`. Named functions set `symbol.parameters` from a
`ParamInfo[]` built while the param symbols are still in scope (semanticAnalyzer.ts
~1561); the arrow / function-expression visitors built no such signature. With
`symbol.parameters` undefined, the gate was false and the whole call was unchecked.

## Fix

Mirror the named-function param build for the expression forms:

1. `buildFunctionExprParamInfos(node)` — reads each declared param's type while the
   params are still in the function scope (so `applyJsDocToParams` annotations are
   reflected), plus the rest param.
2. `visitFunctionExpression` / `visitArrowFunctionExpression` stash the result on the
   node as `_inferredParams` (alongside the existing `_inferredReturnType`).
3. The variable declarator that already stamps `dataType`/`returnType` for a
   `let/const f = arrow|fnexpr` now also stamps `fnSym.parameters = _inferredParams`.

Soundness is unchanged from named functions: `checkUserFunctionCall` bails on
unknown param/actual types and only warns (escalating to an error under
`'use strict'`), so an un-annotated `const f = (x) => x + 1` does not over-flag.

## Not covered

Bare-assignment-to-undeclared `f = function(x){…}` (a non-strict implicit global) —
implicit globals are name-only with no symbol to stamp (see the implicit-global
notes), so its calls remain unchecked. Out of scope here.
