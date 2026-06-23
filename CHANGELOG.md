# Changelog

## 0.7.2 (2026-06-23)

Everything since the last release (`v0.6.254`). The headline is end-to-end ucode **template
mode** support; alongside it, function-level incremental analysis, a builtin/module
return-type correctness pass, several type-inference and null-safety fixes, and a
test-infrastructure overhaul.

### ucode template mode (`{% %}` / `{{ }}` / `{# #}`) — now supported end-to-end

ucode's native default is *template* mode (the `utpl` binary / `ucode -T`), and OpenWrt ships
flagship codebases — firewall4's ruleset generator, luci, snort3 — entirely as ucode
templates. Previously the LSP forced raw mode on every file and produced hundreds of false
diagnostics per template (a UC6004 syntax-error storm plus a UC1001 storm on every
interpolated variable). Templates now lex, parse, and type-check, and the diagnostics that
fire match the ucode interpreter (oracle-verified against 22.03 / 23.05 / 24.10 / 25.12 /
main). This is the reason for the minor-version bump.

- **Mode detection** (`detectTemplateMode`): replicates ucode's invocation-determined rule
  from what the file carries — shebang (`utpl` / `ucode -T` ⇒ template; `-R` ⇒ raw), else a
  leading/embedded `{%` / `{{` / `{#` tag (scanned after blanking strings & comments, so a
  tag-looking sequence inside a string no longer flips the file to template mode).
- **Lexer**: tokenizes templates (was bailing to 0 tokens when a file started with a tag),
  handles the whitespace-trim OPEN modifiers `{%-` / `{%+` / `{{-` / `{#-` and CLOSE
  modifiers `-%}` / `-}}`, and preserves EOF when a file ends on a tag.
- **Parser**: a token bridge maps template framing to statement boundaries so the existing
  parser consumes templates (`{{a}}{{b}}` → `a; b;`); the alt-colon block form
  (`{% if (x): %}…{% elif %}…{% else %}…{% endif %}`, `for`/`endfor`, `while`/`endwhile`) is
  handled.
- **Render-scope enforcement & typing** — `include(path, { scope })` co-locates a literal
  path and a literal scope object, so the render contract is statically knowable. The
  cross-file include index resolves each include (path relative to the includer, per the
  oracle) and **suppresses UC1001 for injected render-scope names** (in strict too), while
  still flagging a free variable the scope fails to provide — reported at the include SITE.
  Injected names take the **type** of their scope value (literals, `require("mod")` module
  types, transitively-resolved identifiers), and the index is a **fixpoint**: injected scope
  leaks transitively into nested includes, so a strict grandchild sees a var its parent's
  site omitted.
- **`'use strict'` in templates** — honored only when the `{% 'use strict'; … %}` block is the
  first statement; leading text / `{{ }}` / even leading whitespace compiles to a `print()`
  and makes the directive inert (the same directive-must-be-first rule as raw ucode).
  `detectStrictMode` is template-aware to match.
- **Parity hardening (what ucode rejects, we reject)** — UC1001 severity tracks strict mode
  (Error under `'use strict'`, Warning otherwise, always reported); invalid close modifiers
  `+%}` / `+}}` rejected; nested blocks rejected; unterminated `{{`/`{#` blocks rejected
  (a statement block may still run to EOF); `{{+` is unary plus, not a trim modifier; empty
  `{{ }}` rejected while `{% %}` / `{# #}` may be empty.

The one remaining open item is template-text **syntax highlighting** (a `//` in template text
is literal output, not a comment); the static TextMate grammar can't be mode-aware, so the fix
is an LSP semantic-tokens provider, scoped in `docs/semantic-tokens-template-highlighting.md`.

### Function-level incremental analysis

The analyzer no longer re-type-checks the whole document on every keystroke. It now skips
function bodies that are unchanged since the previous run, restoring their cached diagnostics
and types instead of re-deriving them. Skipping is **soundness-gated by a semantic
fingerprint**: if any unit's externally-visible signature moves (its return type, its
returned-object shape, or the `this.<prop>` types it writes), the run transparently falls
back to a full re-analysis, so a skipped reader can never observe a stale sibling.

