> ✅ **FIXED 0.6.245.** Every emitted diagnostic now carries a stable `code`. Reused existing
> registry codes; minted one new code `UC2010` (NOT_CALLABLE) for "Cannot call X as function".
> - **typeChecker** (13 sites): undefined function → `UC1002`; not-callable → `UC2010`; arg-count → `UC2003`; `in`-over-scalar always-false → `UC2009`; bitwise-on-bad-types → `UC2002`; method-not-found → `UC5004`; property-not-found (array/string/regex/bool/int/nl80211·rtnl const) → `UC5003`.
> - **builtinValidation**: arg-count (require/include/loadfile/loadstring/render/at-least) → `UC2003`; arg-type/value (exists, signal, regex flags, wildcard, ParseConfig options, gc command, `pushTypeMismatch`) → `UC2004`; assert-always-fail → `UC2002`.
> - **parser**: codes now flow through the 3 central helpers (`error`/`errorAt`/`warningAt`, default umbrella `UC6001`); the 10 missing-semicolon sites pass `UC6003`. `server.ts` + `cli.ts` parser-error mappings now copy `err.code` (fallback `UC6001`) — they were dropping it entirely.
> - Several previously-dead registry codes from finding 104 (UC5003/UC5004/UC6003/UC2002…) are now live as a result.
> - Tests: `tests/test-diagnostic-codes-systemic.test.js` (10), incl. the invariant "no diagnostic ships un-coded".

# Systemic: the entire type / semantic / parser diagnostic surface ships with **no diagnostic code**

**Severity: medium (systemic quality).** Most user-facing diagnostics from `typeChecker.ts`, `checkers/builtinValidation.ts`, and the parser carry **no `code` field**, so they can't be suppressed-by-code, doc-linked, or filtered. Whether a diagnostic has a `UC####` code depends on which subsystem emitted it, not on any principle.

## Confirmed un-coded categories (each reproducible)

- **Undefined function**: `n();` → `Undefined function: n` (typeChecker.ts:1771)
- **Argument-type mismatch**: `match(1,2);` → `Function 'match' expects string for argument 1, but got integer` (builtinValidation.ts:274/366)
- **Argument-count**: `substr("x");` → `Function 'substr' expects at least 2 argument(s), got 1` (typeChecker.ts:1965/1972)
- **Member access on non-objects**: `[1].foo`, `"x".length`, `5.x()`, `/r/.x` → `Property 'foo' does not exist on array type …` (typeChecker.ts:2449/2494/2523/2695/2726/2743/2757)
- **`in` operator**: `1 in 2` → `'in' operator requires object or array on right side, got integer` (typeChecker.ts:1388)
- **Non-callable**: `Cannot call X as function` (typeChecker.ts:1853)
- **Bitwise-on-bad-types** warning (817); **signal** number/name (builtinValidation 1165/1171); **json** arg (1130)
- **All parser errors** — `Expected ';'`, `Unexpected token in expression`, `Expected function name`, … — never set a code (`parserUtils.ts:141-159`)

Coded diagnostics are essentially limited to UC1001/1003/1006/1009, UC2003/2006/2007/2008/2009, UC3xxx, UC7xxx, and the string-codes `nullable-argument` / `incompatible-function-argument`.

## Root cause

`addDiagnostic`/`addDiagnosticErrorCode` in `semanticAnalyzer.ts` carry codes, but the `typeChecker`/`builtinValidation` paths push plain `errors.push({...})` objects where `code` is optional and usually omitted. The split is by subsystem.

## Why it matters

No code ⇒ no per-rule suppression, no "quick fix → disable this rule", no documentation hyperlink, no client-side filtering/grouping, and inconsistent UX (some squiggles are `UC2008`, the one right next to it is anonymous). See also findings 104 (the *correct* codes for these already exist but are dead) and 107 (the most-severe arg diagnostic is the un-coded one).

## Fix

Give every emitted diagnostic a stable `code`. The natural codes already exist in `errorConstants.ts` (UC5003/5004 for member access, UC6003 for missing semicolon, etc. — see finding 104); wire the typeChecker/builtin/parser paths to set them.
