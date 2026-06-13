# `default` keyword unsupported in brace import/export specifiers

**Severity: medium.** The import/export brace-specifier parser rejects the `default` keyword used as a specifier name. Both `import { default as Name }` and `export { name as default }` are valid ucode but produce `Expected identifier or string literal in import specifier` / `Expected identifier`, plus cascading "Undefined" errors for the symbol.

## Reproduction

Real corpus: `luci/.../luci-base/ucode/dispatcher.uc`:

```ucode
import { default as LuCIRuntime } from 'luci.runtime';   // "Expected identifier or string literal in import specifier"
...
runtime = runtime || LuCIRuntime({ ... });               // cascades to "Undefined function: LuCIRuntime"
```

Reduced — both forms fail in the LSP:

```ucode
import { default as Foo } from './m.uc';     // FAIL
import { default as X, y } from './m.uc';    // FAIL
function a() {} export { a as default };      // FAIL ("Expected identifier")
```

## Verified against `/usr/local/bin/ucode`

```ucode
// importing the default export via braces — VALID:
import { default as Foo } from "./mdef.uc";   print(Foo());      // works

// aliasing a name to the default export — VALID:
function a(){return 7;}  export { a as default };                // works (importer gets 7)
```

Both are accepted by the interpreter, so the LSP diagnostics are false positives.

### One related form that *is* correctly rejected

`export { default } from "./m.uc"` (re-export of a default) is **not** supported by ucode (`Syntax error: Unexpected token`), so the LSP rejecting it matches the interpreter — leave that one alone. The fix is specifically to allow `default` as a specifier name in `import { default as X }` and `export { X as default }`.
