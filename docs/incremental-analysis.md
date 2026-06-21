# Function-level incremental analysis

Status: **implemented (branch `incremental-analysis`), sound + verified.** Targets the
large-file typing lag: the analyzer re-processed the whole file on every edit (~540ms on
fw4.uc, type checking ≈490ms of it). This makes editing inside one function skip the
type-checking of every *unchanged* function body.

## The idea

On each analysis the cheap passes (scope, refs, usage, CFG ≈50ms) still run fully — so
cross-function state (declarations, usage, shadowing, object property shapes) stays correct.
Only the EXPENSIVE part — type checking inside unchanged, pure function bodies — is skipped,
with the body's cached diagnostics replayed and its cached return type restored.

## Soundness (why incremental ≡ full)

Continuously checked by `tests/test-incremental-analysis.test.js` (asserts incremental
diagnostics are byte-identical to a fresh full analysis across many edit sequences — including
cross-method dependency edits and real fw4.uc). Four mechanisms:

1. **Structural fingerprint** — a hash of the file with every unit body interior blanked.
   Unchanged ⟺ nothing *outside* any body changed (signatures, globals, imports, top-level
   structure). Any change → full analysis.
2. **Body class** (`classifyBody`): `pure` (no outward writes), `thisSafe` (only `this.<p>=`
   writes), or `impure` (writes a global/outer object). Pure and thisSafe are skippable; a
   thisSafe body replays its cached `this`-property write types on skip so siblings see real
   types; impure bodies are always re-analyzed.
3. **Body text** — a unit keyed by exact body text; cached diagnostics re-anchored to the
   body's current offset and dedup-merged with fresh scope diagnostics (no double/drop).
4. **Semantic fingerprint** (the subtle one) — the structural fingerprint does NOT capture
   types *derived* from body interiors (a body's return type, returned shape, or `this`-write
   types). Editing inside body A can change those and a skipped reader B would be stale. So
   after each incremental pass we hash every unit's derived signature; if it changed, a skipped
   reader might be stale → we transparently redo a FULL analysis. Pure-logic edits (the common
   typing case) don't move the signature → fast path; only signature/shape changes pay for the
   redo.

The scope visit running for ALL bodies is what makes type-skipping sound where a naive "skip
the whole body" is not: fw4's object-method scoping makes a sibling's locals visible, so
skipping a body's *declarations* would drop cross-sibling shadow warnings. Keeping scope
preserves them.

### Cross-file invalidation (the second axis)

The four mechanisms above are all INTRA-file — they keep a single file's incremental result
equal to its full result. They do NOT cover a file whose diagnostics depend on an IMPORTED
file: the semantic fingerprint hashes only the file's OWN unit signatures, so when an imported
return type/shape changes, a dependent's own signatures are unchanged and its (structurally
identical) bodies would be SKIPPED — replaying diagnostics computed against the import's stale
exports. This is a real hazard precisely where cross-file type inference flows (a directly
imported function used inside a pure/thisSafe body).

