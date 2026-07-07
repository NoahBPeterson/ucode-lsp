# "Add JSDoc" (UC7003) never fires for arrow / function-expression / object-method definitions

**Severity: low-medium (dead coverage).** The UC7003 "unknown parameter — add JSDoc" diagnostic only fires for `function` *declarations* (and named-derived function expressions), never for `const f = (x) => …`, `const f = function(x){…}`, or `{ m: function(x){…} }`. So the "Add JSDoc" quick fix is unreachable for those forms at the definition site, and its elaborate `attachable` logic (server.ts 2607-2614) is effectively dead there.

## Reproduction

```ucode
'use strict';
const f = (x) => substr(x, 0);     // zero UC7003 — no "Add JSDoc" offered on the definition
let o = { m: function(x){ return substr(x, 0); } };   // same — no UC7003
```

A plain `function f(x){ return substr(x, 0); }` *does* get UC7003 + the quick fix.

## Why it matters

Arrow and object-method definitions are pervasive in ucode (mocklib, proto handlers, callbacks). The "annotate this parameter" affordance simply isn't offered where you'd write the annotation — you only get it via the *call-site* trigger, which is less discoverable. Combined with the JSDoc capture gap (`docs/jsdoc-object-property-function.md`) and findings 61–67, the JSDoc pipeline under-serves exactly the most common definition shapes.

## Fix

Emit UC7003 (and offer "Add JSDoc") for arrow / function-expression / object-method definitions with unknown-typed parameters, anchoring the inserted block at the declaration/property (the placement logic already exists; it's just unreachable).
