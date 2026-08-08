# Analyzer perf: multi-hundred-KB single files hang analysis

Status: **FIXED in 0.8.1 (2026-08-06).** 315KB repro: 70.3 s → 0.6 s (~100×),
byte-identical diagnostics. Found 2026-08-05 during the third-party LuCI fleet sweep.

Repro: `i-love-luci`'s rpcd backend
(`applications/luci-app-i-love-luci/root/usr/share/rpcd/ucode/i-love-luci.uc`,
315 KB / ~10,000 lines of ordinary handwritten code — imports, a big const table,
many small functions). A full SemanticAnalyzer pass did not complete within 100+
seconds; the fleet sweep had to skip files > 150 KB explicitly.

Clone for repro: `github.com/3aa49ec6bfc910647fa1c5a013e48eef/i-love-luci`.

## Root cause (measured 2026-08-06, call-count instrumentation)

The ticket's original positionAt hypothesis was a symptom. The disease was
**quadratic diagnostic forwarding**: on the 315KB file, `addDiagnostic` was called
**14.8 MILLION times to produce 933 final diagnostics** (29.7M positionAt calls),
from two compounding quadratics:

1. **Cumulative forwarding.** The analyzer's 8 expression-visitor sites each ran
   `typeChecker.getResult()` — which returned the checker's ENTIRE cumulative
   error/warning history — and re-forwarded every entry through `addDiagnostic`
   at every visit. O(visits × total errors).
2. **O(n) dedup scan per emission.** `addDiagnostic`/`addDiagnosticErrorCode`
   deduped with `this.diagnostics.some(...)` over all prior diagnostics, after
   computing both positionAt calls. So every one of the 14.8M discarded
   duplicates paid two positionAt binary searches plus a scan.

## Fix (0.8.1)

- `typeChecker.drainNewDiagnostics()`: high-water-marked drain returning only
  entries emitted since the previous drain (4 marks: checker + builtinValidator
  errors/warnings, clamped because checkNodeQuietly truncates and setErrors
  replaces the live arrays). All 8 forwarding sites route through one
  `forwardTypeCheckerDiagnostics()` helper. Each entry is forwarded exactly once.
- O(1) Set dedup (`seenDiagnosticKeys`), keyed `severity:start:end:message`
  (offsets — positionAt is injective for in-range offsets, so this equals the old
  range comparison; message trails so no reserved separator is needed), checked
  BEFORE computing positions. positionAt volume drops to ~2 per unique diagnostic.
- Two removal-aware integrations the old whole-array scan got for free:
  - incremental replay (`replayCleanBodyTypeDiagnostics`) registers replayed
    entries' keys so post-visit passes (resolvePendingUndefinedRefs) dedup
    against them (caught by the incremental≡full harness);
  - UC4001 phase 3 (never-returns fixpoint) deletes keys as it clears
    previously-emitted unreachable diagnostics, so its re-emission with the grown
    terminator set isn't swallowed (caught by test-cfg-terminator-initializer).

## Validation

- 315KB probe: baseline 70.3 s → 0.6 s, diagnostics byte-identical (same order).
- 86-file corpus differential (glinet + LuCI tree): identical output.
- Full suite 4,252/0 + comprehensive validation suite, both test systems.

Residual: the honest analysis core is now ~0.6 s for 315 KB — well under the
sub-2 s target that restores keystroke responsiveness with the incremental
machinery on top. The old "6.5 s stub-positionAt core" measurement was still
paying the 14.8M calls + dedup scans, so no separate positionAt batching or
line-index memoization was needed.
