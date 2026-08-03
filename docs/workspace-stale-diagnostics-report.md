# Report: workspace-wide run served stale diagnostics for an externally-changed file

Status: **NOT STARTED — 🟡 NEEDS REPRO.** Reported 2026-08-01 by the glinet audit session
([TRIAGE-2026-08-01-glinet-fp-audit.md](TRIAGE-2026-08-01-glinet-fp-audit.md)); not yet
reproduced locally.

## The report

During a project-wide analysis of glinet-ucode, `tailscale.uc` diagnostics matched the
PREVIOUS git commit's content — including phantom `join()` errors on a line that in the
working tree is an `nft` command (the swapped-join bug had been fixed in HEAD). Re-checking
the file individually refreshed it and the project total dropped 328 → 325. The session's
takeaway: "don't trust a project-wide run right after committing without a fresh check."

Interpretation: a `git checkout`/commit changed files on disk without the editor/didChange
pipeline seeing them, and some layer (workspace scan cache, fileResolver AST cache, or the
CLI's project mode) served analysis keyed to the old content. Note existing machinery:
`invalidateDependents` re-analyzes on Delete/close (memory: workspace-wide diagnostics since
~0.6.169), and the fileResolver has an AST cache keyed how — mtime? content hash? If it's
mtime-with-second-granularity or a missing invalidation on unopened files, a fast
commit+rescan hits it.

## To do

1. Determine which runner the audit used (CLI project mode vs live LSP workspace scan) — the
   caching layers differ.
2. Repro: analyze workspace → `git commit` a change to an unopened file (or `git checkout`
   another branch) → immediately re-run project-wide analysis → compare against a cold run.
3. Check fileResolver/workspace-scan cache keys (mtime granularity, content hash) and the
   CLI's reuse of cached ASTs across invocations (is there any cross-process persistence? if
   not, the report implies the audit reused one long-lived session — an LSP-side cache).
4. Fix = invalidate on mtime/size/hash mismatch at read time; add a test with an on-disk edit
   that bypasses didChange.
