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

**Future work (remaining e2e overhead):** incrementalize the O(file) per-analysis work that
isn't body type-checking — the inlay-hint precompute and the include-scope host check — which
are the ~110ms floor + the occasional spike (the include index has a 10s TTL rebuild).
