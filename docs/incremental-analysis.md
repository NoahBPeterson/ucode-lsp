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

Three invariants, continuously checked by `tests/test-incremental-analysis.test.js` (which
asserts incremental diagnostics are byte-identical to a fresh full analysis across many edit
sequences, including real fw4.uc):

1. **Environment fingerprint** — a hash of the file with every unit body interior blanked.
   Unchanged ⟺ nothing *outside* any body changed (signatures, globals, imports, top-level
   structure). Any change discards the whole cache → full analysis. So when we DO skip, every
   other body's type-check result is provably unchanged.
2. **Purity** — only bodies with no OUTWARD writes are type-skippable (`isPureBody`). A pure
   body's only external effect is its return value (cached) — it can't change another body's
   types. A body that writes `this.x =` / a global / an outer object is re-analyzed in full
   (its property writes must carry real types for siblings).
3. **Body text** — a unit is keyed by its exact body text; same text + same fingerprint ⇒
   identical result, so its cached diagnostics are valid (re-anchored to the body's current
   offset; merged with fresh scope diagnostics by dedup so nothing doubles or drops).

The scope visit running for ALL bodies is what makes it sound where a naive "skip the whole
body" is not: e.g. fw4's object-method scoping makes a sibling's locals visible, so skipping a
body's *declarations* would drop cross-sibling shadow warnings. Keeping scope preserves them.

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

## Results & limits

fw4.uc, edit inside one method: **~540ms → ~320ms analysis** (isolated), ~1.5–2.5× end-to-end.
89 of 103 bodies skip. The ceiling here is that fw4's *big* methods (parse_rule, parse_redirect,
parse_zone, …) write `this.x =` → impure → re-analyzed in full (they're 64% of body bytes).

**Future work (further speedup):**
- Make `this.x=`-only bodies skippable by caching per-property write types and restoring them
  for clean bodies (so the big methods can skip too).
- Incrementalize the remaining O(file) per-analysis work (inlay-hint precompute, the
  include-scope host check).
