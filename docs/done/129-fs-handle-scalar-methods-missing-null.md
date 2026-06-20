# fs handle scalar methods (`tell`/`seek`/`truncate`/`lock`/`isatty`/`flush`/`fileno`/`write`) drop `| null`

**Severity: low (missing null).** These `fs.file`/`fs.dir`/`fs.proc` methods all have an error path returning `null`, but the model types them as non-nullable `boolean`/`integer`.

## Reproduction

```ucode
import { open } from 'fs';
let f = open('/x');
let pos = f.tell();        // hover: integer  (should be: integer | null)
let n = f.write('data');    // hover: integer  (should be: integer | null)
```

Verified against `ucode/lib/fs.c`: every one has an `err_return(...)` path returning `null` and JSDoc `@returns {?boolean}` / `{?number}` — `uc_fs_tell` (906), `uc_fs_isatty` (939), `uc_fs_lock` (875), `uc_fs_truncate`, `uc_fs_flush`, `uc_fs_write_common` (265, short-write `ferror`). Affects `fs.file` (tell/seek/truncate/lock/isatty/flush/fileno/write), `fs.dir` (tell/seek/close/fileno), `fs.proc` (write/flush/fileno).

## Root cause

`fsTypes.ts` `fileMethods`/`dirMethods`/`procMethods` list these as bare `boolean`/`integer`.

## Fix

Add `| null` to these methods' return types. (Lower impact than `read()` — finding 124 — since these results are rarely null-guarded, but it's the same correctness class for consistency.)
