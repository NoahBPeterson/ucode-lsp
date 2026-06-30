# `values()` drops the element type (object value types are known)

**Severity: low (inference gap).** `values()` returns a bare `array` instead of `array<T>`, even though the source object's value types are known.

## Reproduction

```ucode
let r = values({a:1, b:2});      // hover r: array  (should be: array<integer>)
```

Verified: `values({a:1,b:2})` → `[1,2]` (integers). `keys()` was given the `array<string>` treatment (`builtinValidation.ts:1881`), but `validateValuesFunction` (`:1898`) only does `narrowForArgType(..., ARRAY)` with no element type — even though the source object's `propertyTypes` are available (as `keys` already exploits).

## Fix

In `validateValuesFunction`, derive the element type from the union of the source object's value types (mirroring the `keys → array<string>` treatment), so the result is `array<value-type>`.
