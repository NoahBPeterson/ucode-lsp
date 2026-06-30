# Object-shape `@param {{a: string}}` is silently dropped — no type, no warning

**Severity: low-medium (inference gap + inconsistency).** An inline object-shape param type is silently discarded: the parameter becomes `unknown` and **no diagnostic** is emitted (not even `UC7001`).

## Reproduction

```ucode
/** @param {{a: string}} x */
function f(x) { return x.a; }     // x : unknown; no diagnostic at all
```

Contrast: a function type `@param {function(string):integer}` *does* get `UC7001`. The object-shape form gets nothing — inconsistent.

## Root cause

`jsdocParser.ts` — the nested `{ }` breaks both `@param` regexes: `@param\s+\{([^}]+)\}\s+(\w+)` can't match the name after the inner `}`, and the bare fallback can't treat `{` as a name. So no `param` tag is produced and the parameter silently defaults to `unknown`.

## Fix

Parse balanced braces in the `@param` type span (not `[^}]+`), so `{{a: string}}` is captured. The typedef machinery already supports `propertyTypes`, so the shape could actually type `x` once parsed; at minimum emit `UC7001` rather than dropping it silently.
