# Forward-declared function-valued `let` called bare → false UC1002 "Undefined function"

Status: **FIX IMPLEMENTED 0.7.47** (2026-07-02, awaiting user verification). The original
UC1002 at the *outer* call site had already been fixed by SSA reassignment stamping; what
remained (strict mode only) was a successor false positive — **UC2010 "'f' is not a function
(it is of type null)"** on calls *inside* closure bodies whose assignment completes later
(self-recursion, mutual recursion, helper-assigned-after-use). Non-strict escaped via the
implicit-globals suppression at typeChecker `checkCallExpression`.

Fix: post-visit filter in `filterDiagnosticsWithFlowSensitiveAnalysis` backed by
`typeChecker.isDeferredCallableFalsePositive(name, pos)` — drop UC2010 when the call sits
inside a function that CAPTURES the variable (declared outside that function) and any
assignment anywhere stamps a callable type (`currentType`/`typeHistory`). Closure bodies
execute after assignments run, not at their textual position, so position-based SSA state
does not apply inside them. Post-visit because a mutually-recursive partner's assignment is
stamped only after the whole file is visited. True positives preserved (runtime-verified):
straight-line `let f; f(); f = fn` and closures calling never-callable variables still flag.
Tests: `tests/diagnostics/test-forward-declared-function-let.test.js` (8 cases).

Status was: **OPEN** (found 2026-06-19, verified vs `/usr/local/bin/ucode`). High value — this is
the canonical **recursive-closure idiom** in ucode and recurs across the OpenWrt corpus.
Corpus hits: `mwan4/files/lib/mwan4/mwan4.uc` (`_ensure_init`, ~9 false errors at 336/342/356/
395/598/1591/1596/1611/1621), `pbr/files/lib/pbr/pbr.uc:1426` (`result`),
`packages/net/adblock-fast/files/lib/adblock-fast/adblock-fast.uc` (`spawn`, 1881/1893),
`openwrt/.../unetmsg/.../client.uc` (`cb`, 174/184/189).

## Symptom

```js
'use strict';
let spawn;                       // forward declaration (value-less)
spawn = function(n) {            // assigned a function value
    if (n > 0) spawn(n - 1);     // ← false UC1002: Undefined function: spawn
    else print("done\n");
};
spawn(3);                        // ← false UC1002: Undefined function: spawn
```

`spawn` is a defined local that holds a function; calling it is valid ucode. Verified: the
program prints `done` and exits 0. Both call sites are **false positives**.

## The trigger is the SPLIT form only

| Form | Flagged? |
|---|---|
| `let f = function(n){…}; f()`  (inline expression) | **no** (correct) |
| `let f = (n) => {…}; f()`  (inline arrow) | **no** (correct) |
| `let f; f = function(n){…}; f()`  (split / forward-declared) | **YES — false UC1002** |
| `let f; f = (n) => {…}; f()`  (split / forward-declared arrow) | **YES — false UC1002** |

The forward-declared split form is not stylistic — it is *required* for a recursive closure
whose own name must be in scope inside its body, so the corpus uses it heavily.

## Verified semantics (runtime)

```
$ ucode -e "let g; g = function(n){ if(n>0){ print(n); g(n-1); } }; g(3);"
321
```

A `let` variable holding a function value is callable as `name(...)` regardless of whether the
function was bound at the declaration or in a later assignment. ucode does not distinguish the
two — the binding is the same mutable slot.

## Root cause

Two cooperating gaps:

1. The inline declarator path (the 0.6.193 function-valued-variable work, see
   `docs/done/function-valued-variable-return-type.md`) stamps the symbol as a callable
   `FUNCTION` at `let f = <fn>` — so the call resolves. The **split assignment** `f = <fn>`
   never runs that stamping, so at the call site `f` is not recognized as callable and the
   typeChecker emits `Undefined function: f`.
2. The safety-net filter `filterUndefinedFunctionErrorsWithCFG`
   (semanticAnalyzer.ts:5003-5038) only *suppresses* an "Undefined function" error when the
   symbol's `dataType === 'unknown'`:

   ```ts
   const symbol = this.symbolTable.lookupAtPosition(funcName, error.start);
   if (symbol && symbol.dataType === 'unknown') return false; // suppress
   return true; // keep
   ```

   For the split form the symbol's `dataType` has been inferred to `FUNCTION` (from the
   `f = function…` assignment), so it is **not** `'unknown'` → the error survives. The filter
   was written for the "I can't tell if it's callable" case and accidentally excludes the
   "I *know* it's a function" case.

## Fix design

Mirror the inline path so a function value reaching a variable via assignment marks the bound
symbol callable, OR broaden the filter to also suppress when the symbol's resolved type is a
function:

```ts
if (symbol && (symbol.dataType === 'unknown' ||
               symbol.dataType === UcodeType.FUNCTION ||
               symbol.returnType !== undefined)) {
    return false; // a value-holding-a-function callee is valid
}
```

Prefer stamping at the assignment (so return-type/arg-check flow also works), with the filter
broadening as the cheap backstop. Not strict-gated — legal in both modes.

## Relationship to existing docs

Distinct from all current function-valued docs:
- `docs/auto-docs/18-call-non-function-misleading-message.md` — calling a NON-function value
  (integer/string/array); the message is wrong but a diagnostic *is* warranted. Here the value
  **is** a function → no diagnostic should fire.
- `docs/done/global-property-functions.md` — `global.X = fn` bare call; different mechanism.
- `docs/done/function-valued-variable-return-type.md` / `…-param-argcheck.md` — cover the
  **inline** `let f = fn` forms for return-type / arg-checking; neither covers the **split**
  form producing a hard UC1002 at the call site.
