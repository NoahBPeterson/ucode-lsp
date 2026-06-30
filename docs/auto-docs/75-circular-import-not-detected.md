# Circular imports (a ↔ b) are not detected

**Severity: low (false negative).** A mutual import cycle between two files is a hard "Circular dependency" error in ucode, but the LSP doesn't surface it. (It does not crash — which is good — but it never warns.)

## Reproduction

`circa.uc`: `import { b } from "./circb.uc"; function a(){} export { a };`
`circb.uc`: `import { a } from "./circa.uc"; function b(){} export { b };`

(ucode does not accept the inline `export function a(){}` form — a function must be declared and then exported via `export { a };`. The same applies to the setup files in findings 69 and 74.)

LSP: no diagnostic about the cycle (only incidental unused-var notices). Interpreter: rejects the cycle with a "Circular dependency" compile error.

## Fix

Build cycle detection on top of the existing `resolvedImports` edge set (the importer→importee graph is already tracked for cross-file invalidation). When resolving an import would close a cycle back to the current file, emit a circular-dependency diagnostic. Lower priority than the resolution-correctness findings, but it's a real ucode error class the LSP misses.
