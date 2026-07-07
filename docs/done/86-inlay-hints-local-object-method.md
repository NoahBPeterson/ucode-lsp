# Inlay hints: no parameter-name hints for local object-literal / `this` method calls

**Severity: low (feature gap).** Parameter-name inlay hints are shown for builtins, module methods, and user functions, but not for calls to a local object literal's methods or `this.method(...)`.

## Reproduction

```ucode
let o = { run: function(alpha, beta) {} };
o.run(1, 2);          // no `alpha:` / `beta:` inlay hints (module methods like fs.open() DO get them)
```

## Root cause

`src/inlayHints.ts` `computeRawInlayHints` (≈ line 77) calls the same `resolveCalleeParameters` (`signatureHelp.ts`) that can't resolve a local-object or `this` receiver (see findings 83/84). So those calls get no hints.

## Fix

Once the member-receiver resolver handles local object literals and `this` (findings 83/84), inlay hints will follow. This is the inlay-hints face of the same gap.
