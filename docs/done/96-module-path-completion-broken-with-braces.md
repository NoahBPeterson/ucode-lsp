# Module-path completion is broken for `import { … } from '…'` (the most common import form)

**Severity: medium (completion).** Completing the module path inside `import { open } from 'f|s'` offers the 91 global builtins instead of module names — but `import * as m from 'f|s'` and `import def from 'f|s'` correctly offer the 16 modules.

## Reproduction

```ucode
import { open } from 'fs';     // cursor inside the path string → 91 builtins (print, printf, …)
```

Expected: `fs, math, uci, ubus, ...` as `Module` items (what the brace-less forms return). `import a, { b } from 'fs'` also fails.

## Root cause

`detectImportCompletionContext` (`src/completion.ts:1307`) walks backward and `break`s on `TokenType.TK_RBRACE` (lines 1342-1344) *before* it reaches `TK_IMPORT`, so a `{ … }` specifier list hides the import context. This kills both in-string path completion and the "right after `from `" branch (line 1366) whenever named specifiers are present.

## Fix

In `detectImportCompletionContext`, don't terminate the backward scan on `TK_RBRACE` — continue to `TK_IMPORT` so the named-import form is recognized like the others.
