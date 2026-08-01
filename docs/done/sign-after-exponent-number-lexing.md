# Sign-after-exponent number lexing: `1e+5` false positive + new upstream hex rule

Status: **✅ SHIPPED 0.7.76 (user-tested, committed eb5a411); 0.7.77 follow-up (uncommitted)
upgraded the UC6005 to an unconditional ERROR below main** — a parse-level gate has no guard or
fallback (the target's lexer rejects the file outright), unlike the availability-gate UC6005s
that stay warnings in non-strict. `flagVersionMin` gained an optional severity override for
this class. 0.7.77 also fixed the UC6005 QUICK FIX: the server offered one unconditional
"Add ';'" for every UC6005 (built for `export-function-no-semicolon`), which mangled
`0x1e+2` into `0x1e+;2`. UC6005 diagnostics now carry `data.feature` (stamped by
`flagVersionFeature`/`flagVersionMin`) and the server dispatches per feature:
`hex-literal-sign-split` inserts spaces around the sign (`0x1e+2` → `0x1e + 2`, via the
analyzer-stamped `data.signOffset` = the AST literal's end), export-function keeps "Add ';'",
and availability gates get only the retarget command. E2e:
`tests/providers/test-hex-sign-quickfix.test.js`. `isNumericChar` now takes the
last char of the lexeme (fixing the `1e+5` false positive) and exempts `0x` literals from sign
consumption (upstream `65d41a1` rule); the analyzer's new `visitLiteral` flags UC6005 via a
direct `flagVersionMin('main', …)` call (not a `VERSION_FEATURES` entry — the message embeds
the user's own lexeme, e.g. "\`0x1e+2\` only parses on OpenWrt main/snapshot's ucode … Put a
space before the \`+\`: \`0x1e + 2\`") when a hex literal ending in `e`/`E` has a sign bonded
at `node.end`. Tests: `tests/syntax/test-lexer-number-regex-fixes.test.js`
(sign-after-exponent section) + `tests/diagnostics/test-hex-sign-split-gate.test.js`. Demo:
`zzzz/sign-after-exponent-demo.uc`. Originally filed 2026-08-01 while reviewing upstream
`3ec4e5c..81205a2`.

## TL;DR

Two intertwined problems in `src/lexer/ucodeLexer.ts` `isNumericChar` (~line 559):

1. **Our bug (matches NO ucode version):** `parseNumber` (line 536) passes the **whole
   accumulated lexeme** as `prev`, but the sign check does `prev.toLowerCase() === 'e'` — only
   true if the entire lexeme is literally `"e"`, which never happens (numbers start with a
   digit). So a `+`/`-` after an exponent `e` is **never** consumed:
   - `let sci = 1e+5;` → **UC6016 "Invalid number literal: the exponent needs at least one digit
     after the 'e'"**. Real ucode (old `/usr/local/bin/ucode` AND freshly built `81205a2`) both
     print `100000`. Active false positive on every target.
   - The doc comment on `isNumericChar` even says "prev is the last char already in the lexeme" —
     the caller violates that.

2. **Upstream rule change** (`65d41a1`, "lexer: do not consume a sign into hexadecimal number
   literals", 2026-07-04): upstream's `is_numeric_char` used to accept a sign after **any**
   `e`/`E` — including the hex digit `e` in `0x1e` — so `0x1e+2` lexed as one token and was then
   rejected: **"Invalid number literal"** on all current pins (verified with the old local
   binary). New upstream splits the token when the literal starts with `0x`: `0x1e+2` → `0x1e + 2`
   → **32** (verified with the built `81205a2` binary: `print(0x1e+2)` → `32`).

Ironically, because of bug (1) our lexer *never* consumes the sign, so today we accidentally
produce the **new** upstream behavior for `0x1e+2` (32, no diagnostic — verified via CLI) while
being wrong about `1e+5`.

## Fix

In `isNumericChar`, take the last character of the lexeme (or change the call site to pass it),
restoring decimal-exponent signs — then implement the new upstream rule: the sign is accepted
after `e`/`E` **only when the lexeme does not start with `0x`/`0X`** (mirror `65d41a1`, which
checks `buffer[0]=='0' && (buffer[1]|32)=='x'`).

## Version gating

`0x1e+2`:

| target | behavior |
|---|---|
| 22.03 / 23.05 / 24.10 / 25.12 | syntax error "Invalid number literal" |
| main (pin `b885dd0`, 2026-07-09) and master | `0x1e` `+` `2` → 32 |

**2026-08-01 update:** OpenWrt main bumped its ucode pin to `b885dd0` (2026-07-09), which
CONTAINS `65d41a1` — so `introducedIn: 'main'` is now a fact about the shipped snapshot pin,
not an optimistic model. Chosen approach: (a) lex the new way everywhere (recover) and raise a
version-gated **UC6005** on the bonded hex-sign sequence for targets below main.
`1e+5` needs **no** gating — valid everywhere; just fix the bug.

## Evidence

- `node dist/cli.js` on `let sci = 1e+5;` → UC6016 (false positive).
- `node dist/cli.js` on `let hexsum = 0x1e+2;` → no diagnostic, value path fine (accidental).
- old binary: `1e+5` → 100000; `0x1e+2` → "Invalid number literal".
- new binary (`81205a2`): `1e+5` → 100000; `0x1e+2` → 32.

## Tests

`1e+5`, `1e-5`, `1E+5`, `1.5e+3`, `0x1e+2` (split, and UC6005 on gated targets), `0X1E+2`,
`0x1e` alone, `1e5` (no sign — worked before and still must), `1e` (still UC6016), `0x` (still
error). Existing lexer number tests live wherever `classifyNumber`'s cases are covered.
