# Optional `@property {integer} [count]` is completely dropped

**Severity: low.** The JSDoc optional-property syntax `[name]` isn't recognized, so the property is absent from the typedef shape (and would falsely error under a closed shape).

## Reproduction

```ucode
/** @typedef {Object} T
 *  @property {integer} [count] */
```

The parser produces zero `property` tags (`\w+` won't match `[count]`); `count` is absent from the shape — no completion/hover, and `t.count` would falsely error. Same gap affects `[name=default]`.

## Fix

Parse the optional-property `[name]` / `[name=default]` syntax (strip the brackets, treat as `integer | null` to reflect optionality), so optional properties are present in the shape.
