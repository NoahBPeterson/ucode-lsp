# "Find all references" / document-highlight on a plain object method misses every call site

**Severity: medium (feature correctness).** Find-references (and document-highlight, which shares the code) on a method of a plain local object returns only the definition, dropping all call sites.

## Reproduction

```ucode
let o = { run: function() { return 1; } };
o.run();
o.run();
```

References on either a call-site `o.run` or the `run` key → **1 location** (the definition only). Should be **3** (definition + both calls). Document-highlight is equally blind.

## Root cause

`src/server.ts` `resolveMemberCanonical` (~line 1299) only handles namespace-imports and factory-returned receivers; `collectReferences` (~1333) has no branch for a member whose receiver is a plain local object. The machinery exists in `src/references.ts` (`findFactoryMethodReferences`, `findNamespaceMemberReferences`) — only the plain-local-object case is unimplemented.

## Note

Rename on the same construct returns `null` (blocked), which is at least safe. Find-references silently returning an incomplete set is the more dangerous behaviour (a user trusts it for refactors).