The fix lives in the server, not in `runIncremental`: `invalidateDependents()` re-analyzes each
dependent of a changed file with `forceFull = true`, so the dependent drops its cache and
re-type-checks. Dependents are walked transitively via `reverseDeps`, so the whole import
closure is refreshed. Cost: one full pass per dependent when an import changes — rare relative
to keystrokes, and only actual dependents pay. (Regression: before this, editing an imported
file left an open dependent's in-body diagnostics stale until the dependent was re-opened.)

## Test suites (soundness is continuously enforced)

- `tests/test-incremental-analysis.test.js` — the original harness (11): incremental ≡ full
  across edit sequences incl. fw4.uc and the 3 cross-method dependency cases.
- `tests/test-incremental-soundness-samefile.test.js` — broad same-file matrix (84): every body
  shape (top-level fn, object method, this.x= thisSafe, global-writing impure, arrow lambda,
  fn-expression, factory, nested object, return-{} module shape, IIFE, recursion) × edit kind
  (whitespace, comment, logic, error in/out, return-type change, returned-shape change,
  this-write-type change, signature change, add/remove/reorder unit) × cross-body semantic
  dependency. Asserts inc ≡ full at every step, and skip-engagement where expected. (Also
  documents which shapes are sound-but-not-skip-optimized: arrow-let/fn-expr-let/nested-object/
  factory-method-in-a-function aren't extracted as units — editing them changes the fingerprint
  and falls to a correct full pass.)
- `tests/test-incremental-cross-file.js` — real-server cross-file invalidation (22, mocha):
  import nullability flips through a body, export add/remove, transitive/fan-in re-check, dep
  delete, dep syntax-error recovery, importer own-edit composition, round-trips. Reverting the
  `forceFull` fix fails 15 of these. Run: `npx mocha tests/test-incremental-cross-file.js`.

## Pieces

- `incrementalCache.ts` — unit extraction (top-level functions + object-literal methods,
  incl. the `return { … }` module-export shape), the body-blanking fingerprint, body hashing,
  purity analysis.
- `incrementalAnalysis.ts` — `planClean` (which bodies to skip + their re-anchored cached
  diagnostics) and `buildCache` (carry forward unchanged units; recompute changed ones).
- `typeChecker.setCleanRanges` — `checkNode` returns UNKNOWN (no recursion, no diagnostics)
  inside a clean range.
- `semanticAnalyzer.setCleanBodies` — keeps the scope visit, restores the cached return type,
  dedup-merges cached diagnostics.
- `server.ts` — per-document cache; the debounced diagnostics pass uses incremental. Cursor
  features (hover/completion/definition/signature) call `ensureFullAnalysis` first: if the last
  pass skipped bodies, one full re-analysis runs so they never see degraded types.

## Results

fw4.uc (3378 lines, 103 units = 89 pure + 11 thisSafe + 3 impure), edit inside one method:

| | analysis | end-to-end (server) |
|---|---|---|
| full (pre-incremental) | ~540–596 ms | ~585 ms |
| incremental, pure-logic edit | **~45–51 ms** (100/103 skipped) | **~110–130 ms** |
| incremental, signature/shape-changing edit | full + one fast pass | ~990 ms (sound fallback) |

**~12–13× on the analysis itself; ~5× end-to-end** for the common typing case. (`this.x=`
bodies became skippable via thisSafe replay — that's what unlocked fw4's big methods.)

## Where the remaining floor actually is (measured)

A profile of the incremental fast path on fw4.uc (100/103 bodies skipped) breaks down as:

| component | cost | notes |
|---|---|---|
| parse (full re-parse) | ~8 ms | parser isn't structured for incremental; cheap enough |
| incremental analysis | ~44–52 ms | scope/CFG/usage visit (whole file) + type-check of the *non-skipped* code |
| inlay-hint precompute | ~7 ms | full-AST walk, but cheap |
| include-scope index (warm) | ~7 ms for 87 files | cached behind a 10s TTL; only a Map.get on the hot path |

The earlier "~110ms floor / inlay + include-index are the next lever" note was **wrong** — both
are ~7 ms. The real residual is inside the ~44 ms analysis: of that, ~10 ms is the parse + the
whole-file scope/visit (everything-off floor) and **~29 ms is type-checking the code that isn't
in a skippable unit** — top-level declarations and the impure bodies.

**Why that 29 ms is hard to remove soundly:** function bodies are *leaves* — their internal
types never escape except via the return value (cached) and `this`-writes (cached), so skipping
their type-check is sound. Top-level statements are NOT leaves: `let X = foo();` *defines the
environment*, so marking it "clean" (checkNode → UNKNOWN inside the range) would poison `X`'s
type for every downstream reader. Skipping top-level type-checking would require separately
caching+replaying each declaration's derived type AND its diagnostics — a much larger machine
whose soundness surface would erode the property that makes this design defensible (incremental
≡ full, verified byte-for-byte). Given the win is ~29 ms → maybe ~15 ms (e2e ~52 → ~38 ms) on
top of an already-13× speedup, it isn't worth that risk today. The whole-file scope/visit floor
(~10 ms) is what keeps cross-function shadowing correct and is deliberately not skipped.

So the perf work is considered complete at ~13× analysis / ~5× e2e; the path to sub-50 ms e2e
is top-level-statement incrementalization, documented here as a deliberate non-goal for now.
