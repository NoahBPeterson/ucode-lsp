> 🟡 **PARTIAL** (2026-06-15 triage). `nullMeansWrongType` fixed (fsModuleTypes.ts:207) and the hover doc uses `...patterns: string[]` (fsBuiltins.ts:41). STILL WRONG: fsModuleTypes.ts:203-204 models `{ name: "pattern", optional: false }` (no `isRest`), and signatureHelp.ts:204 hardcodes `isRest: false` for all module-function params — so `fs.glob()` signature-help still shows a single param.

# `fs.glob()` is variadic, but the LSP models a single `pattern` parameter (and misses `nullMeansWrongType`)

**Severity: low.** `glob()` accepts multiple patterns and unions their results, but the model shows one param; it also should narrow away `null` for a known-string arg.

## Reproduction

```ucode
import { glob } from 'fs';
let m = glob('/tmp/*', '/etc/host*');     // valid — union of both globs; sig-help shows one param
```

Verified against `ucode/lib/fs.c` (`uc_fs_glob`, fs.c:2355): `for (i=0; i<nargs; i++)` accumulates each pattern with `GLOB_APPEND`. Interpreter: `glob("/tmp/*","/etc/host*")` returns the union.

`glob` returns `null` only on a non-string arg (`err_return(EINVAL)`), so it should carry `nullMeansWrongType: true` (currently unset on `fsModuleFunctions['glob']`), matching `dirname`/`basename` — so a known-string-arg call can narrow away null.

## Fix

Model `glob(...patterns: string): array<string> | null` (variadic) and set `nullMeansWrongType`.
