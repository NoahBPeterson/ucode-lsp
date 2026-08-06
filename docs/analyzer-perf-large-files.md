# Analyzer perf: multi-hundred-KB single files hang analysis

Status: **OPEN — found 2026-08-05 during the third-party LuCI fleet sweep.**

Repro: `i-love-luci`'s rpcd backend
(`applications/luci-app-i-love-luci/root/usr/share/rpcd/ucode/i-love-luci.uc`,
315 KB / ~10,000 lines of ordinary handwritten code — imports, a big const table,
many small functions). A full SemanticAnalyzer pass did not complete within 100+
seconds; the fleet sweep had to skip files > 150 KB explicitly.

Clone for repro: `github.com/3aa49ec6bfc910647fa1c5a013e48eef/i-love-luci`.

MEASURED (2026-08-05, probe with the real vscode-languageserver-textdocument):
- parse: ~60 ms. Full analysis: **60.7 s on 0.8.0-wip; 65.4 s on the 0.7.92
  baseline** — pre-existing, NOT an 0.8.0 regression (0.8.0 is marginally faster).
- With a stub `positionAt` that returns a constant, the same analysis takes
  **6.5 s** — i.e. ~90% of wall time is position-mapping volume (the analyzer calls
  `textDocument.positionAt` per diagnostic emission AND throughout internal passes;
  on a 10K-line file that's evidently millions of calls, each O(log n) + object
  allocation). The remaining 6.5 s core is itself worth profiling after that.

Attack order suggested by the numbers: (1) audit/batch positionAt usage — emit
offsets internally and convert once at the end (the diagnostics filter pipeline
already carries offsets), or memoize a line-index on the analyzer; (2) THEN
cpu-profile the residual 6.5 s core (0.7.82 methodology). Target: an sub-2 s
analysis for a 300 KB file, which restores keystroke-responsiveness with the
existing incremental-analysis machinery on top.
