# Detection gaps confirmed by the glinet audit probes

Status: **NOT STARTED — 🟡 MEDIUM PRIORITY** (three real gaps, one audit claim was wrong).
Probed 2026-08-01 against our CLI at 0.7.77
([TRIAGE-2026-08-01-glinet-fp-audit.md](TRIAGE-2026-08-01-glinet-fp-audit.md)).

## 1. Too-few arguments to a USER-DEFINED function — silent

```ucode
function two(a, b) { return a; }
two(1);            // ← no diagnostic
```

We check builtin/module signatures (UC2002-family, sprintf formats, too-many args) and
JSDoc'd functions (the 0.7.39 missing-arg diag anchored on the callee), but a plain
un-JSDoc'd user function with fewer args than params gets nothing. In ucode the missing
param is just `null` — not a crash — so this should be a WARNING, and must respect the
non-strict semantics rules (memory: NEVER infer param types from body usage; this is only
about ARITY). Rest params (`...args`) and params with `= default`… (ucode has no default
params — verify) need care; the 0.7.39 optional-JSDoc machinery already models optionality —
reuse its arity floor: required-param count = params before the first JSDoc-optional one.

## 2. Statement after `return` — UC4001 exists but does not fire

```ucode
function unr() { return 1; print("never"); }   // ← no diagnostic
```

`UcodeErrorCode.UNREACHABLE_CODE = 'UC4001'` exists (errorConstants.ts:49) and memory says
"unreachable UC4001" was built in the 0.6.x era — but the minimal same-block
statement-after-return doesn't flag at 0.7.77. Likely a casualty of the 2026-05 CFG cuts
(CFG is reachability-only now — so reachability SHOULD catch this; find where UC4001 is
emitted and why the same-block case doesn't reach it). Investigate before building anything
new — this may be a one-line reconnect rather than a feature.

## 3. Assignment in a condition — silent

```ucode
if (x = 5) { … }   // ← no diagnostic; valid ucode, classic typo for ==
```

Wants a warning ("assignment in condition — did you mean `==`? wrap in extra parens to
intend it") with the conventional `((x = 5))` opt-out. Low effort: condition-position
AssignmentExpression check in the analyzer; quick fix offers `==` or the double-paren.

## Audit claim NOT a gap (for the record)

"Null deref via out-of-bounds index (`arr[10].foo`) passes silently" — false: we emit UC5006
"may be null" (warning). Real ucode crashes with a Reference error, so an optional polish is
upgrading to a DEFINITE diagnostic when the index is a constant beyond a known literal
length (the 0.7.69 negative-index typing already knows literal lengths) — but it is detected
today.
