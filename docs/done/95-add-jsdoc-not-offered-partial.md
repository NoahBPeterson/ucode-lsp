# "Add JSDoc" is not offered for a function that already has partial JSDoc

**Severity: low (missing affordance).** If a function has a JSDoc block documenting *some* parameters, no quick fix is offered to complete it for the remaining unknown-typed parameters.

## Reproduction

```ucode
/** @param {string} a */
function g(a, b) { return substr(b, 0); }     // b flows into substr; only the type-guard fix shows, no "complete JSDoc"
```

`generateJsDocQuickFix` (server.ts ~2599) returns `null` whenever `funcNode.leadingJsDoc` is already set, so a function with partial docs gets no "add `@param {…} b`" fix — only the type-guard fix.

## Fix

When a function already has a JSDoc block, offer a fix that *appends* `@param` lines for the still-undocumented/unknown parameters into the existing block, rather than suppressing the JSDoc fix entirely.
