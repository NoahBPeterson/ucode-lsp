# Assignment in a ternary *alternate* is falsely rejected ("Invalid assignment target")

**Severity: low-medium (false positive, parser).** An assignment expression in the `else` branch of a ternary is valid ucode but the parser rejects it; the `then` branch works.

## Reproduction

```ucode
let c;
let v = false ? 0 : c = 9;     // ERROR "Invalid assignment target"
```

Verified: `false ? 0 : c = 9` → prints `9`, `c` becomes `9`, exit 0. The consequent form `true ? c = 1 : 2` is clean; parenthesizing (`: (c = 9)`) also clears it.

## Root cause

`parseConditional` (`src/parser/expressions/callExpressions.ts:65`) parses the alternate with `parseExpression(Precedence.CONDITIONAL)`. Assignment is *lower* precedence (`ASSIGNMENT = 2 < CONDITIONAL = 3`), so `= 9` is left for an outer assignment parse, which then sees `(ternary) = 9` → "Invalid assignment target". The consequent (line 60) correctly uses `ASSIGNMENT`.

## Fix

Parse the ternary alternate at `Precedence.ASSIGNMENT` (one-line change at `callExpressions.ts:65`).
