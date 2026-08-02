# lookupAtPosition is an O(all-symbols) linear scan — index it

Status: **BUILT 0.7.83 (uncommitted, awaiting user test).** `symbolsByName` name-keyed
index in symbolTable.ts, maintained in declare(); both scan sites (lookupAtPosition,
findInScopeLaterDeclaration) iterate the bucket. Measured AFTER (same workloads):
7.5k-line file 1.13s -> **0.43s** (faster than the 0.45s pre-0.7.82 baseline even with
every converted call site now position-aware); lookupAtPosition self time 40.6% -> 0.71%
(corpus). Original analysis below. Spun out of
docs/stale-scope-lookup-audit.md: the 0.7.82 fix (63a8364) put `lookupAtPosition` on the
every-identifier hot path, and converting the remaining flagged sites will add the
every-member-expression and every-narrowing-query paths too. The scan cost must be fixed
first or those conversions buy correctness with a real latency regression.

## Measured (node --cpu-prof, dist/cli.js)

| workload | total | lookupAtPosition self | note |
|---|---|---|---|
| glinet corpus, 57 files (~1-2k lines each) | 1.84s | 0.068s (3.7%) | 5th hottest fn at 0.7.82 |
| synthetic 7,500-line file (~7.5k symbols) | 1.13s | 0.457s (40.6%) | dominant cost |
| same file, pre-0.7.82 build (63a8364~1) | 0.45s | not in top 5 | |

So the 0.7.82 correctness fix costs ~2.5x wall time on large files, essentially all of it
in the `for (const symbol of this.allSymbols)` scan (symbolTable.ts:862): every identifier
check walks EVERY symbol ever declared in the file, comparing names.

## Expected speedup from an index

`Map<string, Symbol[]>` keyed by name: the scan visits only same-name symbols (typically
1, worst case = shadow depth), preserving the exact declaredAt/scopeEnd innermost-wins
logic over the bucket. Expected: the 7.5k-line file returns to ~0.45-0.5s (~2.2-2.5x),
the small-file corpus gains ~4%. It also removes the perf objection to converting the
remaining stale-scope sites (member expressions, narrowing chokepoint, arg descriptions).

## Design

- Maintain the map incrementally where symbols enter `allSymbols` (O(1) append per
  declaration) — no build pass, no invalidation problem: `allSymbols` is append-only for
  a given analysis.
- `lookupAtPosition` (and `findInScopeLaterDeclaration`, same scan shape at ~907) iterate
  `index.get(name) ?? []` instead of `allSymbols`.
- Memory: one array slot per symbol per file — negligible next to the symbols themselves.

## Re: keeping the index only for OPENED files (huge-workspace concern)

Each analyzed file gets its own SymbolTable instance, so the index is inherently
per-file and dies with the table — a workspace scan never holds one giant index. The
open-files-only option is therefore about whether CLOSED files' retained analyses (the
cross-file cache) keep their tables/indexes in memory. Measure retained-heap per cached
file before adding that knob; expectation is the index adds low single-digit % to a
table's footprint and needs no special-casing. If workspace memory ever becomes a
problem, the bigger win is dropping/compacting whole cached symbol tables for non-open
files, not just their indexes.

## Order of work

1. Index + both scan sites swapped to buckets; assert identical results (the full suites
   + the glinet corpus differential must be byte-identical).
2. Re-profile both workloads; record numbers here.
3. Then proceed with the stale-scope conversions (docs/stale-scope-lookup-audit.md)
   without perf anxiety.
