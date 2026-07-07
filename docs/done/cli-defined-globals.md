# `ucode -D NAME=value` CLI-defined globals (snort `QUIET`/`TYPE`)

Status: **investigated; no sound source-only resolution — needs declaration.** Date: 2026-06-08.
Corpus: `packages/net/snort3/files/main.uc`.

## Symptom

```js
{%
QUIET;   // Reference globals passed from CLI, so we get errors when missing.
TYPE;
...
let table_type = TYPE;          // main.uc:263  "Supply on cli with '-D TYPE=snort'"
if (QUIET) exit(1);
```

`QUIET`/`TYPE` are flagged undefined. They are **command-line-defined globals**, injected by
the invocation, not declared in any `.uc` file.

## How they're actually defined

`ucode -D NAME=value` (and the `utpl` template CLI) inject a global before running the script.
Verified value typing (JSON-ish parse):

```
ucode -D QUIET=1      → type(QUIET) == "int"
ucode -D NAME=hello   → type(NAME)  == "string"
ucode -D OBJ='{"a":1}'→ type(OBJ)   == "object"
```

The snort invocation lives in a **shell script**, `files/snort-mgr:95`:

```sh
utpl -D TYPE="$table" -D QUIET=$QUIET -S "$MAIN"
```

So the global **names** (`TYPE`, `QUIET`) appear only in a shell wrapper, and their **values**
are shell variables — fully dynamic. There is no ucode-source artifact that declares them.
The bare `QUIET; TYPE;` statements at the top of `main.uc` are a deliberate idiom: under the
build's strict invocation they force a runtime error if `-D` was omitted.

## Why this is fundamentally unresolvable from source alone

The definition lives **outside the ucode source tree entirely** — in a CLI invocation inside a
shell script, with dynamic values. This is precisely the situation ESLint solves with its
`globals` config / `env` / `/* global */` directive: runtime-injected globals can't be inferred
from the consuming source. There is no clever AST analysis that recovers them.

## Options (none fully automatic + typed; pick per appetite)

1. **Project config `.ucode-lsp.json` (recommended, sound + typed).** The ESLint-`globals`
   analog:
   ```json
   { "globals": { "QUIET": "boolean", "TYPE": "string" } }
   ```
   Declares the names and (optionally) types. Shared with the same config used for
   `docs/call-scope-injection.md` ambient scopes. One small file per package.

2. **ESLint-style in-file directive (names only).** `/* ucode-globals QUIET, TYPE */` at the
   top of the file → suppress UC1001 for those names (type stays `unknown`, so `if (QUIET)`
   works but `let t = TYPE` is `unknown`).

3. **Auto-harvest `-D` names from build files (opportunistic, names only).** Scan workspace
   `Makefile`/`*.mk`/`CMakeLists.txt`/`*-mgr` shell scripts for `\b(ucode|utpl)\b.*-D\s*(\w+)`
   and register the captured names as known globals for files in that package. Gives
   suppression, not types (values are dynamic). Fragile but zero user effort; log what it
   harvested.

4. **Recognize the in-file "declare external" idiom (source-local, automatic, names only).**
   A bare top-level identifier-expression-statement (`QUIET;` / `TYPE;` — an `ExpressionStatement`
   whose expression is a lone `Identifier`, no call/member/assignment) is almost always the
   author's "this is a required external global" declaration (it has no other effect). Treat
   such names as declared externals for the rest of the file and suppress UC1001 on their
   later uses. Cheap, needs no config, and matches the snort idiom exactly. Risk: a genuine
   typo that appears as a bare statement would be silently accepted — low, since bare
   `name;` statements are otherwise rare; could gate to "name is referenced again later."

5. **`SCREAMING_SNAKE_CASE` naming heuristic (source-local, automatic, names only).** ALL-CAPS
   identifiers are the ucode convention for constants / externally-injected globals — the
   built-ins use it (`ARGV`, `REQUIRE_SEARCH_PATH`, `NaN`, `Infinity`) and so do the injected
   ones (`QUIET`, `TYPE`, `MOCK_SEARCH_PATH`). So an **unresolved** name matching
   `/^[A-Z][A-Z0-9_]*$/` that is **read-only** (never assigned/declared in the file) is very
   likely an external constant, not a typo. Treat such reads as a likely-external global:
   downgrade UC1001 to a hint, or suppress it outright in **non-strict** mode (where an
   undefined read is `null`, not a crash — consistent with the implicit-globals philosophy in
   `docs/implicit-global-type-inference.md`). Keep it stricter under `'use strict'` (undefined
   read crashes — but note even there an injected `-D` global runs fine, so a hint is more
   honest than an error). This is the user's observation ("UPPERCASE ≈ defined global, like
   ARGV") turned into a rule.

   - **Soundness:** a heuristic, not a proof — a genuinely-undefined ALL-CAPS constant (forgot
     to `-D` it) won't be flagged, and an ALL-CAPS typo would be accepted. Both are rarer than
     the false positives it removes. Locally-declared `const MAX = 5` is already resolved, so
     it's unaffected; the rule only touches *unresolved* names.
   - **Best combined:** ALL-CAPS + read-only is a strong signal on its own; stack it with (4)
     the bare-`NAME;` idiom and (1) config for precision. Lowercase injected globals (`netifd`,
     `fw4`, `gauge`) fall outside this and still need the scope-injection / config paths.

## Recommendation

Ship **(1) project config** as the sound, typed answer, and **(4) idiom recognition** as a
zero-config automatic fallback that at least clears the false UC1001 for the very common
`QUIET; TYPE;`-style declaration block. **(2)** covers one-off files, **(3)** is a nice
opportunistic bonus. Honest framing for the user: like every linter, CLI/runtime-injected
globals must ultimately be *declared* somewhere the LSP can read — the cleverness is only in
making that declaration as cheap as possible (idiom recognition) or harvesting it from the
build (3).

## Relationship to other docs

The flat-name end of the "validly-global-through-an-unmodeled-mechanism" family:
`docs/call-scope-injection.md` (object scope, has shape), `docs/netifd-injected-global.md`
(`include` scope), `docs/implicit-global-type-inference.md` / `docs/global-property-functions.md`
(in-source globals). `-D` globals are the hardest because the source contains *neither* the
shape *nor* the names reliably — only the consuming references.
