# `stat()` / `lstat()` result is a bare `object` — its fully-known shape is lost

**Severity: low-medium (inference gap + asymmetry).** `stat()` returns a fixed-shape object, but the LSP models it as bare `object`, so field access gets no type, no completion, and no field-name checking — unlike `statvfs()`, which IS fully shape-modeled.

## Reproduction

```ucode
import { stat } from 'fs';
let st = stat('/x');
st.size;      // hover: unknown (no type, no completion)
st.type;      // unknown — though it's always a string
st.dev.major; // unknown
```

Verified against `ucode/lib/fs.c` (`uc_fs_stat_common`, fs.c:1667-1731): the result is a fixed object — `dev{major,minor}`, `perm{12 booleans}`, `inode/mode/nlink/uid/gid/size/blksize/blocks/atime/mtime/ctime` (integers), and `type` (string: "file"/"directory"/"char"/...). Documented as `FileStatResult`.

## Asymmetry

`statvfs()` IS fully shape-modeled (`statvfsProperties` + `statvfsObjectType`; `statvfs('/x').bsize` hovers `integer`), so the registry already has the machinery (`ObjectTypeDefinition` with `isPropertyBased`). It's just not applied to `stat`/`lstat`.

## Fix

Define a `stat` object-type with the known fields (mirroring `statvfs`) and set `stat`/`lstat` return types to it.
