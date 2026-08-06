# LuCI template/controller runtime: ambient scope + template include resolution

Status: **SHIPPED at 0.8.0 (2026-08-04, uncommitted — awaiting user test). All four
parts built, plus follow-ons the corpus differential surfaced.** Implementation map:

- **Part 0** re-landed verbatim (package.json languages/grammars/activationEvents/
  configurationDefaults, syntaxes/ucode-template.tmLanguage.json, extension.ts
  documentSelector + `**/*.{uc,ut}` watcher; tests/syntax/test-tmgrammar-template.test.js
  reconstructed, 8 tests). `.ut` counts as a workspace source file now (shebang.ts).
- **Parts A–C** live in `src/analysis/luciEnv.ts` (workspace sniff: checkout via
  modules/luci-base/ucode/dispatcher.uc, deployed via dispatcher+runtime+template/ in one
  dir — with the "luci-base/ucode IS deployed-shaped" disambiguation; template roots =
  every package ucode/ dir's template/, luci-base first; `resolveLuciTemplatePath`,
  `resolveLuciTemplatePattern` for `themes/*/…` template-literal paths,
  `resolveLuciModulePath` for `luci.*` dotted imports), `src/analysis/luciTypes.ts`
  (LUCI_ENV_GLOBALS incl. post-construction env members dispatched/requested/media_error/
  lua_active; `luci.http` + `luci.dispatcher` openMembers object registries),
  `SemanticAnalyzer.detectAndDeclareLuciEnv`, fileResolver (template-first include
  resolution + `luci.*` import/require + template-mode parsing of targets),
  includeScope.ts (render()/`.render()` sites, template-literal → `*` patterns,
  identifier paths via agreeing declarators, identifier SCOPES mined through declarator
  inits/member assigns/call sites + ONE callback hop, bare includes as leak edges),
  server.ts (index hooks + checkIncludeScopes skip for template-root/render/pattern
  sites; include() document links via fileResolver.resolveIncludeTarget).
- **Follow-ons from the differential:** `.ut` ⇒ template mode even with no tag
  (detectTemplateModeForFile — pure-HTML templates are legal utpl); fw4's 43 false
  "include target could not be parsed" errors died with template-mode target parsing;
  `import { default as X }` validates against the default export (incl. the
  `export { a as default }` form); strict-mode `if (length(maybe-null))` emptiness
  tests are no longer errors (tolerated-type + truthiness + test-idiom gate).
- **Numbers:** corpus differential glinet −8/+0, firewall4 −45/+0, luci .uc −80/+0;
  luci .ut tree-wide UC1001s 71 → 13. Suite 4,058/0 + validations;
  tests/diagnostics/test-luci-template-runtime.test.js = 40 tests.
- **Follow-up round (2026-08-05, from user demo feedback):** UC6020 — a `{# … #}`
  comment that closes at its first `#}` while another terminator sits in the trailing
  literal text warns on the stray terminator (the tail is page output; oracle-verified;
  0 hits across 126 real corpus files). Go-to-definition: template-mode token positions
  in `.ut` files (was raw-lexed), `include('name')` paths resolve via template roots,
  `luci.http`/`luci.dispatcher` members jump into luci-base's own http.uc/dispatcher.uc
  (AST-based member locator), and synthetic ambient symbols no longer fabricate a
  row-1 col-1 definition.
- **Standalone packages (2026-08-05, evidence from real repos):** out-of-tree LuCI
  packages are detected by their package-root Makefile (`LUCI_TITLE` + `include
  …luci.mk` — the convention of jerrykuku/luci-theme-argon, sbwml/luci-app-bluetooth,
  and luci.mk itself; feed repos nest `applications/<pkg>/`). `LuciWorkspace` gained
  kind `'package'`: the package's `ucode/` dir is a template root and `luci.*` slice
  (it installs to `/usr/share/ucode/luci`, luci.mk:86), the env ambient activates for
  its templates/controllers, and a suppression floor stops absence claims we can't
  prove — unresolvable `luci.*` imports (silent in ANY LuCI tree: luci.core is
  compiled C, luci.version is build-generated) and template-style include not-found
  (package kind only — the on-device template dir is merged from all installed
  packages). `LUCI_TEMPLATE_RENDER_COMPAT_NAMES` (node/css/duser/fuser/auth_*/
  trigger_*/rollback_token/https_port) are UC1001-suppressed in `.ut` templates only
  (controllers keep full typo detection). Validation: a fresh clone of the real
  argon theme analyzes with ZERO undefined-variable FPs; the former in-tree floor is
  now 0 UC1001s tree-wide.
