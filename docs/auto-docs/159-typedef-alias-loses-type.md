# A typedef *alias* registers the name but loses its actual type

**Severity: low.** A typedef that aliases a union or another object typedef is registered as a bare `object` with no properties, dropping the real type.

## Reproduction

```ucode
/** @typedef {string|integer} ID */
/** @param {ID} id */
function f(id) { ... }            // hover id: (no type) — should be string | integer
```

```ucode
/** @typedef {Point} Coord */     // alias of an object typedef
/** @param {Coord} c */
function g(c) { ... }             // hover c: object with NO properties — Point's `x` not inherited
```

## Root cause

`applyJsDocToParams` (`semanticAnalyzer.ts:1270-1282`) unconditionally types a registry hit as `UcodeType.OBJECT` and only copies `properties`; it never resolves `baseType` (a primitive, union, or another typedef name).

## Fix

When applying a typedef with no own `properties`, resolve its `baseType` (primitive/union/another-typedef) and use that type. (Same registry-aware-resolution cluster as finding 154.)
