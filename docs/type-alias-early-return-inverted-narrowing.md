# `let t = type(x)` alias narrowing keeps the RETURNED arms after an early return

Status: **NOT STARTED — 🟡 MEDIUM PRIORITY** (hard-error UC2004 FPs on a canonical
validation idiom). Found 2026-08-01 via the glinet audit
([TRIAGE-2026-08-01-glinet-fp-audit.md](TRIAGE-2026-08-01-glinet-fp-audit.md),
firewall.uc:88,110).

## Minimal repro (confirmed at 0.7.77)

```ucode
function pcheck(port) {
    let t = type(port);
    if (t == "int" || t == "double") return true;
    if (t != "string" || match(port, /^0/)) return false;   // ← UC2004: match got integer|double
    return true;
}
```

`UC2004: Function 'match' expects string for argument 1, got integer | double` — exactly the
two arms that ALREADY RETURNED on the previous line. Correct narrowing at the `match(port,…)`
call site:

1. after `if (t == "int" || t == "double") return`, the false-edge removes int and double;
2. `t != "string" || match(...)` — the RHS of `||` only evaluates when `t != "string"` is
   false, i.e. `t == "string"`, so `port` is exactly `string` there.

We appear to compute the TRUE-edge narrowing of the first guard (int|double) and leak it past
the `return` into the next statement — an inverted edge, or the back-propagation from the
`t`-alias (transitive type() narrowing, 0.6.11) joining the wrong branch state after the
early return.

Both real-file sites (`is_valid_clean_port`, `is_valid_port`) are this exact pattern.

## Tests

Repro above → 0 diagnostics; hover on `port` at the match() call shows `string`; variants:
early-return with `else`, `t === "int"` strict form, guard via `type(port)` inline (no alias
— presumably already works, keep as control), and a true positive control
(`if (t == "string") return; match(port, …)` SHOULD flag non-string).