**On performance, honestly:** the concrete, defensible, measured win is **~32% on the
worst case** — firewall4's ruleset generator (`fw4.uc`), 540ms → 367ms — and that gain comes
specifically from **caching structural guard collection**, not from the body-skip alone. The
body-skip avoids redundant type-checking on untouched functions, but the speedup it delivers
depends entirely on edit locality and file size; it is not captured by any single multiplier,
and we don't claim one. Large files also get an **adaptive analysis debounce** so typing stays
responsive.

- **Cross-file soundness fix:** when an imported module changes, its open *and* closed
  dependents are now force-re-analyzed in full. Previously a dependent could replay
  diagnostics against the import's stale exports — a silent false negative. Backed by 106
  incremental-soundness tests (same-file pure-replay + real-server cross-file).

### Type inference

- **Object-literal method calls resolve their return type** — `obj.method()` and
  `this.method()` on a local object literal now infer the method's return type instead of
  `unknown` (which previously poisoned everything derived from the result, e.g. fw4.uc's
  `let rv = this.parse_invert(val)`). A method returning a bare parameter stays `unknown` (no
  over-claiming).
- **Method forward-references + go-to-definition** — a `this.method()` / `obj.method()` call
  now resolves even when the method is defined later in the object, and go-to-definition lands
  on the sibling method.
- **Flow-sensitive member-property types** — a member's type reflects the most recent
  assignment *at the read position*, not one type for all positions; hover is suppressed inside
  comments.
- **fs object handles flow on reassignment, with nullability preserved** — `let b; b = open(…)`
  now types `b` as the handle instead of dropping it to `unknown` (a regression from the 0.6.27
  inferXType-cascade removal). Separately, the object-handle factories
  (`open`/`popen`/`mkstemp`/`fdopen`/`opendir`/…) now keep their runtime `| null` instead of
  collapsing to a bare non-null handle — a latent false negative present since fs typing was
  first added. So `open(path).read()` with no guard is flagged (UC5006), and a truthiness guard
  or `?.` clears it; this aligns the fs builtin path with the io module (already
  `io.handle | null`).

### Builtin & module return-type correctness (triage clusters C3 + C2)

Type/signature corrections to existing functions; the version-gating registry
(`ucodeVersions.ts`) still gates availability, so these refinements only take effect where the
function is available.

- **fs handle reads** — `fs.file`/`fs.proc`/`fs.dir` `read(...)` are `string | null`; the
  `null` is the error signal and, for `dir.read()`, the end-of-directory terminator, so the
  canonical `while ((line = fh.read('line')))` idiom type-checks correctly. The scalar handle
  methods (`tell`/`seek`/`truncate`/`lock`/`isatty`/`flush`/`fileno`/`write`) carry their
  `| null` error path too.
- **stat() / lstat()** return a fixed-shape `fs.stat` object instead of a bare `object`
  (`size`/`mtime` integer, `type` string, nested `dev`/`perm` shapes modeled; unknown fields
  flagged). **math transcendentals** (`pow`/`sqrt`/`sin`/`cos`/`exp`/`log`/`atan2`) return
  `double`, not `integer`. **writefile()** corrected to `writefile(path, data: any,
  size?: integer)` (third arg is a byte limit, not a mode). `zlib` stream `write()` is
  `boolean | null`; several `uloop` object methods carry `| null` on the stale-handle path;
  `socket.pair()` is `array<socket> | null` and `io.pipe()` is `array<io.handle> | null`.
- **Argument over-strictness relaxed** — valid calls no longer hard-error: `exists()` never
  throws (mismatch downgraded to a warning); `proto(x)` query form tolerates any value;
  `uniq`/`iptoarr`/`arrtoip`/`b64dec` return `null` on a wrong-typed arg (warning, not error);
  `rindex` accepts a string **or** array haystack. Calling a defined-but-non-callable value
  reports `'x' is not a function (it is of type …)` and respects flow-narrowing of the callee.
- **Chained / indexed member resolution** — a member whose receiver is itself an expression
  resolves against the object-type registry: nested `info.dev.major`, indexed
  `pair()[0].recv()`, and call chains `open().read()`. Array index access preserves the rich
  element type (`array<socket>[i]` → `socket | null`), and hover walks the same chain.

### Diagnostics

