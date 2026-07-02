# Global-scope soundness: definite-assignment classification for injected/implicit globals

**Status:** agreed design, staged. Stage 1 (Case 3) implemented first; Stages 2–3 (the
definite-assignment dataflow, "Tier 2") are the large follow-on.

## Problem

ucode globals are **runtime VM state**, not lexical bindings. `global.X = …` mutates the
shared VM scope *when it executes*; the binding then lives until the VM exits, shared
across every `loadfile`/`include`'d unit. So "is `X` in scope at read R?" is a runtime,
order- and path-dependent question.

The LSP today answers it **binarily**: if it can *explain* where a name comes from
(in-file `global.X=`/bare-assign, loadfile/include-injection, injected scope, builtin) it
treats the name as **unconditionally present** and stays silent; otherwise UC1001 fires
(Warning non-strict / Error strict). There is no "maybe in scope" tier, and "explained"
over-approximates — it ignores order, conditionality, and the function/branch the
assignment lives in.

Verified divergences from `ucode`:
- strict-mode read **before** the defining statement runs → ucode throws
  `Reference error: access to undeclared variable`; LSP is silent (and typed).
- non-strict read-before-define → ucode yields `null`; LSP types it as the shape.
- defining `loadfile()`/`global.X=` behind a never-taken branch → ucode never defines it;
  LSP assumes defined.
- a callee reading a global its *caller* injects → runtime-dependent; LSP can't see it.

## The real predicate: definite assignment

At read R of global G, *on every path that reaches R, has an assignment to G already
executed?* (Does a G-assignment **dominate** R on the inter-procedural + inter-file CFG?)

- **all paths** → definitely in scope → silent. **(Case 1)**
- **some paths / can't prove** → maybe in scope → configurable diagnostic. **(Case 2)**
- **no assignment visible** → undefined → UC1001 / registry / setting. **(Case 3)**

This is identical whether G is assigned in-file or cross-file — only the *proof difficulty*
differs. The sub-cases are a **proof-effort ladder**; whatever we can prove dominates
moves from Case 2 into Case 1.

### Case 1 — provably in scope (silent)
| sub | situation | needs |
|-----|-----------|-------|
| 1a | top-level **unconditional** assignment dominating R | the existing `top-level` CFG + a definite-assignment query |
| 1b | assigned in a function **provably called unconditionally before R** (`init(); … use()`) | an intra-file **call graph** (not built) |
| 1c | cross-file: unconditional top-level def in the loaded file **and** the `loadfile()()` is unconditional-before-R | **cross-file CFG stitching** at the loadfile site (not built) |

### Case 2 — def exists but not provably dominating (configurable)
| sub | situation |
|-----|-----------|
| 2a | assignment is **conditional** (`if`/loop/`try`) |
| 2b | assigned only in a function whose call we can't prove precedes R |
| 2c | cross-file edge not provably executed before R (loadfile behind a branch / read-before-loadfile / conditional def in the loaded file) |
| 2d | read on a path **before** any assignment — the strict Reference-error case (highest severity) |

### Case 3 — no assignment visible (UC1001 today)
A typo, or a global injected by a mechanism we don't follow (C-host globals like
`uhttpd`/`ubus`/`hostapd`, `-D` CLI defines).

## Decisions (from the user)

- **Proof depth → Tier 2.** Build the full ladder, in stages: top-level dominance →
  intra-file call graph → cross-file CFG stitching.
- **Case 2 severity → Warning, upgraded to Error under `'use strict'`** (mirrors ucode's
  strict Reference-error). A setting pins it at warn-only.
- **Case 3 →** a **known-host-globals registry** (built-in **and** developer-extensible via
  a JSDoc `@global` tag) that moves recognized names into Case 1; **plus** a default-**off**
  setting that treats *all* unknown reads as globals (blanket UC1001 suppression).

## Staging

