# `proto(obj, newproto)` hover doc claims it returns the prototype, but it returns the object

**Severity: low (wrong doc).** The `proto` builtin's two-argument (set) form returns the object it was given, not the prototype, but the doc says it returns the "current/previous prototype."

## Reproduction

```ucode
let o = {a:1};
let r = proto(o, {x:1});      // doc says r is the prototype; actually r is o ({a:1})
```

Verified against `ucode/lib.c` (`uc_proto`, lib.c:4188-4193): the 2-arg form returns `ucv_get(val)` (the object). `proto({a:1},{s:2})` → `{ "a": 1 }`.

## Note

The *validator* (`builtinValidation.ts:1977`) correctly narrows the 2-arg return to the first arg's type, so the inferred TYPE is right — only the doc prose (`src/builtins.ts:71`) is wrong.

## Fix

Correct the `proto` doc string: the set-form returns the (modified) object, not the prototype.