- **UC5005 false positive fixed** — a variable typed exactly `null` (e.g. a module-level
  `let ctx;` assigned only from another function) now narrows to non-null after an
  `if (!ctx) return;` early-exit guard, so a guarded member access is no longer wrongly flagged
  as a null dereference. Sound-gated: an intervening reassignment to null still flags.

### Test infrastructure & soundness

- The mocha/bun test bridge is now **auto-discovering** (opt-out quarantine instead of
  hand-maintained registration lists), and the **quarantine is burned down to zero** (31
  triaged → 30 deleted, 1 fixed).
- `tests/` reorganized from **456 flat files into 11 feature directories** plus `fixtures/`
  and `scratch/`.
- Several **server-driven coverage** passes targeting the lowest-covered files, and removal of
  dead code (`fsTypeRegistry`, unused incremental helpers).

### Build

- Bundling switched from `ts-loader` to **`esbuild-loader`** (~2.7× faster builds, smaller
  output), and the no-cost strict `tsconfig` flags were enabled.

## 0.6.183 – 0.6.254 (2026-06-08 → 2026-06-19)

A large accuracy-and-completeness pass: OpenWrt version-aware diagnostics, a
deep null-safety tier, a wave of false-positive eliminations for real-world
ucode idioms (implicit globals, builtin shadowing, template/raw-mode lexing),
a completion-and-quick-fix overhaul, and crash hardening. Every diagnostic now
carries a stable `UC####` code. Highlights below, grouped by area; exact version
tags in parentheses.

### New features

- **Target-version-aware diagnostics** — a new `ucode.targetVersion` setting
  gates module, function, and method availability to a chosen OpenWrt release
  (0.6.222, `UC6005`). Added the **OpenWrt 25.12** target and default to the
  latest stable release (0.6.223). Version gates were source-cross-checked
  across the 22.03 → 23.05 → 24.10 → 25.12 line: the `io` module import
  (0.6.224); `fs.mkdtemp`/`dup2` and `socket.open`/`pair` (0.6.225); 24.10 vs
  25.12 reconciliation (0.6.226); 23.05 → 24.10 module/function additions
  (0.6.227); object-handle methods added in 24.10 such as `fs.file.ioctl` and
  `uci.cursor.list_*` (0.6.228); and 22.03 → 23.05 additions (0.6.229).
- **Stable diagnostic codes** — every diagnostic now emits a stable `UC####`
  code (0.6.245), with unified argument-validation wording across checkers
  (0.6.246).
- **Quick fixes for null member access** — optional-chaining and null-guard fixes
  for possibly-null member access (0.6.210); a `uc()`/`lc()` coerce fix on a
  non-string argument (0.6.250); and the `UC3006` add-import fix no longer leaves
  the call broken behind it (0.6.243).

### Null safety

- A new possibly-null member-access tier: flag member access on a provably-null
  value (0.6.205, Tier 1), warn on possibly-null `T | null` access (0.6.208,
  Tier 2), and escalate Tier 2 to an **error** under `'use strict';` (0.6.209).
- An uninitialized `let` is now typed as `null` rather than `unknown` (0.6.204),
  and most-recent type wins for member access so reassignment-to-null is caught
  (0.6.206), with a write-aware message for property assignment on a null value
  (0.6.207).
- `object | array` union member access is recognized as valid (0.6.211) and
  treated as "possibly array" — a warning, an error under strict, never silent
  (0.6.212).

### Type-inference fixes

- Return types are inferred for function-valued variables, e.g. `let f = () => …`
  and `let f = function(){…}` (0.6.193), and such variables now argument-check
  their call sites against `@param` JSDoc (0.6.216).
- `for…in` element type is union-aware: `array<T> | null` yields `T`, not
  `unknown` (0.6.189); the subject is narrowed inside `while`/`for` loop bodies
  (0.6.219).
- `require("builtin")` is generically typed as that module (0.6.185);
  `REQUIRE_SEARCH_PATH` is typed `array<string>` (0.6.187).
- `render()` is modeled as an overloaded builtin — string-template vs function
  form (0.6.214).
- `@param` JSDoc on an object-literal property function is now applied (0.6.190);
  `@returns` is reconciled against the inferred return type with a quick fix, and
  a JSDoc adjacency bug was fixed (0.6.234).

