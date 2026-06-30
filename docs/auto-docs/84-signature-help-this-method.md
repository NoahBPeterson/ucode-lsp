# Signature help returns nothing for `this.method(...)` inside an object method

**Severity: low (feature gap).** Calling a sibling method via `this.greet(...)` inside an object method shows no signature.

## Reproduction

```ucode
let o = {
    greet: function(name) {},
    go: function() { this.greet("x"); }    // signature help inside this.greet( → null
};
```

## Root cause

`src/signatureHelp.ts` `resolveCalleeParameters` (≈ line 111) requires the member-access receiver to be an `Identifier`; a `ThisExpression` receiver is rejected, so `this.<prop>(` never resolves. The analyzer already models `this`-property types for hover/diagnostics, so the data exists.

## Fix

When the call's receiver is `this`, resolve `this.<prop>` against the enclosing object literal's properties (reuse the `thisPropertyStack` machinery hover already uses). Shares a root cause with findings 83/86.
