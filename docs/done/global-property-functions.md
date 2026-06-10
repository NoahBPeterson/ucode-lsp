# `global.X = fn` callable as bare `X()` — false "Undefined function"

Status: **DONE (0.6.194; hover in 0.6.195)** — collectGlobalPropertyNames pre-pass (dot +
computed-string `global.X =`) shared with the type checker via setGlobalPropertyNames; the
"Undefined function" path suppresses these (NOT strict-gated). 0.6.195: hover.ts also
synthesizes a hover for a bare `global.X` name from `global.propertyTypes` (function →
"(function)", value → its type) so the name isn't hover-less. Tests
test-global-property-functions.test.js (16). Verified vs `/usr/local/bin/ucode`.
Date: 2026-06-08. Corpus: `packages/utils/prometheus-node-exporter-ucode/files/metrics.uc`.

## Symptom

```js
'use strict';
…
global.handle_request = function(env) { … };   // metrics.uc:103  (defines the global)
…
if (!("uhttpd" in global)) {
    handle_request({ … });                     // metrics.uc:223  →  Undefined function: handle_request
}
```

`handle_request` is explicitly installed on the global object at line 103, so the bare call
at 223 is valid. The diagnostic is a **false positive**.

## Verified semantics (vs `/usr/local/bin/ucode`, strict mode)

```js
'use strict';
global.myfn = function(x) { return x * 2; };
print(myfn(21), "\n");   // → 42
global.myval = 7;
print(myval, "\n");      // → 7
```

A property set on `global` becomes a bare-accessible global binding — for **functions and
values alike**, and in **both strict and non-strict** mode. (`global` is a real builtin
object; assigning to its properties is explicit, not the non-strict implicit-global
auto-creation — so unlike implicit globals, this is fully legal under `'use strict'`.)

## Root cause — asymmetry between the two "undefined" checks

The **semanticAnalyzer** already handles this for the *variable* check (visitIdentifier,
semanticAnalyzer.ts:1774-1775):

```ts
const globalSymbol = this.symbolTable.lookup('global');
const isGlobalProperty = globalSymbol?.propertyTypes?.has(node.name);   // suppresses "Undefined variable"
```

…and `global.X = …` is recorded into that map (semanticAnalyzer.ts:2267-2274):

```ts
if (targetSymbol && (objectName === 'global' || …)) {
    targetSymbol.propertyTypes.set(propertyName, inferAssignmentDataType(node.right));
}
```

But the **"Undefined function"** diagnostic is emitted by the **typeChecker** for call
callees (typeChecker.ts:1771), and that path consults builtins, forward-declarations, and
non-strict implicit globals (line 1767) — **but never the `global` symbol's
`propertyTypes`**:

```ts
// typeChecker.ts:1764-1777
if (!this.strictMode && this.implicitGlobalNames.has(funcName)) return UcodeType.UNKNOWN;
this.errors.push({ message: `Undefined function: ${funcName}`, … });   // ← fires for global.handle_request
```

So the data exists (the TypeChecker shares the same `symbolTable` instance —
`new TypeChecker(this.symbolTable)`, semanticAnalyzer.ts:108); the function-call path simply
never reads it. The variable check got the `isGlobalProperty` treatment; the function check
didn't.

## Fix design

Mirror `collectImplicitGlobalNames` / `setImplicitGlobalNames` (semanticAnalyzer.ts:245-246),
which already solved the symmetric problem for implicit globals:

1. A pre-pass collects the names assigned via `global.<name> = …` at any point in the module
   into a set (or reuse the global symbol's `propertyTypes` directly), and shares it with the
   TypeChecker via a setter — robust against traversal ordering, like the implicit-global
   set already is.
2. In the typeChecker "Undefined function" path (before line 1771): if `funcName` is a
   global property, suppress. Prefer typing from the stored RHS — when
   `global.propertyTypes.get(funcName)` is a `FUNCTION`, validate the call against it (and
   the value case feeds normal type flow), rather than blanket `UNKNOWN`.
3. **Not strict-gated.** Unlike the implicit-global suppression at line 1767
   (`!this.strictMode`), `global.X` is legal under `'use strict'` (verified above), so the
   suppression must apply in both modes.

### Payoff

`metrics.uc:223` false "Undefined function: handle_request" gone; the call can be validated
against the stored function signature instead.

## Out of scope / notes

- **UC7003 on metrics.uc:103** ("Function 'global.handle_request' has 1 parameter with
  unknown type: env") is a *separate, legitimate* lint about the untyped `env` param — not
  part of this bug.
- metrics.uc is itself a **template-mode** file (`{%` at line 1, `%}` at line 227); it is
  also subject to `docs/ucode-template-mode-support.md`. Raw-mode parsing happened to recover
  enough here to surface the `handle_request` diagnostic, but the file should ultimately be
  analyzed in template mode.
- Related but distinct: `docs/implicit-global-type-inference.md` (non-strict bare globals)
  and `docs/include-scope-resolution.md` (cross-file leaked globals). All three are variants
  of "a name is validly global through a mechanism the call-check doesn't model."