- **Stage 1 — Case 3 (this increment).** JSDoc `@global [{type}] name` (file-level,
  developer-extensible) + a built-in host-globals registry + the default-off
  `assume-undefined-are-globals` setting. No dataflow; pure noise control. Independent and
  low-risk. **Suppression only** — these names stop being UC1001/UC1002, but we do NOT yet
  declare a typed symbol (that would pollute completion in every file and risk a false
  redeclaration against a user's own `let <name>`). *Fast-follow:* type a `@global {type}`
  via reference-gated declaration (declare the symbol only where the name is actually read,
  and only if the user hasn't declared it).
- **Stage 2 — Tier 0/1 (intra-file). IMPLEMENTED (conservative).** The Case-2 diagnostic
  `UC8002` (`ucode.uncertainGlobalScope`: `errorInStrict` default / `warn` / `off`) flags a
  **top-level read of a global before its earliest in-file def** (`global.X=`/bare `X=`),
  i.e. the sound 2d case. Severity: warning, error under `'use strict'`.
- **Stage 3 — Tier 2 (cross-file). IMPLEMENTED (conservative).** The same check treats a
  top-level `loadfile("f.uc")()` as a def-point for the globals that file injects, so a read
  **before** that loadfile is flagged (cross-file 2c-before-load) and a read after is clean.

  **What's deliberately conservative (deferred precision, not unsoundness):** the check never
  fires when a global is assigned inside *any* function (no call graph → `init()` might run
  first — would need Tier 1) or for reads inside functions, and it treats a loadfile/`global.X=`
  as an unconditional def-point rather than doing full branch-CFG stitching inside the loaded
  file. Net effect: it flags the provable read-before-injection bug (in-file and cross-file)
  with **zero false positives** (validated: full suite green with the check default-on), and
  stays silent on everything it can't prove. Remaining precision — interprocedural call-graph
  (flag `use()` when `init()` provably hasn't run) and conditional-def/branch reasoning — is
  future work that only *adds* flags; the conservative core is correct as shipped.
- **Stage 4 — the DEFINITION side (`UC8004`). IMPLEMENTED.** The dual of Stage 2: instead of
  flagging an uncertain *read*, flag the *assignment* whose execution isn't guaranteed — a
  global assigned only inside a function / `if`/`else` branch / `switch` case / loop /
  `try`/`catch` / ternary arm / short-circuit RHS may never come into existence ("cannot be
  statically determined"). Same `ucode.uncertainGlobalScope` severity knob. Precision is a
  real **must-assign (definite assignment) analysis**, so the check is silent wherever
  existence IS statically determinable: unconditional top-level assignment (incl. `if (true)`
  static guards), exhaustive `if`/`else` + ternary (both arms assign), `switch` **with
  `default`** where every entry assigns before `break` (fallthrough followed), `try`/`catch`
  where both sides assign, and a **tier-1-lite call graph**: an
  unconditional top-level call to an in-file function whose body unconditionally assigns the
  global (the `init()` idiom; transitive through direct calls, cycle-safe — a first slice of
  Case 1b). `@global`-declared / host-registry names are exempt (the sanctioned opt-out).
  Sites for the same global are cross-linked via `relatedInformation`. Quick fixes: seed
  `global.X = null;` at top level (preferred; inserted below shebang/`'use strict'`) or
  declare `/** @global X */`. Must-assign under-approximates, so precision gaps only *add*
  flags — the read side (Stage 2) stays conservative and silent for these names.
- **Stage 4c — `UC8003` redesigned + scalar-global SSA typing. IMPLEMENTED.** UC8003 now
  fires only when a global's TYPE genuinely cannot be statically determined: a cross-type
  conflict where at least one assignment sits inside a function (call timing unknowable).
  Always a **Warning**, never an Error — cross-type reassignment is legal, deterministic
  ucode with no runtime failure to mirror (unlike UC8002/8004/8005). Straight-line top-level
  cross-type reassignment is silent AND actually delivered on: scalar globals whose every
  assignment is straight-line top-level get a real symbol whose dataType updates per
  assignment in source order (`global.M = 1; let a = M;` → integer; `global.M = "s"; let b =
  M;` → string) with positional typeHistory for hover — the same most-recent SSA locals use.
  Top-level branch cross-type is a knowable phi-union → silent. Also fixed alongside: the
  parser wrongly rejected `cond ? a = 1 : b = 2` (unparenthesized alternate assignment —
  valid ucode; the C compiler inherits assignability through its exprstack parent walk),
  tier-1-lite now covers `let`/`const`-bound lambdas (reassigned `let`s excluded), and a
  statically-decided ternary test takes exactly one arm in both the must-assign meet and the
  context walk.
- **Stage 4d — global-object property parity (`UC8006`). IMPLEMENTED.** Property writes on
  object-literal globals track like locals: the nested `global.X.p = …` form (any context,
  incl. function bodies) now records into the global symbol's propertyTypes exactly like the
  bare `X.p = …` form, so `global.CACHE = {}; function warm() { global.CACHE.hot = 1; }` types
  `CACHE.hot` as integer. On top of that, `UC8006` flags a read of a property NEVER assigned
  on a fully-visible object-literal global — provably always null in this file. Full
  visibility is enforced by taint: the name (or `global.X`) used as a VALUE anywhere (call
  arg, alias, element, return), a computed write `X[k] = …`, or reassignment to a non-literal
  silences the check; `for (k in X)`, computed reads, and `delete` cannot add properties and
  don't taint. Warning severity; `@global` exempts; the family `off` disables. Go-to-def
  position stamping extended to object/function/array global bindings (previously landed at
  offset 0). **UC8007** extends the same proof to LOCAL `let x = {…}` objects (always-on,
  not gated by `uncertainGlobalScope`): occurrences resolve through the symbol table
  (lookupAtPosition + declaredAt identity) so shadowing is precise; closure writes count;
  extra taints — `export { x }` (cross-module mutation) and spread/computed-key literals
  (shape not fully enumerable), the latter also retrofitted onto UC8006's candidacy. The
  UC8007 walker is an EXHAUSTIVE per-node-kind handler table (`satisfies
  Record<AstNodeKind, …>`): tsc rejects a missing kind, so growing the AST forces a
  conscious decision per context (value-use vs name position); runtime falls back to
  generic recursion for structural non-AST objects that carry a `type` string.
- **Stage 4b — the read-site echo (`UC8005`) + go-to-definition. IMPLEMENTED.** A read of a
  global whose *every* definition is non-deterministic gets an echo diagnostic at the read —
  the site where the null / strict Reference error would actually materialize — one severity
  step below the def's UC8004 (Information; Warning under strict), cross-linked both ways via
  `relatedInformation`, same seed-default/`@global` quick fixes. Covers reads inside
  functions too (their call timing is unknown in both directions — the same unprovable claim);
  suppressed when the global is definitely assigned earlier in the same body via the
  must-assign machinery (a direct assignment, or a call to a function that unconditionally
  assigns it), and shadowing params/locals are respected. Alongside it,
  `globalDefSites` (analysis result) records every `global.X=` property span, bare
  implicit-global target, and JSDoc `@global` tag name, powering **go-to-definition** for
  globals with no declared symbol (scalars, multi-site switch defs → peek list, @global
  declarations).

## Notes
- Naïve lexical-order position-sensitivity is unsound: the `init()`-defines /
  `use()`-reads-it idiom would false-positive (lexical order ≠ execution order). That's why
  Tier 1 (call graph) is required before turning Case 2 on by default.
- Related prior art: `docs/cli-defined-globals.md` (the `-D`/SCREAMING_CASE family),
  `docs/scope-injection-ambient-globals.md` (caller scope injection), and the existing
  loadfile/implicit-global harvesting in `semanticAnalyzer`.
