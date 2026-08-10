# ReScript rewrite audit — what would it actually buy us?

Status: research audit, 2026-08-09 (requested immediately after the 0.8.8
banned-types eradication landed). Verdict at the bottom; numbers first.

## Where the codebase stands (post-0.8.8 census)

59,622 lines of TypeScript in src/, under a maximal-strictness tsconfig
(`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`noImplicitReturns/Override`, `strictPropertyInitialization`) plus the new
oxlint gate (zero `any`, zero `unknown`, zero `Record<string, unknown|any>`).
`AstNode` is a real discriminated union with a static totality assert.

What that regime still **cannot** prevent — the honest inventory of remaining
escape hatches:

| Escape hatch | Count | Nature |
|---|---|---|
| `as X` type assertions | **1,295** | Each is an unchecked claim. Top offenders: `as IdentifierNode` ×268, `as UcodeDataType` ×254, `as LiteralNode` ×123 — a large fraction are now *redundant* post-union (narrowing already proves them) but they still compile if wrong. |
| Non-null assertions (`x!`) | **362** | Unchecked "trust me" on nullability. |
| Untyped exceptions | 27 throw / 230 catch sites | `catch (e)` gives an untyped value; nothing checks what can actually be thrown from where. |
| Structural typing accidents | unmeasurable | Two same-shaped types unify silently (`SingleType` vs plain string is why `as UcodeDataType` exists ×254 — the union-representation smuggling documented in the union-repr notes). |
| Hand-rolled exhaustiveness | ~dozens of sites | `default: const _x: never` and `satisfies` tricks work, but each site must remember to write them. |

## What ReScript would guarantee that TS-at-max-strictness cannot

1. **Soundness — no `as`.** The 1,295 assertions and 362 `!`s simply cannot be
   written. The only escape hatches (`%identity`, `Obj.magic`) are visually
   loud, greppable, and conventionally confined to binding files. This is the
   single biggest delta: in TS, every one of those 1,657 sites is a place a
   future refactor can silently invalidate a claim the compiler then trusts.
2. **Native, mandatory exhaustiveness.** Pattern matching over variants warns
   (configurable to error) on any non-exhaustive match — the guarantee we
   hand-build with `never` asserts and the total `astChildren` switch becomes
   free and unforgettable at *every* match site, not just the ones we
   remembered to fortify.
3. **Nominal types.** `SingleType` / `UcodeType` / `ModuleType` /
   `UnionType` would be distinct variant constructors, not overlapping
   structural shapes — the entire `as UcodeDataType` smuggling family
   (~254+10 sites) is unrepresentable. Same for the AST: a
   `Property({key, value})` constructor can't be confused with anything
   structurally similar.
4. **No null/undefined ambiguity.** `option<'a>` is the only absence; the
   `exactOptionalPropertyTypes` pain class (present-with-undefined vs absent —
   which bit us twice this session in `RelDiagnostic.diag`) doesn't exist
   internally. (It *reappears* at the JS boundary as `Js.Nullable` /
   `undefined<'a>`, see costs.)
5. **Typed-ish exceptions** (extensible `exn` variant) and immutable-by-default
   bindings — mutation must be declared (`ref`, mutable record fields).
6. **Total inference.** No annotation debt: signatures are inferred and
   checked globally; there is no "unannotated = implicitly loose" failure mode
   at all.

**A telling datapoint from this very session:** both latent bugs found during
the eradication — the `'UpdateExpression'` probe (a node kind that doesn't
exist) and the `tryNode.catch`/`finalizer` probes (fields that don't exist) —
are *stringly-typed AST probe* bugs. In ReScript, matching on a nonexistent
constructor or field has never compiled. But note the counterpoint: **our
union conversion now catches exactly that family in TS too** — both bugs
surfaced as compile errors the moment `AstNode` became a real union. The
marginal ReScript win over post-0.8.8 TS is the *unforgeability* of the
guarantee (no `as` to opt out), not the guarantee itself.

## What a rewrite would NOT fix

- **The FFI edge is unsound in any language.** There are no maintained
  ReScript bindings for `vscode-languageserver` (14 import sites) — we'd write
  `external` declarations by hand, and an `external` is a *trusted claim*,
  exactly as trustworthy as the TS `.d.ts` we currently lean on. All LSP JSON
  (diagnostics `data` payloads, config, `TextDocument`) remains
  validate-or-trust at the boundary. The `DiagnosticData = object` weak spot
  moves; it doesn't die.
- **Logic bugs.** The wrap-extent scans, guard extractors, flow-engine joins —
  the actual hard bugs of this project (loop back-edge divergence, guard-cache
  poisoning, parse-mode misdiagnosis) were semantic, discovered by corpus
  sweeps and container oracles, not by the type system of either language.
- **The oracle infrastructure** (mega-sweep, OpenWrt containers, ucode source
  pins) is language-agnostic and remains the real correctness backbone.

## What it would cost

- **59.6k lines rewritten.** Layer sizes: lexer 1,750 / parser 3,239 / ast 808
  / analysis **40,104** / LSP feature+server files 13,721. The analysis layer
  is a 10,803-line stateful class (semanticAnalyzer) plus a 7,947-line
  typeChecker — ReScript has no classes, so this is a *redesign* into modules
  + explicit state records, not a port.
- **The Effect library goes** (10 files use `Option`/`Match`, ~90 call sites)
  — ironic, since Effect exists to approximate what ReScript has natively,
  but it's still churn.
- **64 test files import `src/*.ts` directly** (the rest drive the compiled
  server). Those suites would need genType-generated `.d.ts` shims or ports.
  The 4,479-test corpus is the safety net for any migration and must stay
  green throughout — which the per-file `.res.mjs` output + `@genType`
  interop does make feasible incrementally.
- **Toolchain/ecosystem**: ReScript v11/v12 tooling is good but a fraction of
  TS's; oxlint/tsc/webpack knowledge doesn't transfer; solo-maintainer bus
  factor on a niche toolchain.

## The cheaper way to buy most of the same delta (recommended)

The remaining gap between "TS as we now run it" and ReScript is mostly the
1,295 `as` + 362 `!` sites. We already own an AST-level lint gate; the same
plugin infra that bans `TSUnknownKeyword` can ban `TSAsExpression` and
`TSNonNullExpression`:

1. **Sweep the now-redundant casts.** The union made a large share of
   `as XNode` casts provably unnecessary (narrowing already proves them) —
   delete them mechanically, sweep-verified −0/+0.
2. **Fix the `UcodeDataType` representation** so the 254-site smuggling family
   dies at the source (a tagged union instead of string-enum ∪ object shapes —
   this is the TS-side version of ReScript's nominal win, and it's one
   focused refactor).
3. **Extend `ban-types-plugin.mjs`**: error on `TSAsExpression` /
   `TSNonNullExpression` outside an explicit allowlist (the FFI boundary
   files: server.ts LSP edge, bindings to lexer tokens). Then reintroducing an
   unchecked claim fails the build — the "unforgeability" property, in TS.
4. Keep the totality asserts (already enforced by the union + astChildren).

That captures, by rough count, ~80–90% of ReScript's marginal guarantee for
~2–3 focused sessions instead of a multi-month rewrite.

## If we ever do want ReScript

Don't big-bang. The right first bite is **lexer + parser + AST (5.8k lines)**:
pure functions, zero LSP interop, and the layer where variants + exhaustive
matching shine hardest (the parser IS a giant pattern match). Compile with
`@genType` so the TS analysis layer consumes typed output unchanged; the
corpus sweep arbitrates equivalence exactly as it did for 0.8.8. The analysis
layer only after the representation refactor above proves out the shapes.

**Verdict: a full rewrite buys real but narrow marginal guarantees —
soundness (no `as`/`!`), native exhaustiveness, nominal types — at the cost of
rewriting 59.6k lines around an FFI edge that stays exactly as trusted as
today's. Post-0.8.8, the dominant share of that delta is purchasable inside
TypeScript by banning type assertions with the lint infrastructure we just
built. Do that first; reconsider ReScript (or not) once `as` is down to a
single-digit allowlist — at which point the remaining delta is small enough
that the answer will likely be "no need".**
