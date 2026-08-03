# Enhancement: narrow through user-defined boolean guard functions

Status: **NOT STARTED — 🟢 ENHANCEMENT** (not a bug — a missing analysis; ~10 nullable-arg
diagnostics in glinet upgrade.uc:222-237 alone). Found 2026-08-01
([TRIAGE-2026-08-01-glinet-fp-audit.md](TRIAGE-2026-08-01-glinet-fp-audit.md)).

## The pattern

```ucode
function check_resp_data(r) {
    return type(r) == "object" && r.code == 0 && type(r.data) == "object";  // upgrade.uc:198
}
…
let r = json_safe(body);
if (!check_resp_data(r) || !r.upgrade_available) return false;
// ← from here r is a non-null object, but we still flag every r.X as may-be-null
```

The guard's body proves `r` is an object on the true edge, but we don't propagate predicates
through user function calls, so all ~15 subsequent `r.member` reads keep their nullable
warnings. (Also note the `||` in the guard line: after `!check_resp_data(r)` is false, `r`
is narrowed for the RHS `!r.upgrade_available` too — same machinery.)

## Sketch

Same-file, single-return, pure-boolean functions whose return expression is a conjunction of
recognized narrowing predicates over a PARAMETER (type() comparisons, member truthiness,
== literals — the guard grammar the narrowing engine already evaluates inline): infer
"returns true ⇒ param narrows to <state>" and apply it at call sites used as conditions
(if/&&/||/!, ternary). This mirrors the filter()-predicate narrowing machinery
(narrowFilterElementType, 0.6.179-ish) which already re-uses guard evaluation on a callback
body — here the callee is named and called directly instead.

Scope guardrails: same-file only (cross-file via export = later), no higher-order flow, bail
on multiple returns/assignments to the param, cap predicate complexity. A JSDoc opt-in
(`@returns {boolean} narrows r to object` or TS-style `r is object`) could cover the
non-inferable cases explicitly.

## Tests

The upgrade.uc shape (0 nullable diags after the guard), negation form (`if (check(r)) { … }`),
`||`-chain form, a non-guard boolean fn (no narrowing — control), multi-return fn (bail —
control).