### False-positive eliminations

- **Implicit globals** — provable implicit globals are no longer flagged `UC1001`
  in non-strict mode (0.6.183), plus four more non-strict downgrades so
  strict-only ucode errors stop firing in non-strict code (0.6.184).
- **Builtin shadowing** — a `let`/`const` (0.6.199), a function declaration
  (0.6.198), or an import (0.6.197) may shadow a builtin; the local wins
  resolution and hover.
- **Global-property functions** — `global.X = fn` is callable bare as `X()` with
  no false "Undefined function" (0.6.194), with hover for `global.X` property
  names (0.6.195).
- **Raw-mode lexing** — the raw-mode lexer no longer treats `}}`/`{{`/`%}` as
  template tags (0.6.196).
- `return expr` without a `;` before `}` is no longer a false `UC6004` (0.6.188);
  the comma operator is accepted in `if`/`while`/`switch` conditions (0.6.203);
  `in` is null-safe over anything (0.6.213). A broader false-positive cluster
  plus use-before-declaration, object-spread property types, and `default`-
  specifier grammar were fixed (0.6.232).
- `loadfile`/`loadstring` accept the optional `ParseConfig` options argument with
  autocomplete (0.6.191) and validate its property values (0.6.192).

### True positives caught

- `const` reassignment is now flagged (0.6.202, `UC1010`) — previously silent.
- Three more silent false-negatives caught: function redeclaration,
  `delete arr[i]`, and a bad export (0.6.220).
- Module surfaces corrected: `import * as socket` resolves the socket **module**
  (0.6.200), the `ubus` namespace exposes its connection functions (0.6.201), and
  import/export resolution was made faithful to ucode semantics (0.6.221).

### Completion

- Completion cluster (0.6.237): nested members, optional chaining, the `const`
  namespace, and named-import paths. The member-completion path now resolves the
  dot before the cursor (0.6.241), treats `?.` like `.` across all
  member-detection sites (0.6.239), and lexes reserved words after `?.` as
  property names, e.g. `o?.const` (0.6.238).
- `nl80211`/`rtnl` constants are no longer offered as top-level imports (0.6.240).
- Completion is suppressed in strings and comments and after a malformed
  member-access dot, with `this.` member completion added (0.6.242, 0.6.244).
- Completion polish: constant item kind and builtin signature detail (0.6.248).

### Builtin argument validation

- Rewrote the `printf`/`sprintf` format validator (0.6.249, 7 findings).
- `match()` argument validation — subject coerces, a string pattern errors
  (0.6.251); `localtime`/`gmtime` numeric coercion and `hexenc` string coercion
  (0.6.252); a builtin arity/coercion pass with zero-arg null narrowing and
  reassignment flow-typing (0.6.253); a zero-arg builtin audit plus `int()`
  literal/base narrowing (0.6.254, `UC2013`).
- `UC2008`/`UC2009` now report as an `Error` in both modes, not strict-gated
  (0.6.247).

### Stability

- Deep expression nesting no longer crashes the server (0.6.235), and the
  feature-provider handlers are contained against a real editor crash (0.6.236).
- The type-guard quick-fix machinery was rewritten to be AST-node-driven, fixing
  comment/literal edge cases (0.6.218).

### Performance

- Workspace-scan perf: an async, non-blocking directory walk plus an
  mtime-cached shebang peek so re-walks reuse the verdict (0.6.186).

### Internal / packaging

- Scoped `bun test` discovery to `tests/`; trimmed the VSIX (dropped
  `dist/cli.js` and excluded vendored trees); stopped committing demo/spot-check
  `.uc` files and `coverage-reports/`.

## 0.6.32 – 0.6.58 (2026-05-21 → 2026-05-25)

A large batch of type-inference accuracy fixes, new IDE features (member
completion, JSDoc quick-fix, rich exception hover), and a major test/coverage
hardening pass. Highlights below, grouped by area; exact version tags in
parentheses.

### New features

- **Member completion for object values** — typing `obj.` now lists the object's
  own properties for object literals, `catch` parameters, and function-local
  objects (0.6.54); named-imported object values, e.g. `import { CONF }; CONF.`
  (0.6.55); objects returned by an imported *named* factory, e.g.
  `import { make }; let o = make(); o.` (0.6.56); and direct factory call chains
  `make().` with no intermediate variable (0.6.57).