- **Container validation (2026-08-05):** installed luci via opkg/apk in the
  owrt-{2305,2410,2512} containers and analyzed the extracted `/usr/share/ucode/luci`
  trees — identical layout on all three releases, and `version.uc` exists deployed
  (confirming the checkout-side suppression). The real rootfs exposed four bugs, all
  fixed: deployed/nested controller paths missed by the env gate; file-wide
  self-declared checking (a nested `for (let config in …)` loop-local killed the env
  `config` ambient — controller/admin/uci.uc); missing-`.ut` includes with a Lua-view
  fallback (`luasrc/view/<name>.htm`, the admin_status/luaindex case) falsely flagged;
  and shadow warnings on locals named like ambient globals. All three deployed trees
  now analyze with 0 undefined names and 0 spurious not-founds.
- **Known residual:** honest null-safety warnings only (e.g. `cursor()`/`ubus.call`
  results used unguarded in themes, `json(http.content())` inside a try) — true
  positives per the uci/ubus/http typings.

Original investigation below (2026-08-03, all evidence lines cited). Successor-in-spirit
to the uhttpd/hostapd/netifd ambient work; the injection MECHANISM is the
call-scope-injection family (docs/call-scope-injection.md).

## How the runtime actually works (evidence)

1. **Env scope, shared by ALL LuCI templates and controllers.**
   dispatcher.uc:896-922 builds `LuCIRuntime({ http, ubus, uci, ctx, version,
   config, dispatcher: {...}, striptags, entityencode, _: fn, N_: fn })`;
   runtime.uc:153 chains it onto global: `scopes: [ proto(env, global) ]`.
   So `_()` (translate-with-fallback), `N_()`, `entityencode()`, `striptags()`,
   `http`, `ubus`, `uci`, `ctx`, `version`, `config`, `dispatcher` are ambient
   in every template AND controller (luci-app-commands/ucode/controller/
   commands.uc:203 uses bare `http`).

2. **Per-render scope, template-specific.** runtime.uc:121
   `scope = proto(scope ?? {}, this.scopes[-1])`; templates run via
   `call(tmplfunc, null, scope)` (runtime.uc:74-81 — the call-scope-injection
   mechanism, literally). The commands_public.ut vars come from
   luci-app-commands/ucode/controller/commands.uc:214:
   `include('commands_public', result)` where result carries
   `exitcode`/`stdout`/`stderr`.

3. **Template include/render resolution is ROOT-based, not file-relative.**
   runtime.uc:7 `template_directory = '/usr/share/ucode/luci/template'`;
   render_any resolves `${template_directory}/${path}.ut`. In-repo mirror
   roots: `*/ucode/template/` (luci-base has header.ut/footer.ut there;
   themes install to `.../ucode/template/themes/<name>/...`; apps to their own
   `ucode/template/`). So `include('header', ...)` from
   applications/luci-app-commands/ucode/template/commands_public.ut resolves
   to modules/luci-base/ucode/template/header.ut — UC3002's "resolved relative
   to this file" is the wrong model here.

## Diagnostics this explains (commands_public.ut, all repro'd)

- UC1002 `_` ×4, `entityencode` ×2 → env scope (part 1).
- UC1001 `exitcode`/`stdout`/`stderr` → per-render scope (part 2).
- UC3002 'header'/'footer' → root-based resolution (part 3).
- sprintf-arg-unknown → downstream of `_` being untyped; typing `_` as
  `(...args) => string` clears it.

## Build shape (four parts, ship in this order)

**Part 0. `.ut` language registration + wrapper grammar (BUILT 2026-08-03,
then reverted from the tree at user request — the full implementation is
preserved below, tested 7/7 green + full suite 3846/0, ready to re-land
verbatim when this ticket is picked up).**

Registration (package.json `contributes`):
- `languages` gains:
  ```json
  {
    "id": "ucode-template",
    "aliases": ["ucode Template", "utpl"],
    "extensions": [".ut"],
    "firstLine": "^#!.*\\butpl\\b",
    "configuration": "./language-configuration.json",
    "mimetypes": ["text/x-ucode-template"]
  }
  ```
- `grammars` gains:
  ```json
  {
    "language": "ucode-template",
    "scopeName": "source.ucode-template",
    "path": "./syntaxes/ucode-template.tmLanguage.json",
    "embeddedLanguages": { "meta.embedded.block.ucode": "ucode" }
  }
  ```
- `activationEvents` gains `"onLanguage:ucode-template"`; `configurationDefaults`
  gains a `"[ucode-template]"` quickSuggestions block mirroring `"[ucode]"`.
- src/extension.ts documentSelector gains
  `{ scheme: 'file', language: 'ucode-template' }`.
- The server needs NO changes: template detection is content-based
  (detectTemplateMode + bridgeTemplateTokens, server.ts:681) and there is no
  languageId filtering anywhere server-side.
