# "is unknown" mislabels a value that actually has a known *nullable* type

**Severity: low (wrong message + wrong remedy).** A diagnostic says an argument "is unknown" when the value's type is actually a known nullable union (e.g. `object | null`) — which has its own dedicated "may be null" message and a different fix.

## Reproduction

```ucode
let a = json("x");          // a : object | null  (a KNOWN type)
let b = substr(a, 1);       // "Argument 1 of substr() is unknown. Use a type guard to narrow to string."
```

`json()` returns `object | null`, not `unknown`. The real problem is the `null` branch, not "unknown-ness", and the suggested remedy ("narrow to string") is for the wrong situation — `a` is an object-or-null, which can never be narrowed to `string`, so the message is doubly misleading.

## Why it happens

The arg-validation path reports "is unknown" for any type it can't directly satisfy, conflating genuine `unknown` with a concrete nullable union. The "may be null" message exists for exactly this case but isn't selected here.

## Fix

When the argument type is a known union containing `null` (not literally `unknown`), use the "may be null" wording/code; reserve "is unknown" for genuinely unknown values. (Relates to findings 13 and 107.)

---

## Resolution (2026-07-06, v0.7.67 triage): premise disproven — closed as not-a-bug

`json()` returning `UNKNOWN` is correct: `uc_json` (ucode/lib.c) returns `ucv_from_json`,
which can be ANY JSON value kind (string/number/bool/array/object/null), not `object | null`.
Modeling it as a nullable union would drop the non-null scalar kinds. The "is unknown"
wording is therefore accurate for this callsite. The related message-clarity complaint was
fixed separately via ticket 13 (json argument messages now null-aware).
