# Connecting `call(fn, ctx, scope)`-injected leaf scripts to their scope provider

Status: **investigated, design proposed, not implemented.** The "hard one."
Verified vs `/usr/local/bin/ucode`. Date: 2026-06-08.
Corpus: `packages/utils/prometheus-node-exporter-ucode/` (metrics.uc + base/*.uc + extra/*.uc).

## The architecture (how the files actually connect)

`metrics.uc` is the entry point. The `base/*.uc` and `extra/*.uc` "collector" scripts have
**no import/include/syntactic link** to it. The binding is purely runtime:

```js
// metrics.uc — inside handle_request():
let scope = {                              // (1) the ambient API the leaves get
    config: null, fs, ubus: connect(),
    counter, gauge,
    wsplit:   function(line) { return split(line, /\s+/); },
    nextline: function(f)    { return rtrim(f.read("line"), "\n"); },
    oneline:  function(fn)   { let f = fs.open(fn); return f ? nextline(f) : null; },
    poneline: function(cmd)  { ... },
};
...
ok = call(collectors[col].func, null, scope) != false;   // (3) inject scope into the leaf

// metrics.uc — module scope:
let cols = fs.lsdir(lib, "*.uc");          // (2) discover leaf files by directory glob
for (let col in cols) {
    func = loadfile(lib + "/" + col, opts);  // compile leaf → entry function
    collectors[name] = { func, config };
}
```

A leaf (`base/loadavg.uc`) is just:

```js
const x = wsplit(oneline("/proc/loadavg"));   // wsplit, oneline = injected scope members
if (length(x) < 3) return false;              // top-level return = exit the entry function
gauge("node_load1")(null, x[0]);              // gauge = injected
```

### Verified semantics (vs interpreter)

- `call(fn, this, scope, ...args)` — the **3rd arg becomes the global scope** for free-variable
  resolution inside `fn`. Builtins (`length`, `split`, …) still resolve (scope layers over the
  real globals, doesn't replace them). Top-level `return` in the loaded file returns from the
  entry function. The LSP already documents this (`builtins.ts:54`: 3rd arg = "Global
  environment object") and validates it as `OBJECT|NULL` — it just never *uses* it.
- `loadfile(path, opts)` with `opts = { strict_declarations:true, raw_mode:true }` compiles the
  leaf. `strict_declarations` means that, run standalone, every injected free var would be an
  error — i.e. **these files are designed to run only inside an injected scope.**

### Two ground-truth facts

1. **The leaf free-variable surface == the scope members, exactly.** A grep of all free
   globals across every `base/`+`extra/` file yields precisely the 9 scope keys, nothing else:
   `gauge`(63) `counter`(34) `oneline`(19) `fs`(9) `wsplit`(8) `nextline`(6) `ubus`(5)
   `config`(3) `poneline`(1). 100% coverage. (This becomes a *self-validating* association
   signal — see Layer 2a.)
2. **The workspace→runtime path map lives in the Makefile, not in any ucode source.**
   `files/base/*.uc` AND `files/extra/<name>.uc` both install flat into
   `/usr/share/ucode/node-exporter/lib/`, which is the `lib` the parent globs. So
   `fs.lsdir("/usr/share/ucode/node-exporter/lib")` resolves to `base/ ∪ extra/` only via the
   install rules.

### Current (broken) baseline

Every leaf is a storm of false `Undefined function` / undefined-variable errors
(`loadavg.uc`: 5 — `wsplit`, `oneline`, `gauge`×3), because the injected scope is invisible.

## Problem decomposition

To type `gauge("node_load1")(null, x[0])` inside a leaf, the LSP needs three things; they are
NOT equally hard:

| Sub-problem | Tractability |
|---|---|
| **A. Scope SHAPE** — the members + types of `scope` | **Fully solvable, automatically** (it's an object literal) |
| **B. INJECTION** — seed the leaf's scope + suppress strict undefined errors | Mechanically easy |
| **C. ASSOCIATION** — which leaf files receive which scope | **Not soundly automatic** (dynamic glob over an absolute runtime path; map is in the Makefile) |

The honest "likely no resolution" is **C only**. The trick is to **auto-derive the expensive
part (A) and make declaring C nearly free** — instead of trying to brute-force C.

## Proposed solution — three layers

### Layer 1 — Automatic "scope provider" model (the reusable engine)

Detect the idiom in any workspace file: a value that flows
`loadfile(_, _) → F … call(F, _, S)` where `S` is (or data-flows to) an **object literal**.
From `S`, build an **AmbientScope descriptor** `{ member → type }`, reusing the LSP's existing
object-literal property typing + function-expression signature inference:

- `gauge`/`counter` → `function(name, help?, skipdecl?) → (function(labels, value) → func)`
  (already in-scope, fully typed symbols in metrics.uc);
- `fs` → fs module; `ubus` → `ubus.connection` (from `connect()`);
- `wsplit`/`nextline`/`oneline`/`poneline` → signatures from their inline function expressions;
- `config` → `object | null`.

For this corpus the `call(...)` (metrics.uc:169) and the `scope` literal (104-132) are in the
**same function** (`handle_request`), so it's plain intra-function dataflow — no cross-function
tracing. The engine should also handle a scope built at module scope. Cache the descriptor
keyed by provider file (invalidate on edit). **This is 100% doable with existing machinery and
is the valuable 80%.**

This generalizes well beyond this package: `call(fn, ctx, scopeObj)` is THE ucode idiom for
sandboxed/templated execution (uhttpd handlers, rpcd plugins, custom-scope templates). The
engine is a reusable LSP capability, not a one-off.

### Layer 2 — Association (declare it cheaply; three strategies, best-effort → explicit)

**2a. Opportunistic auto, gated by the self-validating ⊆ check.** Apply an AmbientScope to a
candidate leaf only if the leaf's set of *undefined free globals* ⊆ the scope members. This is
a strong, low-false-positive signal (verified: leaf free-vars == scope members exactly). Pair
with a directory heuristic (leaves are the `*.uc` files compiled in the provider's
`loadfile`-loop; for an absolute runtime `lib` path, fall back to "package `*.uc` files that
satisfy the ⊆ check and aren't the provider"). Never inject if the ⊆ check fails → no false
typing.

**2b. ESLint-style per-file directive (cheap manual escape hatch).** One comment in the leaf:
```
// @ucode-scope ../metrics.uc#scope
```
or a pure-suppression form `/* ucode-globals gauge, counter, oneline, ... */` (the proven
ESLint `/* global */` pattern). The directive names the provider → Layer 1 supplies the types.

**2c. Project config (recommended primary — zero source edits, robust).** A
`.ucode-lsp.json` / `ucode.json` at the package root (the tsconfig/jsconfig analog), mirroring
the Makefile's install globs:
```json
{ "ambientScopes": [
    { "provider": "files/metrics.uc", "scopeExpr": "scope",
      "appliesTo": ["files/base/*.uc", "files/extra/*.uc"] } ] }
```
`provider`+`scopeExpr` feed Layer 1 (auto types); `appliesTo` is the user-controlled glob that
sidesteps the absolute-path problem soundly. One small file, fully typed, no per-file edits.

### Layer 3 — Injection + entry-function modeling

When a leaf matches an AmbientScope: seed its module/global scope with the descriptor's typed
symbols (so members resolve and type-check), suppress `strict_declarations` undefined-global
errors for exactly those names, and model the file as an entry-function body (top-level
`return false/true` legal; `this`/extra args = `call`'s ctx/args).

## Verdict / recommendation

- **Scope shape (A): solvable now, automatically** — ship Layer 1.
- **Association (C): not soundly automatic** for the dynamic-glob-over-absolute-path case
  (the map is external, in the Makefile). Ship **Layer 2c (project config)** as the primary
  sound association, **2b (directive)** for one-offs, and **2a (⊆-gated auto)** as an
  opportunistic bonus that can never mis-type because of the subset guard.
- **UX bridge:** when a strict leaf has N undefined free globals that match a known
  AmbientScope provider in the workspace, offer a discovery diagnostic/quick-fix —
  *"This looks like a call()-injected script; associate it with metrics.uc's scope?"* —
  turning the hard association step into one click.

Sequencing: Layer 1 + 2c delivers full typing for this package with a ~10-line config and no
source changes. Everything else is incremental polish.

## Relationship to other docs

This is the most general member of the "validly-global-through-an-unmodeled-mechanism" family:
`docs/implicit-global-type-inference.md` (bare globals), `docs/global-property-functions.md`
(`global.X`), `docs/include-scope-resolution.md` (`include()` leaks). The `call(fn,ctx,scope)`
case differs in that the binding is **cross-file and dynamic**, which is why association — not
shape — is the irreducible hard part.
