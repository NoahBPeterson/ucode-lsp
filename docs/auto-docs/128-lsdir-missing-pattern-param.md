> 🟡 **PARTIAL** (2026-06-15 triage). Hover doc now lists `pattern: string|RegExp|null` (fsBuiltins.ts:47). STILL WRONG: the parameter list driving signature-help (fsModuleTypes.ts:229-235) only has `{ name: "path" }` — no `pattern` param; global `lsdir` (builtins.ts:122) likewise. No test covers `lsdir` with a 2nd arg.

# `fs.lsdir()` is missing its 2nd `pattern` parameter

**Severity: low.** `lsdir(path, pattern)` takes an optional filter pattern, but the LSP models only `path`.

## Reproduction

```ucode
import { lsdir } from 'fs';
let files = lsdir('/etc', '*.conf');     // valid — filtered listing; sig-help shows only `path`
```

Verified against `ucode/lib/fs.c` (`uc_fs_lsdir`, fs.c:2501): reads `pat = uc_fn_arg(1)` accepting `null | string (fnmatch) | regexp`. Interpreter: `lsdir("/tmp","*")` returns a filtered array. (The result is also sorted — `ucv_array_sort` at fs.c:2547 — a doc-accuracy note, not a type issue.)

## Fix

Add the optional 2nd parameter `pattern?: string | regexp` to `lsdir`'s signature.
