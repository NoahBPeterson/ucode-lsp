# `this.` completion inside an object method returns global builtins, not the object's properties

**Severity: low-medium (completion).** Inside an object-literal method, completing after `this.` offers the global builtin list instead of the enclosing object's properties.

## Reproduction

```ucode
let o = {
    n: 5,
    m: 'x',
    go: function() { return this.; }   // completion after `this.` → 92 builtins; should be [n, m, go]
};
```

## Why it is wrong

The LSP already infers `this` correctly for **hover and diagnostics** — hovering `this.n` shows `integer` ("Property on `this`"), and `this`-property type resolution works (see the existing `this`-keyword inference feature). Only the **completion** path for `this.` is not wired to the `this`-property table, so it falls through to the global list.

ucode's `this` binds to the object inside a method (verified), and `this.<prop>` is the normal way to reach sibling properties, so completion here should list them.

## Fix

Route `this.` completion through the same `thisPropertyStack` / this-type resolution that hover and diagnostics already use.
