# `import` inside a leading `{% %}` template block is falsely flagged UC3007 ("not at top level")

**Severity: medium (false positive; pervasive in LuCI/`.ut` templates).** In a ucode **template** file, the code inside the opening `{% … %}` statement block *is* module top level — `import` there is valid. The LSP parses every file as raw script (`rawMode: true`), so it treats the `{%` block as a nested block/expression and flags the import with `UC3007` ("Import declarations may only appear at the top level of a module, not inside a function or block"), plus a cascade of follow-on errors.

## Reproduction

```ucode
{%
// Copyright (c) 2023-2024 Eric Fahlgren <eric.fahlgren@gmail.com>
// SPDX-License-Identifier: GPL-2.0

import { lsdir } from 'fs';
let d = lsdir('/tmp');
printf("%d\n", length(d));
%}
```

LSP emits **4** diagnostics, all false:

| code | line | message |
|---|---|---|
| `UC6001` | `{%` opener | Unexpected token in expression |
| `UC3007` | the `import` | Import declarations may only appear at the top level… |
| `UC1002` | `lsdir(...)` | Undefined function: lsdir (cascade — the import never resolved) |
| `incompatible-function-argument` | `length(d)` | Argument 1 of length() is unknown (cascade) |

**Verified valid** vs the interpreter: `ucode -T file.ut` runs it cleanly (prints the dir count). `-T` = template mode; `-R` (raw) is the default the LSP hard-codes. The import-in-`{% %}` form executes fine — it is genuinely top-level module code.

## Root cause

The same template-mode gap tracked in `docs/ucode-template-mode-support.md`: the validator and every `fileResolver` parse site hard-code `rawMode: true`, so a `.ut`/template file is lexed/parsed as if the `{%`/`%}` tags were code. The `{%` opener yields `UC6001`; the block body is then seen as nested (not module top level), so the import trips the UC3007 guard; and because the import is discarded, `lsdir` cascades to `UC1002`. (The lexer's *other* template-mode hazard — `}}`/`{{`/`%}` appearing in ordinary code flipping the lexer into template mode — is the already-fixed crash in finding [01].)

## Fix

Two tiers, mirroring the template-mode doc:
1. **Cheap interim:** detect a template file (leading `{%`/`{{` markers, or a `.ut` extension / `-T` shebang) and **skip diagnostics** on it, so a workspace scan doesn't poison the Problems panel with hundreds of false squiggles.
2. **Proper:** a second front-end mode that lexes `{%…%}` / `{{…}}` / surrounding `TK_TEXT` and parses the block contents as top-level module statements — at which point `import` inside `{% %}` is correctly top-level and UC3007 doesn't fire. Template free variables (render-scope inputs) also stop being false `UC1001`.

See `docs/ucode-template-mode-support.md` for the full end-to-end analysis (3 broken layers: hard-coded `rawMode`, lexer bail on a leading tag, zero parser handling of `TK_LSTM/TK_LEXP/TK_TEXT/…`). This finding is the single most visible *symptom* on real LuCI code.
