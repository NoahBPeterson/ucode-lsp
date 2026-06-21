# ucode template-mode (`{% %}` / `{{ }}`) bring-up

Status: **Phase 1 (lexer) DONE; phases 2–5 planned.** Investigated 2026-06-08,
bring-up started 2026-06-20. Corpus: `firewall4/`, `luci/`, `snort3/` template `.uc`.

## Implementation plan (phased)

| Phase | Scope | Status |
|---|---|---|
| 1 | **Lexer**: stop bailing to 0 tokens on a leading/abutting empty `TK_TEXT`; preserve `TK_EOF` when a file ends on a tag; handle whitespace-trim markers `{%-`/`{%+`/`{{-`/`{#-` and `-%}`/`-}}`; fix the `blockComment` phantom-recursion. | ✅ done |
| 2 | **Parser**: a `parseTemplateProgram()` that interleaves `TK_TEXT` chunks with `{% stmt %}` (reuse `parseStatement`) and `{{ expr }}` (reuse `parseExpression`). Alt-colon block syntax (`if(): … endif`) already parses. | planned |
| 3 | **Mode detection** (see below) + thread through the ~16 `rawMode: true` call sites. | planned |
| 4 | **Scope**: a template's free variables are render-context inputs (firewall4 injects `fw4`/`rule`/`zone`/…), so they must not fire UC1001. (Same family as the C8 injected-globals cluster — decision pending: auto-suppress vs. declared via directive/config.) | planned |
| 5 | **Tests**: the in-tree 18-file template corpus → zero false diagnostics. | planned (lexer unit tests landed in phase 1) |

## Detection — the canonical rule (from `ucode/main.c`)

Mode is **invocation-determined**, NOT extension- or content-based at the source level:
default `raw_mode = true`; the **`utpl`** binary or **`-T`** flag selects template,
**`-R`** forces raw. **There is no `.ut` convention** — 0 `.ut` files exist in the entire
ucode source; templates use `.uc`, same as raw scripts. (This corrects the earlier draft
below.)

Since the LSP can't see the invocation, replicate the decision from what the file carries,
in priority order:
1. **Shebang, if present** — mirror `main.c`: `utpl`/`-T` ⇒ template; `ucode`/`-R`/`-S`/`env ucode` ⇒ raw.
2. **No shebang** — a leading/embedded template tag `{%` / `{{` / `{#` ⇒ template. Sound,
   not a guess: those byte pairs are not valid raw ucode (`{%` = open-block-then-modulo, a
   syntax error), and this is the only signal the no-shebang OpenWrt corpus carries (it
   covers 100% of it — every real template starts with `{%`, no shebang).
3. **Known-imported modules** (resolved via another file's `import`/`require`) ⇒ raw (a
   module is always compiled raw). Refinement; rarely contradicts #2.

## What already exists (don't rebuild)

- **Token layer is complete**: `TK_TEXT`, `TK_LSTM`/`TK_LEXP`/`TK_RSTM`/`TK_REXP`, the
  block-control keywords `endif`/`endfor`/`endwhile`/`endfunction`, and `TK_COLON` are all
  defined and keyword-mapped.
- **Parser already handles the alt-colon block syntax** (`parseColonEndBlock` in
  `controlFlowStatements.ts`), so `{% if (x): %}…{% endif %}` parses once reached.
- After phase 1 the **lexer fully tokenizes templates** (fw4 `ruleset.uc`: 0 → 3443 tokens).

---

## Original investigation (2026-06-08) — kept for evidence; detection notes superseded above

## The gap

ucode's **native default is template mode**; the `-R` flag (and module `import`/`require`)
selects raw mode. (This is the same `-R` from the `#!/usr/bin/ucode -R` shebang work.)
OpenWrt's firewall4 ships its entire ruleset generator as ucode *templates*:

```
{%
	let flowtable_devices = fw4.resolve_offload_devices();
-%}
table inet fw4
{% if (fw4.check_flowtable()): %}
delete flowtable inet fw4 ft
{% endif %}
	devices = {{ fw4.set(flowtable_devices, true) }};
```

