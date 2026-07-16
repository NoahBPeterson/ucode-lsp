# Negative array indices: wrong hover, and element typing must treat them as valid from-end access

Status: **FIX IMPLEMENTED 2026-07-07 (uncommitted, awaiting user test).** Hover now renders the sign on a genuinely-unary negative literal (`a[-1]`); the per-index literal fast paths (read + write tracking) and the new match()-tuple resolver now handle negative indices the same as positive ones.

## Fix

- **`src/hover.ts`** — scalar-literal hover branch (`TK_NUMBER`/`TK_DOUBLE`): added `isUnaryMinusContext(tokens, minusIdx)` + a `UNARY_MINUS_CONTEXT_TOKENS` set (the token types after which a following `-` MUST be unary — `(`, `[`, `,`, `=` and every compound-assignment op, comparison/logical/bitwise/arithmetic operators, `return`/`if`/`while`/`for`/`case`, `:`, `?`, `{`, `;`, statement start, …). When the token immediately before a number/double is a genuinely-unary `-`, the hover range/text extends back to include it and the decimal-value note negates (`-0x1F = -31`). A redirect at the top of the scalar-literal section also makes hovering the `-` CHARACTER ITSELF show the same combined hover (not just hovering the digit). `x - 1` (binary) is unaffected — the previous non-`-` token (`x`, an identifier) isn't in the unary-context set, so the `1` renders bare.
- **`src/analysis/typeChecker.ts`**:
  - New `arrayIndexKeyOf(propNode)` helper (used by both the per-index-assignment WRITE tracking in `checkAssignmentExpression` and the matching READ in `checkMemberExpression`): resolves a plain `Literal` property (unchanged) OR a unary-minus-wrapped literal (`arr[-1]`, parsed as `UnaryExpression`, which the old strict `property.type === 'Literal'` check silently skipped) to the same string key, so `arr[-1] = x` / `arr[-1]` round-trip through the existing per-index `propertyTypes` tracking exactly like a positive index.
  - Ground truth (`ucv_key_get`, ucode/types.c:2435-2440: `idx += length` for `|idx| <= length` before the bounds check) confirms `a[-1]` is first-class "last element" access — the general computed-array-access element-typing path (`getArrayElementType` + `computedAccessInBounds`/`numericLiteralValue`, which already unwrapped a unary minus) already gave a negative literal index the SAME `element | null` typing as a positive one; audited and confirmed no separate branch degraded it to `unknown`, and no lint singles out a negative literal index as suspicious.
  - The new match()-capture-group tuple resolver (`tryResolveTupleAccess`/`resolveTupleIndex` — see docs/tc-match-capture-group-typing.md) resolves a negative literal index (`m[-1]` = last group) through the same per-group table.
- Tests: `tests/test-tc-negative-array-index.test.js` (11 tests: hover on the digit / on the minus itself / hover range / binary-minus non-interference / exotic-literal decimal-value negation / element typing parity with `a[0]` / string-array / match()-tuple negative index / write-read round-trip / no spurious diagnostic).

## The gap

ucode supports negative array indexing — `a[-1]` is the last element. Verified:
`ucv_key_get` (ucode/types.c:2435-2440) converts a negative index with `|idx| <= length` via
`idx += ucv_array_length(scope)` before the bounds check. This is first-class semantics, used all
over the corpus (`section[-1]`, `tmpfiles[-1].write(f)` in ucode's own run_tests.uc:66-67,108,127).

Two problems today:

1. **Hover renders the wrong literal.** Hovering the index in `print(a[-1]);` shows
   `(literal) 1: integer` — the scalar-literal hover (src/hover.ts, TK_NUMBER branch) is
   token-based and the unary minus is a separate token, so the sign is silently dropped. The
   hover should render `-1` (and the decimal-value note must negate too, e.g. `-0x1F = -31`).
2. **Element typing / indexing analysis.** Verify that `a[-1]` on `array<T>` yields `T` exactly
   like `a[0]` does, that negative literal indices don't degrade to `unknown`, and that no
   range/validity lint treats a negative literal index as suspicious. (Out-of-range negative
   indices, `|idx| > length`, fall through to the object-key path and yield null — same as
   positive out-of-range; no special diagnostic warranted without known array length.)

## Root cause

- Hover: src/hover.ts scalar-literal branch reads only the number token's source text; needs a
  preceding-unary-minus check (only when the minus is genuinely unary — after an operator,
  `(`, `[`, `,`, `=`, or statement start — mirroring how the lexer/parser disambiguate).
- Typing: audit the computed-member-access paths in src/analysis/typeChecker.ts for
  literal-index handling (positive-literal fast paths may exclude negatives).

## Classification

**Solvable.** Small, mechanical; hover fix is display-only, typing fix reuses existing
element-type machinery. Occurrences: negative-index reads appear throughout the corpus
(run_tests.uc alone has 4 sites).
