# Relative imports missing the `.uc` extension are accepted, but ucode requires the extension

> **STATUS: FIXED in 0.6.221.** `resolveImportPath` no longer auto-appends `.uc` to a relative import — `import … from "./x"` (no extension) is now UC3002, matching ucode. Tests: `tests/test-import-resolution-strictness.test.js`.

**Severity: medium (false negative).** A `./`-relative import without the `.uc` extension is silently resolved by the LSP, but ucode does not auto-append `.uc` for relative paths — every such import is a latent compile failure.

## Reproduction

File `impl_ok.uc` exists. From a sibling:

```ucode
import { helper } from "./impl_ok";     // LSP: resolves, no diagnostic
```

Verified: `ucode -R -L /tmp/wk -e 'import { helper } from "./impl_ok"; ...'` → **hard error** "Unable to resolve path for module './impl_ok'".

## Root cause

`fileResolver.ts` (≈ lines 134-139) appends `.uc` when the literal path doesn't exist, masking the missing extension. ucode requires the explicit `.uc` for `./`-relative imports.

## Fix

For a `./` or `../` relative import, only resolve the literal path (with its extension). If the bare path lacks `.uc`, flag it (`UC3002`) rather than silently appending the extension.
