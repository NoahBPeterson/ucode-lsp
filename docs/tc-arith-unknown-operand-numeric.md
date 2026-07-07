# `-` `*` `/` `%` `**` (and unary `+`/`-`/`~`/`++`/`--`) with an `unknown` operand can soundly type `integer | double`

Status: **NOT STARTED.** Filed 2026-07-07 from the --type-coverage audit.

## The gap

Non-addition arithmetic in ucode **always** produces a number, no matter what the operands are.
Verified in the vendored C (`ucode/vm.c` `uc_vm_value_arith`, :1627): only `I_ADD` has the
string-concatenation early-out; every other operation runs both operands through
`ucv_to_number()` — which yields an integer, a double, or NULL→`NaN` (a **double**) — and then
returns an integer or double result on every switch arm (div-by-zero → `INFINITY`, still
double). There is no exception path and no non-numeric result. The same holds for unary
`+`/`-` (`I_PLUS`/`I_MINUS` in the same switch — no concat case), for `++`/`--` (the
`uc_vm_insn_update_*` handlers route through `uc_vm_value_arith`), and `~`/bitops always
produce an integer (`uc_vm_value_bitop`).

The checker instead propagates `unknown`:

```ucode
function f(u) {
    let c = u - 1;   // shows `unknown` — can only ever be integer | double
    let d = u * 2;   // shows `unknown` — integer | double
    let e = u % 3;   // shows `unknown` — integer | double
    let a = 'x' + u; // already correctly `string` (concat rule handles it)
    let b = u + 1;   // `unknown` — sound narrowing exists too: string | integer | double
}
```

Real corpus instances feeding the audit's `decl-from-expr`/`assign-target`/`other-read`
buckets:

```ucode
// adblock-fast/tests/lib/mocklib/uci.uc:15 — h flips to unknown on first iteration
h = h * 31 + byte(s, i);            // byte() is a local fn returning unknown
// firewall4/root/usr/share/ucode/fw4.uc:209 (bits: unknown param)
bits -= b;                           // integer | double, shown unknown (also needs the compound-assign ticket)
// payload_processor_ucode/generators/bandwidth.uc:117
const rxpk = (a) ? (b.rx_packets - a.rx_packets) : 0;   // shows `integer | unknown`; the
                                                          // subtraction arm is integer|double
```

And the unary flavor — this composes with `docs/tc-unary-operator-union-collapse.md` (union
operands) but is a distinct rule (a genuinely `unknown` operand, not a known union):

```ucode
// firewall4 fw4.uc:1224 idiom when the operand ISN'T a known string:
let sindex = +extended[2];          // extended[2] unknown → shows unknown; always integer|double
let n = ~u;                          // shows unknown; ALWAYS integer
```

## Root cause

Three deliberate-looking but over-conservative `unknown → unknown` arms:

1. `ArithmeticTypeInference.inferNumericResultType` Rule 4
   (`src/analysis/arithmeticTypeInference.ts:112-116`): "an UNKNOWN operand … propagates as
   UNKNOWN rather than guessing." For `+` that's right in spirit (concat possible — though
   `string | integer | double` would still be sound); for `-`/`*`/`/`/`%`/`**` it isn't a guess
   — the C guarantees a numeric result.
2. `getUnaryResultType` (`src/analysis/checkers/typeCompatibility.ts:37`):
   `if (operandType === UNKNOWN) return UNKNOWN;` for `+ - ++ --` — but the very next lines
   enumerate that *every* concrete type maps to integer or double, so unknown must too
   (`integer | double`).
3. Same function's `~` arm (:52): the comment says "`~null`, `~"x"`, `~[1]`, `~{}` all yield an
   integer … Only a genuinely unknown operand stays unknown" — internally inconsistent: if every
   concrete operand yields integer, an unknown operand's result is still integer.

## Proposed approach

- Rule 4 split: in `inferNumericResultType`, thread the operator (or add a boolean
  "additionMayConcat") — for non-`+` operations, an UNKNOWN operand returns
  `createUnionType([INTEGER, DOUBLE])` instead of UNKNOWN. (`inferNumericResultType` currently
  returns a bare `UcodeType`; either widen its return to `UcodeDataType` or handle the unknown
  case one level up in `inferArithmeticType`, which the union-`distribute` already maps over.)
- `getUnaryResultType`: `+ - ++ --` on UNKNOWN → `integer | double`; `~` on UNKNOWN → `integer`.
  Same return-type widening consideration (callers currently take `UcodeType`; the
  `checkUnaryExpression` call site at `typeChecker.ts:1084` returns a `CheckResult` =
  `UcodeDataType`, so widening flows through naturally).
- **Decide separately** whether `unknown + X` (X non-string) should become
  `string | integer | double` — sound, but a wide 3-member union on very common code; interacts
  with the open `T | unknown` display-convention question
  (`docs/auto-docs/113-union-with-unknown-not-collapsed.md`). Recommend shipping the non-`+`
  operators first and deferring `+`.

Watch item: `integer | double` collapsing through `dataTypeToBase` is UNKNOWN (unions have no
single base), so downstream base-only consumers behave exactly as today — strictly less risk of
regression, but also means the payoff is in hover/union-aware paths, not base-type checks.

## Classification

**Solvable** (the non-`+` binary and unary cases; C-source-verified, no guessing).
**Partially solvable** for `+` (sound narrowing exists but is a product/display decision).

**Occurrence estimate:** ~22 `= +unary` assign-targets + ~30 `+m[..]`-style decl-from-expr in
the audit, plus the subtraction/multiplication sites inside the 2,771-strong `other-read`
bucket (reads of variables like `h`, `bits`, `n` that went unknown through one of these
operators) — order of a few hundred occurrences once downstream reads are counted. Independent
of the upstream root causes: even with a permanently-unknown operand, the operator alone
determines a sound numeric result type.
