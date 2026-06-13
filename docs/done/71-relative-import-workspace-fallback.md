# `./x.uc` falls back to workspace-root resolution — unsound, hides broken relative imports

> **STATUS: FIXED in 0.6.221.** Removed the workspace-root fallback for `./` and `../` imports — a relative path resolves ONLY against the importing file's directory (→ UC3002 otherwise), matching ucode. Tests: `tests/test-import-resolution-strictness.test.js`.

**Severity: medium (false negative).** When a `./`-relative import can't be found relative to the importing file, the resolver retries it against the workspace root. This is unsound — `./` is strictly importing-file-relative in ucode — and it hides genuinely broken imports.

## Reproduction

Workspace root has `util.uc`. From `sub/main.uc`:

```ucode
import { u } from "./util.uc";     // LSP: resolves to <root>/util.uc, no diagnostic
```

Verified: ucode → "Unable to resolve path for module './util.uc'" (there is no `sub/util.uc`).

## Root cause

`fileResolver.ts` (≈ lines 141-154) re-resolves a missing `./path` against `workspaceRoot`. `./` must resolve only relative to the importing file.

## Fix

Remove the workspace-root fallback for `./` / `../` paths. A relative path that doesn't exist next to the importer is a `UC3002`, matching ucode.
