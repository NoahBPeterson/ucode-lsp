# Object-type method returns are mislabeled "X module" in hover (`struct.buffer`/`zlib`/`uloop`/`socket`)

**Severity: low (hover wording).** When a method returns a bare object-type (no `| null`), hover shows e.g. `struct.buffer module` — the literal word "module" is wrong (it's a buffer instance, not the module namespace).

## Reproduction

```ucode
import * as struct from 'struct';
let b = struct.buffer();
let x = b.put('I', 1);      // hover x: `struct.buffer module`  (should be: struct.buffer)
```

Same for `b.start()`/`b.end()`/`b.set()`, and zlib/uloop/socket object returns.

## Root cause

`symbolTable.ts:250-254` — `typeToString` only whitelists `fs.`/`uci.`/`io.` prefixes to print the bare object-type name; every other object type falls through to `` `${moduleName} module` ``. Triggers whenever a method returns a bare `ModuleType` (no `| null`); the `| null` returns print correctly via a different path.

## Fix

Replace the prefix whitelist in `typeToString` with `isKnownObjectType(moduleName)` (one-line), so any object-type name renders bare. Benefits struct/zlib/uloop/socket/ubus.
