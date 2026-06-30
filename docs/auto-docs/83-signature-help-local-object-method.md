# Signature help returns nothing for a local object-literal method call

**Severity: low-medium (feature gap).** Triggering signature help inside `o.run(...)`, where `o` is a local object literal, returns `null` — no parameters are shown.

## Reproduction

```ucode
let o = { run: function(a, b) {} };
o.run(1, 2);          // signature help inside the call → null (should show run(a, b))
```

## Root cause

`src/signatureHelp.ts` `resolveCalleeParameters` (≈ lines 110-139) only resolves a member receiver when it maps to a module/object-registry type (`extractModuleType`) or has `propertyDefinitionLocations` (cross-file factory). A plain local object literal's own methods fall through both branches. This is inconsistent — document symbols and workspace symbols *do* surface `run` as a Method.

## Fix

Resolve the method's parameters from the receiver's object-literal AST and return the signature. (Same root cause as findings 84 and 86 — fixing the member-receiver resolver addresses all three.)
