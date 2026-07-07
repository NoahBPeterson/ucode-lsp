# JSDoc prefix-nullable `?T` is rejected (only postfix `T?` works)

**Severity: low (false positive + dropped type).** The nullable type `{?string}` produces a `UC7001 "Unknown type '?string'"` and the parameter degrades to `unknown`, even though postfix `{string?}` resolves correctly to `string | null`.

## Reproduction

```ucode
/** @param {?string} x */     // UC7001 "Unknown type '?string'"; x : unknown
function f(x) { ... }

/** @param {string?} x */     // works → x : string | null
function g(x) { ... }
```

## Root cause

`resolveTypeExpression` only handles `typeExpr.endsWith('?')`. The prefix form `?T` (Closure/TypeScript's *more common* nullable syntax) is not recognized, so it both mis-warns and drops the type.

## Fix

Handle a leading `?` in `resolveTypeExpression` (strip it and union with `null`), symmetric with the existing postfix handling.
