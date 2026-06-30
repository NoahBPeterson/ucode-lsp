# fs module is missing the four `IOC_DIR_*` constants → false UC3005

**Severity: low (false positive).** The `fs` module exports four `IOC_DIR_*` constants (the `direction` argument to `fs.file.ioctl()`), but the LSP doesn't model them, so importing one is a false `UC3005 "not exported by the fs module"`.

## Reproduction

```ucode
import { IOC_DIR_READ } from 'fs';     // UC3005 "'IOC_DIR_READ' is not exported by the fs module" + UC1001
```

## Verified against the C source

`ucode/lib/fs.c`, `uc_module_init` calls `ADD_CONST(IOC_DIR_NONE)`, `ADD_CONST(IOC_DIR_READ)`, `ADD_CONST(IOC_DIR_WRITE)`, `ADD_CONST(IOC_DIR_RW)` — alongside the ten `ST_*` constants the LSP *does* model. `src/analysis/fsModuleTypes.ts` defines the `ST_*` set but omits all four `IOC_DIR_*`.

## Fix

Add `IOC_DIR_NONE`, `IOC_DIR_READ`, `IOC_DIR_WRITE`, `IOC_DIR_RW` to the fs module's constant set in `fsModuleTypes.ts`.
