# UC3006 "Add `import { method }`" quick fix (the preferred one) leaves the call site broken

**Severity: medium (broken code-action).** For a `module.method()` use, the *preferred* add-import fix inserts a named import but doesn't rewrite the call, so the module name is still undefined.

## Reproduction

```ucode
let x = fs.open("/tmp/a");      // UC3006 "use module without importing it first"
```

The preferred fix (`isPreferred: true`, server.ts ~2757) produces:

```ucode
import { open } from 'fs';
let x = fs.open("/tmp/a");      // fs is STILL undefined → Reference error
```

`fs` remains unbound, so the call fails: `Reference error: left-hand side expression is null`. Only the *secondary* fix `import * as fs from 'fs';` actually works for a `fs.open(...)` member call.

## Why it's wrong

For the `module.method()` access form, the named-import fix would need to also rewrite `fs.open(` → `open(`. As offered, it produces non-working code — and it's marked preferred, so it's the default the user accepts.

## Fix

For a `module.method(...)` diagnostic, either (a) make the named-import fix also rewrite the call site to the bare name, or (b) only offer the `import * as module` fix (which works as-is) and don't mark the call-breaking named-import variant as preferred.
