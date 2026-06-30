# Division by zero (`1/0`) is typed `integer` though it yields a `double` (Infinity)

**Severity: low (wrong inference, rare).** `1/0` is `Infinity` (a double) at runtime, but the LSP types the result `integer`.

## Reproduction

```ucode
let x = 1/0;       // hover x: integer   (should be: double — Infinity)
```

Verified: `type(1/0)` → `double` (`Infinity`); `type(0/0)` → `double` (also `Infinity`, not NaN).

## Context (the LSP gets the common cases right)

ucode does **integer division** when both operands are int (`5/2` → `2` int, `10/3` → `3` int), and the LSP correctly types those `integer` and `5.0/2` `double`. The gap is specifically division by zero, where the result is always `double` regardless of operand types.

## Fix

When the divisor is a literal `0` (and operands are integers), type the result `double` (the Infinity case). Minor/rare — listed for completeness of the numeric-type modeling alongside finding 115.
