> ✅ **FIXED 0.6.247.** UC2008 (NaN) and UC2009 (impossible comparison) now emit a **fixed Error in both modes**, independent of `'use strict'`. These are deterministic bugs (`5 + {}` is NaN, `{} == 5` is false) in every mode; strict only governs undeclared-variable access. Chosen severity: **Error** (per the #76 stance — "always-false smells like an error").
> - Ungated the 4 strict-gated sites in `typeChecker.ts`: `checkConstantComparison` (ranged-call), `type()`-never-returns, ref-eq-scalar (all UC2009), and `checkNaNArithmetic` (UC2008).
> - This also resolves an **internal** UC2009 inconsistency the original report missed: the `in`-over-scalar case (`1 in 2`) was already a fixed Error from #76 while its siblings flipped — now all UC2009 sites agree.
> - Tests updated (incompatible-comparison, index-impossible-compare, handle-method-range, hoisting-and-unary). Demo `demo-106-fixed-severity.uc`. The genuinely strict-dependent diagnostics (possibly-null deref UC5006, arg-count UC2003) keep their escalation — correctly.

# UC2008 (NaN) / UC2009 (impossible comparison) severity flips with `'use strict'`, though the bug is strict-independent

**Severity: low (severity inconsistency).** The same deterministic correctness bug is a Warning without `'use strict'` and an Error with it — but ucode's strict mode doesn't change the underlying semantics, so the gating is arbitrary.

## Reproduction

```ucode
let x = 5 + {};              // UC2008 Warning (sev 2)
```
```ucode
'use strict';
let x = 5 + {};              // UC2008 Error (sev 1)
```

Same for UC2009 (`typeChecker.ts:1174-1175, 1335-1337` gate severity on `this.strictMode`). Verified: `5 + {}` → `NaN` in **both** modes; ucode's `'use strict'` only changes undeclared-variable access, not arithmetic or comparison.

## Why it's inconsistent

`5 + {}` always produces NaN regardless of the pragma — it's a deterministic bug. Tying its severity to an unrelated directive means the identical broken expression is "just a warning" or "an error" depending on whether the file happens to declare `'use strict'`. The strict-gating is appropriate for *undeclared-variable* diagnostics (where strict genuinely changes runtime behavior), not for NaN/impossible-comparison.

## Fix

Emit UC2008/UC2009 at a fixed severity (Warning is defensible — the code runs, just wrongly), independent of strict mode.
