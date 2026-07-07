# Template render-scope names have no hover (editor) and no injection at all (CLI)

Status: **NOT STARTED.** Filed 2026-07-07 from the --type-coverage audit.

## The gap

**1,176 of the 1,987 no-hover occurrences** — by far the dominant cluster — are reads of
include()-injected render-scope names (`fw4`, `rule`, `zone`, `redirect`, `verdict`, `egress`,
`direction`, …) in the firewall4 template trees (both vendored copies):

```
firewall4/root/usr/share/firewall4/templates/rule.uc(3,5): no-hover: 'rule'   // {%+ if (rule.family && !rule.has_addrs): -%}
firewall4/root/usr/share/firewall4/templates/ruleset.uc(81,…): no-hover: 'fw4' // {% for (let zone in fw4.zones()): %}
firewall4/root/usr/share/firewall4/templates/redirect.uc(74,…): no-hover: 'redirect'
```

The audit's original hypothesis — "the parser doesn't support the alternative colon block
syntax, so the whole file fails to parse" — is **FALSE**. Verified:

- The colon form is real upstream syntax: `ucode/lexer.c:48-59` defines `TK_ENDIF`/`TK_ENDFOR`/
  `TK_ENDWHILE`/`TK_ENDFUNC` keywords and `ucode/compiler.c:2400-2485` compiles the delimited
  `if (…): … elif …: else: endif` block form.
- The LSP has parsed it since 0.7.0 (`parseColonEndBlock`, per
  `docs/done/ucode-template-mode-support.md` phase 2). `node bin/ucode-lsp.js
  firewall4/.../templates/rule.uc` reports **zero** UC6001/UC6015 — the file parses clean; all
  188 of its diagnostics are UC1001 "Undefined variable: rule/fw4".

The names are undefined-in-file by design — they're injected by
`include("rule.uc", { fw4, zone, rule })` sites (phase 4b built exactly this index). The
occurrences are no-hover because of **two independent, unbuilt layers**:

## Root cause

**(a) The CLI never builds the include-scope index.** `runTypeCoverage`/`analyzeFile`
(`src/cli.ts:262-307, 483`) construct a bare `SemanticAnalyzer` per file and never call
`analyzer.setInjectedScope(...)`. The index machinery is server-only: `server.ts:720-726`
(`getWorkspaceIncludeScopeIndex().get(selfPath)` → `setInjectedScope`). So in the CLI —
including this very audit — every injected name is a plain UC1001 undefined variable. The CLI
checker and the editor disagree, which `analyzeFile`'s own doc comment promises they won't.

**(b) Even in the server, hover has no injected-scope fallback.** `setInjectedScope` feeds the
names/types to the TYPE CHECKER only (`semanticAnalyzer.ts:487-490, 550-558` →
`typeChecker.setInjectedScopeNames/Types`) — it never declares symbols in the symbol table, and
`SemanticAnalysisResult` (`semanticAnalyzer.ts:100-127`) doesn't expose the injected set. The
hover fallback chain (`src/hover.ts:1500-1540`) has explicit treatments for implicit globals,
unresolved SCREAMING_SNAKE names, and `loadfile()`-injected globals — but nothing for
include()-render-scope names, so a bare `fw4` hover falls through every branch and returns
null. (UC1001 suppression and member-access typing work; only the hover surface is missing.)

## Proposed approach

1. **Hover fallback (server)**: expose the injected scope on the analysis result (names +
   type strings + the includer paths from `IncludeScopeEntry`), and add a branch in hover.ts's
   fallback chain, modeled on the loadfile-globals branch (`hover.ts:1528-1540`):
   `(render scope) **fw4**: \`object\` — injected by include() from main.uc`. Same for
   completion if it doesn't already offer injected names.
2. **CLI parity**: in `cli.ts`, when more than one file is being checked (or always, walking
   the target root), build the same include-scope index over the file set —
   `buildIncludeScopeIndex` (`src/analysis/includeScope.ts:244`) is already
   workspace-agnostic (takes `Array<{path, ast}>`) — and call `setInjectedScope` per file.
   This fixes both `--type-coverage` accuracy and normal CLI diagnostics (188 false UC1001 in
   rule.uc today).
3. **Typing depth (partial)**: `fw4` is injected as a bare identifier whose value is
   `require("fw4")` — a USER module, which the index deliberately leaves untyped
   (`ucode-template-mode-support.md`: "user-module require stays untyped — needs user-module
   shape inference"). After 1+2 these occurrences become hover-with-`unknown` rather than
   fully typed; closing that is the separate user-module shape feature (family:
   `docs/dict-value-typing-object-members.md`).

## Not covered here (existing decisions)

- **Open-world templates** — 209 further occurrences: `templates/mangle-rule.uc` (151) and
  `zone-notrack.uc` (29 per tree ×2) are include()d NOWHERE in the workspace.
  `docs/done/ucode-template-mode-support.md` already records the "no blanket auto-suppress"
  decision: with no visible render site there is nothing sound to inject. (A `.ucode-lsp.json`
  association, per `docs/call-scope-injection.md` Layer 2c, would be the opt-in fix.)
  mangle-rule.uc additionally carries a genuine upstream syntax error (line 1
  `{%+ for (let src_devices in rule.src?.zone) }` — no `%}` close; verified as pristine
  upstream via `git show` in the vendored clone; the template is referenced by nothing and is
  dead upstream code).
- **Deploy-path include targets** (snort3) → `docs/tc-include-deploy-path-mapping.md`.

## Test cases

- CLI: `node bin/ucode-lsp.js firewall4/root/usr/share/firewall4/` → rule.uc/ruleset.uc emit 0
  UC1001 for injected names (matches the editor).
- CLI: `--type-coverage` over the firewall4 tree → `fw4`/`rule`/`zone` hover as
  `(render scope) … : \`unknown\`` (or better), not no-hover.
- Server hover on `fw4` in `templates/rule.uc` → render-scope hover with includer attribution.
- zone-notrack.uc (open-world) unchanged: UC1001 stays (sound), hover may still explain
  "template free variable — no include() site found in the workspace" as a UX nicety.

## Classification

**Partially solvable.** 1,176 occurrences: hover-presence fully solvable (items 1–2); full
typing gated on user-module shape inference (item 3). The further 209 open-world occurrences
are un-solvable automatically by prior decision (config/directive escape hatch possible).
