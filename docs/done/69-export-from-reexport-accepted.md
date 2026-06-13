# `export { x } from '...'` and `export * from '...'` are accepted, but ucode rejects them outright

> **STATUS: FIXED in 0.6.221.** `export { … } from …` and `export * from …` now emit UC6001 (unsupported syntax), and `findExports` no longer invents the re-exported names (so a downstream import of them fails with UC3005 instead of resolving a phantom). Tests: `tests/test-import-resolution-strictness.test.js`.

**Severity: medium (false negative).** Re-export syntax silently passes review and is even modeled as working, but ucode has no `from`-re-export grammar — these are hard syntax errors.

## Reproduction

`impl.uc`: `function realfn(){return 5;} export { realfn };`

```ucode
// reexport.uc
export { realfn } from "./impl.uc";    // LSP: no diagnostic
export * from "./impl.uc";             // LSP: no diagnostic
```

Worse, a downstream `import { realfn } from "./reexport.uc"` resolves cleanly — the LSP invents an export that doesn't exist, and `documentLinks.ts` even makes the (invalid) `from` path Ctrl-clickable.

Interpreter: both are syntax errors — `export { realfn } from ...` → "Attempt to export undeclared or non-local variable 'realfn'"; `export * from ...` → "Unexpected token, Expecting 'let','const','function','default' or '{'".

## Root cause

`fileResolver.ts` `findExports` (≈ lines 625-633) reads `specifier.exported.name` and ignores `node.source`, so a re-export is treated as a local export. The parser accepts the `from` clause that ucode's grammar lacks.

## Fix

Reject `export … from` / `export *` as unsupported syntax (matching ucode), and stop `findExports` from inventing re-exported names.
