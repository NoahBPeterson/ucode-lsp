# Absolute import paths are handled backwards — real absolute paths flagged, fake `/x` workspace-paths accepted

> **STATUS: FIXED in 0.6.221.** An absolute `/path` import is now checked on the real filesystem FIRST (fixes the false positive on real paths); the workspace-root interpretation is kept only as a secondary fallback for mirrored runtime trees. Tests: `tests/test-import-resolution-strictness.test.js`.

**Severity: low-medium (false positive + false negative).** The absolute-path branch of the resolver treats a leading `/` as workspace-relative instead of as a real filesystem path.

## Reproduction

A. A real absolute path that exists on disk:

```ucode
import { u } from "/tmp/wk/util.uc";     // LSP: UC3002 "Cannot find module '/tmp/wk/util.uc'"  (FALSE POSITIVE)
```
Interpreter resolves it fine.

B. A non-existent absolute path that happens to exist under the workspace root:

```ucode
import { u } from "/util.uc";            // LSP: no diagnostic (resolves <root>/util.uc)  (FALSE NEGATIVE)
```
Interpreter: would not resolve `/util.uc`.

## Root cause

`fileResolver.ts` (≈ lines 158-163): the absolute branch only does `path.resolve(workspaceRoot, importPath.substring(1))` — it strips the leading `/` and joins onto the workspace root, never checking the literal absolute path on disk.

## Fix

For an absolute import path, `fs.existsSync(importPath)` against the real filesystem first, and only then (optionally) consider a workspace-relative interpretation.
