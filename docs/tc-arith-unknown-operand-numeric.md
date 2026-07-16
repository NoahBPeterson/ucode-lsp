# `-` `*` `/` `%` `**` (and unary `+`/`-`/`~`/`++`/`--`) with an `unknown` operand can soundly type `integer | double`

Status: **FIX IMPLEMENTED 2026-07-07 (uncommitted, awaiting user test).** `- * / % **` (binary and unary) on an unknown operand now soundly narrow to `integer | double`; `+` (binary and unary) deliberately stays `unknown` (deferred, per this doc's own recommendation); `~` (binary bitwise position n/a) always resolves to `integer`.

## Fix

All three over-conservative arms identified in the ticket were fixed exactly as diagnosed, with no new inference — just widening the "unknown propagates as unknown" fallback to the sound `integer | double` (or `integer` for `~`) for the operators that have no string-concat escape hatch.

- `ArithmeticTypeInference.inferNumericResultType` (`src/analysis/arithmeticTypeInference.ts`) now takes an `additionMayConcat: boolean` parameter (`inferAdditionType` passes `true`, `inferArithmeticType` passes `false`). Rule 4 (the final fallback, reached only when at least one operand is `UNKNOWN` — every other `UcodeType` combination is fully covered by Rules 1-3) returns `UcodeType.UNKNOWN` when `additionMayConcat` is true, else `createUnionType([UcodeType.INTEGER, UcodeType.DOUBLE])`.
  - `inferAdditionType`/`inferArithmeticType`/`inferNumericResultType` return types widened from `UcodeType` to `UcodeDataType` to carry the new union result.
  - `ArithmeticTypeInference.distribute` (the union-member cartesian-product helper used by both `inferAdditionFullType`/`inferArithmeticFullType`) now flattens each per-pair result via `getUnionTypes(...)` before pushing into the results array, since a single pair's result can now itself be a union — a no-op for every pre-existing single-type result.
  - **Ground truth:** `uc_vm_value_arith` (vm.c ~1627-1702) has the string-concat special case ONLY for `I_ADD`; every other opcode (`I_SUB`/`I_MUL`/`I_DIV`/`I_MOD`/`I_EXP`) runs both operands through `ucv_to_number()` unconditionally and returns an integer or double on every path (div/mod-by-zero → `Infinity`/`NaN`, still doubles) — there is no non-numeric result and no exception path.
- `TypeCompatibilityChecker.getUnaryResultType` (`src/analysis/checkers/typeCompatibility.ts`), return type widened `UcodeType` → `UcodeDataType`:
  - `+ - ++ --` on `UNKNOWN` → `createUnionType([UcodeType.INTEGER, UcodeType.DOUBLE])` (was `UNKNOWN`). **Ground truth:** `I_PLUS`/`I_MINUS` share the same switch as `I_ADD`/`I_SUB` in `uc_vm_value_arith` with no concat case, and `++`/`--` route through the same `uc_vm_insn_update_*` → `uc_vm_value_arith` dispatch as the compound-assignment operators (see the compound-assign ticket) — so the guarantee is identical to the binary non-`+` case.
  - `~` on `UNKNOWN` → `UcodeType.INTEGER` unconditionally (was `UNKNOWN`). **Ground truth:** `uc_vm_value_bitop` (vm.c:1497, dispatched from `uc_vm_value_arith` for `I_BAND`/`I_BXOR`/`I_BOR`/`I_LSHIFT`/`I_RSHIFT`) itself calls `ucv_to_number()` first — there is no operand shape, including a genuinely unknown one, that produces anything but an integer.
- Deferred (per the ticket's own recommendation): `+` (binary or unary) with an unknown operand stays `UNKNOWN` — a genuinely unknown value might still be a string, which concatenates instead of adding, so narrowing it would be a guess, not a proof.
- Test: `tests/test-tc-operator-typing.test.js` cases 12-18 (binary `- * % ** /` on an unknown param → `integer | double`; `+` stays `unknown`; `/ null` literal-divide-by-null rule unaffected) and 24-25 (unary `-`/`~` on an unknown param).
- Also updated the pre-existing `tests/inference/test-arithmetic-inference.mocha.js` fallback case `fu2` (`unknown - int`), whose expectation encoded the OLD (buggy) behavior — now asserts `integer | double`.
- Corpus: `adblock-fast/files/lib/adblock-fast/adblock-fast.uc` — 2 fewer `unknown-type` findings (724 → 722; 82.5% → 82.6%), both `task_cap` (declaration + read) from `let task_cap = +cfg.parallel_downloads;` (a unary-`+` case, ticket 3's mechanism, but the underlying unary-on-unknown widening in `getUnaryResultType` is this ticket's fix). `pbr/files/lib/pbr/pbr.uc` — no change (0 findings shifted); this ticket's main effect is on the WIDTH of an already-non-unknown union or on unary coercions, which this corpus file's flagged sites didn't happen to hit. Measured via a clean `git worktree add --detach HEAD` baseline build vs. the fixed working tree, both run against the same corpus files.

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
