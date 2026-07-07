# Add-import quick fix doesn't merge into an existing import from the same module

**Severity: low (code-action quality).** When the file already imports something from a module, the add-import fix appends a *second* `import` line from the same module instead of merging into the existing specifier list.

## Reproduction

```ucode
import { readfile } from 'fs';
let x = fs.open("/tmp/a");      // UC3006
```

The named-import fix adds:

```ucode
import { readfile } from 'fs';
import { open } from 'fs';      // should merge → import { readfile, open } from 'fs';
```

It compiles (ucode allows two imports from the same module), so this is cosmetic — but it produces messy, non-idiomatic code, and combined with finding 92 the named variant still leaves the call broken.

## Fix

When an `import { … } from '<mod>'` for the same module already exists, merge the new name into its specifier list rather than emitting a new import statement. (The auto-import-on-completion path has the same opportunity.)