- **JSDoc inference quick-fix** (0.6.32) — offers to add a `/** @param */` block
  with parameter types **inferred from body usage** (e.g. `substr(x)` → `string`,
  `push(x)` → `array`), instead of `{unknown}` stubs.
- **Rich hover for exception properties** (0.6.58) — hovering `e.stacktrace` /
  `e.message` on a `catch` parameter now shows the detailed doc, including the
  stacktrace frame structure (`filename`, `line`, `byte`, optional
  `function`/`context`).
- **NaN-producing arithmetic lint** (0.6.48, UC2008) — flags arithmetic that
  provably evaluates to NaN (an `array`/`object`/`function`/`regex` operand, e.g.
  `arr - 1`, `-[1]`, `obj * 2`); escalates from a warning to an **error** under
  `'use strict';` (0.6.49).

### Type-inference fixes

- Division/modulo by `null` now infers `double`, not `integer` (0.6.40).
- Arithmetic over union types distributes across members instead of collapsing
  to a single type (0.6.41); real unions from function return values now
  propagate into arithmetic and logical expressions (0.6.43).
- Logical `||` / `&&` recognize `array<T>`, `object`, and module operands as
  truthy (0.6.42).
- Consolidated all arithmetic onto a single implementation and fixed an
  exponentiation (`**`) inference gap (0.6.44).
- Fixed `||` type-guard narrowing for refined union members — a regression where
  narrowing dropped already-refined members (0.6.45), plus defensive hardening of
  the remaining union comparison sites (0.6.46).
- Corrected unary-operator type inference (0.6.48).
- String-literal arithmetic operands are now classified as `int` vs `double`
  based on their contents (0.6.51).

### Hover

- Resolves namespace-import members (`import * as U`; hover `U.foo`) (0.6.34).
- Resolves object-property and imported-name hovers via the AST, replacing the
  old regex source-scraping (0.6.35) — more accurate and robust to comments,
  strings, and renames.
- Fixed broken hover on regex literals (0.6.50).

### Go to definition

- Follows re-export chains (`export { x } from './a'`) and resolves
  namespace-import members (0.6.33).
- No longer returns a bogus `builtin://…` location for builtin-module imports
  such as `import { open } from 'fs'` — these correctly report "no definition"
  (0.6.52).
- Resolves imported *variables* (not just functions) to their precise declaration
  line (0.6.53).

### Completion

- Lists a user module's exports via the AST, fixing renamed imports and exports
  hidden by comments or strings (0.6.36); reads exports from the cached AST with
  correct path resolution and freshness (0.6.37).

### Cross-file resolution

- Content-based file cache fixes stale results from mtime collisions (0.6.38).
- Import resolution now reads the live (unsaved) editor buffer instead of stale
  on-disk content (0.6.39).

### Internal / refactoring

- Removed the dead CFG dataflow/type-state pipeline and a scope-blind CFG
  type-query fallback; flow-sensitive typing lives solely in the type checker.
  The CFG is now used only for unreachable-code detection.
- Removed ~28 dead exported helpers and superseded object-type registries
  (verified zero references); pruned dead `regexTypes`/`typeCompatibility` code.

### Tooling

- Added `coverage:e2e` — end-to-end V8 coverage of the spawned LSP server,
  remapped to `src/` (later updated to run **both** test systems, not just the
  curated runner) (0.6.47).

### Tests

- Extensive end-to-end test additions driving the real server over stdio:
  go-to-definition (all import-resolution styles + reachable edge branches),
  hover (namespace/object/exception), completion contexts and cross-file member
  completion, lexer/parser edge cases, and the file resolver.
- A correctness-focused **quick-fix edge-case suite** that applies each fix's
  edits and re-analyzes to confirm the patched code is well-formed and the
  diagnostic is actually resolved — across one-liner functions, braceless bodies
  (with/without `else`), loops, conditions, nested-call and member-path guards,
  union tightening, `||` fallbacks, scoping safety, and CRLF.
- Raw-protocol server lifecycle/workspace coverage (initialize variants,
  workspace-folder and watched-file change handlers).
