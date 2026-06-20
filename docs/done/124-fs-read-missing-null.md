# `fs.file.read()` / `fs.proc.read()` / `fs.dir.read()` return `string`, not `string | null`

**Severity: low-medium (missing null).** All three handle `read()` methods are modeled as `string`, dropping the `| null` that signals error AND (for `dir.read`) end-of-stream. So the canonical null-checked read loops are typed as non-null and null guards look dead.

## Reproduction

```ucode
import { open, opendir } from 'fs';
let c = open('/x').read('all');     // hover c: string   (should be: string | null)
let d = opendir('/etc');
let e = d.read();                    // hover e: string   — but null is the LOOP TERMINATOR
while (e != null) { /* ... */ e = d.read(); }   // the `!= null` guard looks dead
```

Verified against `ucode/lib/fs.c`: `uc_fs_read_common` (fs.c:236) returns NULL on read error / `lsize<=0` / invalid length; `uc_fs_readdir` (fs.c:1410) returns null at **end-of-directory** and on error; JSDoc says `@returns {?string}` for all three.

## Root cause

`fsTypes.ts` (file `returnType: 'string'` lines 22/102, dir line 60) drops the `| null`. The `read('all')`/`read('line')`/`read(n)` mode handling is otherwise fine — only the null-ness is wrong.

## Fix

Model `fs.file/proc/dir.read(...)` as `string | null`. The `dir.read()` end-of-stream null is the highest-impact case (the standard `while ((e = d.read()) != null)` idiom).
