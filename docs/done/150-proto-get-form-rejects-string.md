# `proto(string)` (get form) is falsely flagged

**Severity: low (false positive).** The single-argument `proto(x)` query form tolerates any value (returning null for a non-object/array), but the LSP requires arg 1 to be object/array.

## Reproduction

```ucode
let x = proto('s');     // ERROR "Function 'proto' expects object or array for argument 1, but got string"
```

Verified: `proto("string")` → null (returns null gracefully, no throw). The get-form (1 arg) tolerates any value.

## Root cause

`validateProtoFunction` (`builtinValidation.ts:1982`) validates arg 1 strictly as `OBJECT | ARRAY` even in the 1-arg query form.

## Fix

In the 1-arg `proto(x)` form, don't error on a non-object/array argument (it returns null). Keep the 2-arg set-form's object/array requirement.
