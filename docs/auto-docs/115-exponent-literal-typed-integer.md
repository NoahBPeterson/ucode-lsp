# Exponent-notation literals (`1e5`) are typed `integer` instead of `double`

**Severity: low-medium (wrong inference).** A literal written in exponent notation is always a `double` in ucode, but the analyzer re-derives its type from the numeric value and mistypes integer-valued ones as `integer`.

## Reproduction

```ucode
let x = 1e5;       // hover x: integer   (should be: double)
```

Also `2e3`, `2.5e3`, `1e308`. Verified: `type(1e5)` → `double`, `type(2.5e3)` → `double`.

## Root cause

The lexer correctly emits `TK_DOUBLE` and the parser sets `literalType: 'double'` (`parseRules.ts:38-39`), but the analyzer ignores that and re-derives the type with `Number.isInteger(literal.value)`. Since `parseFloat("1e5") === 100000` is integer-valued, it's mistyped. Sites: `semanticAnalyzer.ts:453`, `:3156`; `fileResolver.ts:780-781, 1555, 1678, 1907`. (`1.5e0` happens to work only because its value is non-integer.)

## Why it matters

`integer` vs `double` propagates into arithmetic-result typing, NaN analysis, and any builtin that distinguishes them. A `1e9`-style constant (common for sizes/timeouts) is silently the wrong type.

## Fix

Prefer `literalType === 'double'` (from the parser) before falling back to the `Number.isInteger(value)` heuristic, at all the listed sites.
