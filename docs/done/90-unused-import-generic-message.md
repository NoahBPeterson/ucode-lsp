# An unused import is reported as a generic "Variable declared but never used" with no remove-import fix

**Severity: low (diagnostic clarity + missing quick fix).** An imported-but-unused symbol gets the same `UC1006 "Variable 'X' is declared but never used"` message as a local variable, with no indication it's an import and no "remove unused import" quick fix.

## Reproduction

```ucode
import { open } from 'fs';
print('hi');               // UC1006 "Variable 'open' is declared but never used"
```

## Why it matters

* The message calls the import a "Variable", which is slightly misleading.
* Unused imports are the most common thing a developer wants to auto-clean. Mainstream LSPs offer a dedicated "Remove unused import" code action (and often render the import faded via the `Unnecessary` diagnostic tag). Here there is neither — the user must hand-delete the import line, and a whole-import-statement cleanup (when *all* names in one `import { a, b }` are unused) isn't offered at all.

## Fix

* Use an import-specific message (e.g. `Import 'open' is never used`).
* Add a "Remove unused import" code action (removing the specifier, or the whole `import` statement when every specifier is unused).
* Optionally attach the LSP `DiagnosticTag.Unnecessary` so editors fade the unused import.
