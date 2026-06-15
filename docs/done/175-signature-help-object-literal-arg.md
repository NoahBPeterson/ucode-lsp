> ✅ **FIXED** (verified 2026-06-15 triage). `findEnclosingCall` (signatureHelp.ts:28-33) walks all child nodes with a `type` field, including `Property.value`, so a call inside an object-literal arg is found. Confirmed live: `let o = { k: g(| };` → signature `g(a, b)`, activeParameter 0.

# Signature help fails inside an object-literal argument value

**Severity: low (feature gap).** A call placed as an object-literal property value gets no signature help, although the same call in an array-literal argument works.

## Reproduction

```ucode
function g(a, b) {}
let o = { k: g(      // cursor after `(` → signature help returns null
};
```

The same call inside an **array** literal arg (`f([g(`) correctly returns `g(a, b) [active=0]`, so the call is parseable and resolvable — only the object-literal-value context drops it.

## Fix

Make `findEnclosingCall` recognize a call expression nested inside an object-literal property value (the array-literal path already works).
