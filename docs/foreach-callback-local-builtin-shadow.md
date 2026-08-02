# Block-scoped `let` named after a builtin: comparison lint resolves the BUILTIN (`proto` → `function`)

Status: **IMPLEMENTED 0.7.82 (uncommitted, awaiting user test).** checkIdentifier
(typeChecker.ts) now resolves position-aware (`lookupAtPosition ?? lookup`), matching hover —
the stale post-visit re-check of if-statements can no longer miss a block-scoped local and
fall through to the builtin registry. Corpus differential: exactly the 3 lan.uc FPs removed,
zero other changes across 57 glinet files; also fixes the double-diagnostic on true positives
(one `array` + one `function` at the same spot → one correct `array`). Tests:
tests/diagnostics/test-block-scoped-builtin-shadow.test.js (9). Found 2026-08-01 via the
glinet audit ([TRIAGE-2026-08-01-glinet-fp-audit.md](TRIAGE-2026-08-01-glinet-fp-audit.md),
lan.uc:161-162).

## 2026-08-01 REDUCTION — the original diagnosis was wrong

The uci typed-callback theory does NOT hold. The original minimal repro (flat `let proto`
directly in a `c.foreach` callback body) no longer fires at 0.7.81, but the real lan.uc
still does — and bisecting the shape shows **uci and callbacks are both red herrings**.

## True minimal repro (confirmed at 0.7.81, demo: zzzz/callback-builtin-shadow-demo.uc)

```ucode
if (true) {
    let proto = sprintf("%d", 1);
    if (proto != "dhcpv6")          // UC2009: `function` can never be != "dhcpv6"
        print(proto, "\n");         // real ucode RUNS this: prints "1"
}
```

Top level, no function, no module. The trigger is exactly:

1. a `let` whose name collides with a builtin (`proto`, `index`, …), AND
2. the declaration sits inside a NESTED BLOCK (an if-body block; callback bodies with a
   further nested block reproduce identically — that's the glinet shape), AND
3. the variable is compared (`==`/`!=`) afterwards.

Probe matrix:

| shape | fires? |
|---|---|
| `if (true) { let proto = <string>; if (proto != "x") … }` top-level | ❌ FP |
| same inside a `map`/`c.foreach` callback (glinet lan.uc shape) | ❌ FP |
| same with `let index` instead of `proto` | ❌ FP |
| same with a NON-builtin name (`let myvar`) | ok |
| flat `let proto` directly in a callback/function body (no nested block) | ok |
| bare `{ let proto = …; }` block (no `if`) | ok — plain blocks don't trigger |

## The smoking gun: hover disagrees with the lint

On the SAME identifier at the SAME position, hover says `string` (correct — it uses the
symbol table's `lookupAtPosition`), while UC2009 claims `function`. So the block-scoped
symbol IS in the table and findable; it is the TYPE CHECKER's own identifier resolution
(the path feeding the comparison lint) that misses block scopes under an if-statement and
falls back to the builtin registry (`proto()` → `function`).

## Why the LSP is wrong (oracle-verified, /usr/local/bin/ucode AND master build)

ucode is lexically scoped; a `let` always shadows a builtin within its block. Both oracles
print "1" for the minimal repro — the "always true" comparison runs on the string. The
real lan.uc compiles and its comparisons run on the uci string value.

The existing shadowed-builtin soundness work (0.6.146) covers module-level shadowing; a
"shadows a builtin" warning here may also be reasonable — but resolution must follow the
local, as ucode itself does.

## Tests

- Minimal repro → 0 UC2009; hover AND the lint agree on `string`.
- glinet lan.uc shape (nested if-block inside a foreach callback) → 0 UC2009 (currently 3).
- Other builtin names as block locals (`index`, `length`, `match`) → clean.
- Non-builtin name control stays clean; flat-in-callback control stays clean.
- Genuine builtin comparison stays flagged: `if (proto == "x")` with NO local declaration
  (the builtin really can never equal a string).
- uci.foreach param inference (`s` typing) unaffected.