- Deploy note: these are CLIENT-side pieces — the installed extension needs
  package.json + dist/extension.js + the new grammar copied (server.js alone
  doesn't carry them), then a full window reload.
- Workspace scan stays `.uc`-only until parts A-C land (otherwise every LuCI
  checkout sprays the UC1002s this ticket exists to fix).

syntaxes/ucode-template.tmLanguage.json (verbatim; tag forms incl. the
`[-+]` trim modifiers verified against ucode's lexer.c template scanner —
a `%}` inside an embedded ucode string correctly does NOT close the block
because the inner string scope blocks the outer end):
```json
{
  "$schema": "https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json",
  "name": "ucode Template",
  "scopeName": "source.ucode-template",
  "patterns": [
    {
      "name": "comment.block.ucode-template",
      "begin": "\\{#-?",
      "end": "-?#\\}",
      "beginCaptures": { "0": { "name": "punctuation.definition.comment.begin.ucode-template" } },
      "endCaptures": { "0": { "name": "punctuation.definition.comment.end.ucode-template" } }
    },
    {
      "contentName": "meta.embedded.block.ucode",
      "begin": "\\{\\{-?",
      "end": "-?\\}\\}",
      "beginCaptures": { "0": { "name": "punctuation.section.embedded.begin.ucode-template" } },
      "endCaptures": { "0": { "name": "punctuation.section.embedded.end.ucode-template" } },
      "patterns": [ { "include": "source.ucode" } ]
    },
    {
      "contentName": "meta.embedded.block.ucode",
      "begin": "\\{%[+-]?",
      "end": "-?%\\}",
      "beginCaptures": { "0": { "name": "punctuation.section.embedded.begin.ucode-template" } },
      "endCaptures": { "0": { "name": "punctuation.section.embedded.end.ucode-template" } },
      "patterns": [ { "include": "source.ucode" } ]
    },
    {
      "include": "text.html.basic"
    }
  ]
}
```

Grammar test suite (tests/syntax/test-tmgrammar-template.test.js, 7 tests, all
passed pre-revert): registry loadGrammar serving source.ucode-template +
source.ucode (text.html.basic → null is fine, plain text); per-line scope maps
asserting — HTML stays plain around a statement block; multi-line `{% ... %}`
stays embedded until the closer; `{{ expr }}` embeds; `{%-`/`{%+`/`-%}` and
`{{-`/`-}}` modifiers are part of the tags; `{# ... #}` comment spans lines
(and `{%` inside it stays comment); a regex literal inside a block gets
string.regexp.ucode (real delegation); `{% let s = "100%}"; %}` ends at the
REAL closer. Reconstruct from the harness pattern in
test-tmgrammar-multiline-regex.test.js if the file isn't resurrected from
this session's history.

## Original three runtime parts

**A. LuCI env ambient (biggest win, smallest risk).** Detection: file is
`ucode-template` language (.ut) OR lives under a `*/ucode/` tree in a
workspace that has luci-base's dispatcher.uc (mirror-root sniff — same
philosophy as isUhttpdHandler's content gate, but path/workspace-based).
Declare the env names with types read from dispatcher.uc's construction:
`_`/`N_` as variadic → string, `entityencode`/`striptags` from the html
module, `http`/`ubus`/`uci` as their known object types where registries
exist, `ctx`/`config`/`dispatcher` as object shapes. Follow the
hostapd/netifd recipe (usage+context-gated ambient; openMembers for the
loosely-shaped ones).

**B. Template include/render resolution roots.** Teach UC3002/include
resolution (and go-to-definition) the `*/ucode/template/` mirror-root
convention: resolve `include('name')` against every workspace
`ucode/template/` root (+ deploy-layout precedent from 0.7.69's module
roots). Themes complicate exact-match ('header' has both a luci-base shim
and per-theme copies) — resolving to ANY root hit silences the FP and gives
a definition target; multiple hits = first match by root priority
(luci-base, then app, then themes).

**C. Per-render scope inference (the tail).** For a template
`ucode/template/<name>.ut`, find workspace call sites
`include('<name>', SCOPE)` / `render('<name>', SCOPE)` and union SCOPE's
object shape into the template's ambient scope (evidence:
commands.uc:214 → exitcode/stdout/stderr with real types). Falls back to
the .ucode-lsp.json scope-provider association (docs/call-scope-injection.md)
for scopes the walk can't see. This is cross-file, cache-invalidation-aware
work — ship A+B first.

## Tests (when built)

commands_public.ut clean of the listed FPs; `_`/`entityencode` typed (sprintf
arg warning gone); include('header') resolves + go-to-def lands in luci-base;
a NON-luci .ut (no dispatcher.uc in workspace) keeps plain behavior — the
ambient must not leak outside LuCI workspaces; controller commands.uc bare
`http` clean under detection, still flagged outside it.
