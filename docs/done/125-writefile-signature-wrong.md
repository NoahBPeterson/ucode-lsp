# `writefile()` signature is wrong — param 2 is a byte-count limit, not a file mode; data accepts any value

**Severity: low (wrong signature/doc).** The model is `writefile(path: string, content: string, mode: number = 0o644)`, but ucode's `writefile` stringifies any data value and its third numeric argument is a **size limit** (bytes to write), not an octal permission mode.

## Reproduction

Verified against `ucode/lib/fs.c` (`uc_fs_writefile`, fs.c:2940) and the interpreter:

```ucode
writefile("/tmp/f", {a:1, b:[2,3]});    // → 25 bytes, content {"a":1,"b":[2,3]} — data is any-stringified
writefile("/tmp/f", "abcdef", 3);        // → wrote 3 bytes ("abc") — a SIZE LIMIT, not perms
```

The C code stringifies arg2 via `ucv_to_stringbuf_formatted` (accepts any value); arg3 is an integer byte-count.

## Root cause

`fsModuleTypes.ts:263` declares `writefile(path: string, content: string, mode: number = 420)`.

## Fix

Correct to `writefile(path: string, data: any, size?: integer): integer | null`. (No false diagnostic fires today since a string `content` is common, but the signature/`= 420` default mislead users into thinking they're passing permissions.)
