# zlib stream `write()` can return `null`, but is modeled `boolean`

**Severity: low (missing null).** The deflate/inflate stream `write()` methods have error paths returning null, modeled as non-nullable `boolean`.

## Reproduction

```ucode
import * as zlib from 'zlib';
let d = zlib.deflater();
let ok = d.write('data');      // hover: boolean  (should be: boolean | null)
```

Verified against `ucode/lib/zlib.c`: `uc_zlib_defwrite`/`infwrite` have multiple `err_return(...)` paths (→ null) before `return ucv_boolean_new(...)`.

## Fix

Model the zlib stream `write()` return as `boolean | null`, consistent with the module's `read`/`error` (already `string | null`).
