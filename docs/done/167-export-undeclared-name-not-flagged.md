# Exporting an undeclared name is not flagged (a hard ucode compile error)

> **STATUS: FIXED in 0.6.220.** `export { name }` of a non-module-local name now emits UC3003 — covers undeclared, builtin, and imported (all hard ucode errors, verified vs the interpreter). Inline `export const`/`export function` and local let/const/function stay clean. Post-pass `checkExportedNames` (runs after the full visit so later declarations resolve). KNOWN LIMITATION: export-BEFORE-declaration ordering not flagged (separate, rarer; avoids function-hoisting false positives). Tests: `tests/test-false-negative-batch.test.js`.

**Severity: low-medium (false negative).** Listing a name in an `export { … }` that was never declared is a hard syntax error in ucode (the whole module fails to compile), but the LSP reports nothing — and silently lets importers believe the export exists.

## Reproduction

```ucode
// ud.uc
const a = 1;
export { a, ghost };     // LSP: clean.  ucode: "Syntax error: Attempt to export undeclared or non-local variable 'ghost'"
```

Verified: `ucode -R -L . main.uc` where main imports from ud.uc → "Unable to compile module … Attempt to export undeclared … 'ghost'" (exit 255). Worse, a downstream `import { ghost }` is also silently accepted.

## Fix

Validate every name in an `export { … }` specifier list against the module's declared/local symbols; emit a diagnostic (e.g. `UC3003 INVALID_EXPORT`, which already exists in the registry — see finding 104) for an undeclared exported name.