Syntax in use: `{% stmt %}`, `{{ expr }}`, `{# comment #}`, whitespace-trim variants
`{%+`/`-%}`/`{%-`/`+%}`, and the block-control form `if (…): … endif` / `for (…): … endfor`.

The LSP is **completely broken** on these files. Measured with the real validator:

| file | lines | diagnostics |
|---|---|---|
| `templates/zone-verdict.uc` | 18 | **48** |
| `templates/ruleset.uc` | 473 | **239** |

Every diagnostic is a false positive — a UC6004 "Unexpected token in expression" per block
tag plus a UC1001 "Undefined variable" storm for every `{{ expr }}` identifier
(`fw4`, `rule`, `zone`, `verdict`, …). These `.uc` files are picked up by the workspace
scan, so the Problems panel fills with hundreds of bogus errors.

## Why — three layers, all broken

1. **Validator forces raw mode.** `ast-validator.ts:43` and every parse site in
   `fileResolver.ts` (lines 60, 213, 276, 356, 448, 550, 708, …) hardcode
   `new UcodeLexer(text, { rawMode: true })`. Template mode is never even attempted, so the
   literal nft text (`table inet fw4`) is lexed as code → the UC6004/UC1001 storm.

2. **Lexer template mode bails to 0 tokens.** With `rawMode: false` the default state is
   `UC_LEX_IDENTIFY_BLOCK` and `identifyBlock` *does* emit `TK_TEXT` and transition into
   `TK_LEXP`/`TK_LSTM`/`TK_REXP`/`TK_RSTM` tag states. BUT `emitBuffer` (ucodeLexer.ts)
   returns `null` for an empty `TK_TEXT` buffer:

   ```js
   if (this.buffer.length === 0 && type === TokenType.TK_TEXT) return null;
   ```

   `tokenize()` loops `while ((token = nextToken()) !== null)`. When a template *starts*
   with a tag (`{%…` — the common case), the first `identifyBlock` emits empty `TK_TEXT`
   → `null` → the loop exits immediately → **0 tokens**. Measured: zone-verdict.uc yields
   262 tokens in raw mode, **0** in template mode.

3. **Parser has no template-token awareness.** `TK_LSTM`/`TK_LEXP`/`TK_TEXT`/`TK_REXP`/
   `TK_RSTM` appear nowhere in `src/parser/*.ts`. Even with a fixed lexer, `UcodeParser`
   has no production that consumes interleaved text + tag tokens.

## What a fix needs

- **Mode detection.** Decide template vs raw per file. Options: (a) shebang `-R` ⇒ raw;
  (b) presence of `{%`/`{{…}}` block markers ⇒ template; (c) module files reached via
  `import`/`require` are always raw. firewall4 templates have no shebang and are loaded via
  the template renderer, so marker-sniffing is the practical signal.
- **Lexer fix.** Don't terminate `tokenize()` on a legitimately-empty leading `TK_TEXT`
  (distinguish "empty text between adjacent tags" from EOF). Handle the whitespace-trim
  markers `{%+ -%} {%- +%}` and the `: … endif/endfor/endfor/else` block-control form.
- **Parser.** A template program = sequence of `TK_TEXT` chunks and tag blocks; statement
  tags carry ordinary ucode statements, expression tags a single expression. Identifiers
  inside tags resolve against the render scope (e.g. firewall4 injects `fw4`, `rule`,
  `zone`, `verdict`, `egress`, …) — those are *parameters of the render context*, not
  undefined globals, so UC1001 must not fire for them (likely treat a template's free
  variables as implicit render-scope inputs, similar to the implicit-global handling).

## Scope / priority note

This is not a small patch — it's a second front-end mode through lexer + parser + scope
analysis. But it's the difference between "usable" and "239 false errors" on a flagship
OpenWrt ucode codebase. If a full implementation is too large now, a cheap interim
mitigation is **mode detection that SKIPS diagnostics on detected template files** (emit
nothing rather than garbage) so the Problems panel isn't poisoned by the workspace scan.
