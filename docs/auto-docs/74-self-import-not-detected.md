# Self-import is not detected as a circular dependency

**Severity: low (false negative).** A file that imports from itself is a hard "Circular dependency" error in ucode, but the LSP doesn't flag the cycle (it instead produces incidental/wrong diagnostics).

## Reproduction

`selfx.uc`:

```ucode
import { selffn } from "./selfx.uc";
function selffn() { return 1; }
export { selffn };
```

LSP: emits `UC3001 "Imported symbol 'selffn' is already declared"` (because the name is both imported and locally declared) but never flags the self-import. If the file isn't on disk yet, it gives a spurious `UC3002` instead.

Interpreter: hard "Circular dependency" error on the self-import line.

## Fix

When an import's resolved path equals the importing file's own path, emit a "circular/self import" diagnostic. The analyzer already records `resolvedImports` edges, so the self-edge is directly detectable.
