# `require('…')` path completion is not implemented

**Severity: low (completion gap).** Completing the argument of `require('|')` offers the 91 builtins instead of module names.

## Reproduction

```ucode
let m = require('');     // cursor inside the string → 91 builtins; should offer module names
```

`require("fs")` is a valid module-load form (the interpreter returns the module object), so the path string should offer the same module list as `import … from '…'`. There is no `require`-path handling in `src/completion.ts`.

## Fix

Detect the cursor inside a string-literal argument of a `require(...)` call and offer the module-name completion list (the same source the `import … from` path uses, once finding 96 is fixed).
