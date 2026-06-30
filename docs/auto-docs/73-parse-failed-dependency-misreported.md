# Importing from a file that fails to parse is reported as "does not export X" — wrong root cause

**Severity: low-medium (misleading diagnostic).** When an imported module has a syntax error, the importer gets `UC3005 "does not export 'X'"` for every imported name, instead of being told the dependency failed to compile.

## Reproduction

`broken.uc`: `function f( { return ;;; @#$`

```ucode
import { something } from "./broken.uc";
// LSP: UC3005 "Module ./broken.uc does not export 'something'"  +  "Undefined function: something"
```

Interpreter: "Unable to compile module '.../broken.uc': … Expecting Label" — the dependency doesn't *compile*.

## Root cause

The error-tolerant parser returns a partial AST for `broken.uc`, so `getModuleExports` yields `[]`, and every imported name then looks un-exported. The real problem (a parse failure in the dependency) is never surfaced.

## Fix

In `loadModuleExports`, detect when the target module failed to parse (parser produced errors) and emit a distinct diagnostic — e.g. `Module './broken.uc' could not be parsed` — rather than a misleading "does not export" per name.
