# `**` with a negative exponent is a double, not an integer

**Status:** ✅ FIXED — `TypeChecker.adjustExponentiationResult` (src/analysis/typeChecker.ts)
**Found:** 2026-07 audit of the 0.7.69 compound-assign work (docs/tc-compound-assign-operator-typing.md)
**Related:** docs/tc-compound-assign-operator-typing.md, docs/tc-arith-unknown-operand-numeric.md

## The bug

`**` is the **one** arithmetic operator where two integer operands can produce a
`double`. The generic numeric-result rule (`inferNumericResultType`) types
`int op int` as `integer` for every operator, which is correct for `+ - * / %`
but **wrong for `**` with a negative exponent** — so `x ** -1` and `x **= -1`
were confidently typed `integer` when the runtime yields `0.5` (a double). Same
"silently wrong, worse than unknown" class the compound-assign ticket targeted.

## Ground truth (ucode/vm.c:1797, I_EXP, both operands integer)

```c
case I_EXP:
    if (n1 < 0 || n2 < 0) {
        if (n1 < 0 && n2 < 0) rv = ucv_double_new(-(1.0 / (double)upow64(abs64(n1), abs64(n2))));
        else if (n2 < 0)      rv = ucv_double_new( 1.0 / (double)upow64(abs64(n1), abs64(n2)));
        else                  rv = ucv_int64_new(-upow64(abs64(n1), abs64(n2)));   // base<0, exp>=0 -> int
    }
    else {
        rv = ucv_uint64_new(upow64(u1, u2));                                       // both >=0 -> int
    }
```

Key: the **exponent** sign is what determines integer-ness. `n2 < 0` → double;
`n2 >= 0` → integer *regardless of the base's sign* (`-upow64(...)` is still an
`int64`). A double operand takes the `pow(d1, d2)` path (→ double) as before.

## The fix

`adjustExponentiationResult(result, exponentNode)` post-adjusts the `**` result
based on the exponent's static sign (`numericLiteralValue`, which unwraps a
leading unary `-`), applied at both `**` sites (binary in `checkBinaryExpression`,
compound `**=` in `computeCompoundAssignmentResultType`):

| exponent | integer-base result |
|---|---|
| provably `>= 0` (literal) | `integer` (kept as-is) |
| provably `< 0` (literal)  | `double` |
| unknown sign (non-literal) | `integer \| double` |

Double-base results are already `double` and pass through untouched.

## Acceptance (tests/test-tc-operator-typing.test.js 27–31)

```ucode
let x = 2;   let r = x ** -1;   // double
let x = 2;   x **= -1;          // x -> double
let x = 2;   let r = x ** 2;    // integer  (unchanged)
function f(y){ let x=2; return x ** y; }  // integer | double
let x = 2.0; let r = x ** -1;   // double   (double base, unaffected)
```

## UC2014 — the inference is surfaced as an Information note

`**` accepts any operand (ucode coerces via `ucv_to_number`), so a *warning*
would be wrong. But the "negative exponent → double" rule is non-obvious, so the
analyzer emits an **Information**-level diagnostic (`UC2014`,
`EXPONENT_TYPE_NOTE`) explaining the result, at the two surprising cases only:

- **negative literal exponent** (result is `double`): *"A negative exponent makes
  `**` a `double` (ucode evaluates it as 1.0 / base^|exp|)."*
- **unknown-sign exponent** (result is `integer | double`): *"This `**` is
  `integer | double`: it yields a `double` when the exponent is negative, and the
  exponent's sign can't be determined here."*

Silent on the obvious cases — `x ** 2` (integer) and any double-base result.
Emitted from `SemanticAnalyzer.maybeEmitExponentiationNote` at both the binary
`**` and compound `**=` visit sites; gated on the actual result type (double, or
an integer|double union), so it never fires where the type is unremarkable.

**Note on narrowing:** the LSP tracks *types*, not integer sign/value ranges, so a
guard like `if (exp > 0) return;` does not refine `exp ** …` — and it shouldn't
here anyway, since `exp > 0` negated still includes `exp == 0` (→ integer). The
`integer | double` result is exact.

Acceptance for the note: tests/test-tc-operator-typing.test.js 32–36.
