# Compound assignment (`+=`, `-=`, `??=`, `||=`, …) types the target as the bare RHS — wrong types, not just unknowns

Status: **FIX IMPLEMENTED 2026-07-07 (uncommitted, awaiting user test).** `x op= y` now types as `typeof(x_old op y)` for every compound operator, routed through the existing union-aware binary-operator inference.

## Fix

- `TypeChecker.checkAssignmentExpression` (`src/analysis/typeChecker.ts`) now captures `leftType = this.checkNode(node.left)` (previously discarded) and, for `node.operator !== '='`, returns `computeCompoundAssignmentResultType(operator, leftType, rightType, node)` instead of the bare `rightType`. That new private method dispatches:
  - `+=` → `arithmeticTypeInference.inferAdditionFullType(leftType, rightType)`
  - `-= *= /= %= **=` → the same string-coercion + literal-zero-division handling `checkBinaryExpression` uses, then `arithmeticTypeInference.inferArithmeticFullType(leftType, rightType, baseOp)`
  - `&= |= ^= <<= >>=` → `typeCompatibility.getBitwiseResultType()` (always integer)
  - `??=` → a new shared helper `computeNullishCoalescingResult` (extracted verbatim from the binary `??` case, which now also calls it)
  - `||=` / `&&=` → `logicalTypeInference.inferLogicalOrFullType` / `inferLogicalAndFullType`
  - **Ground truth (vm.c):** every non-short-circuit update opcode (`uc_vm_insn_update_var`/`_upval`/`_local`/`_val`, vm.c:1862/1917/1940/1884) calls `uc_vm_value_arith(vm, vm->arg.u32 >> 24, val, inc)` — the exact same dispatch the binary `I_ADD`/`I_SUB`/… instructions use. So `x op= y` IS `x = x op y` for every arithmetic/bitwise operator.
  - **Ground truth (compiler.c) for `??=`/`||=`/`&&=`:** `uc_compiler_compile_nullish_assignment`/`_or_assignment`/`_and_assignment` (compiler.c:1335-1413) compile to "if the short-circuit condition holds, result is the UNCHANGED left value (no assignment); else assign left = right (result is right)" — precisely the same result-type shape as the binary `??`/`||`/`&&` operators, so reusing their inference is exact, not an approximation.
- `SemanticAnalyzer.visitAssignmentExpression` (`src/analysis/semanticAnalyzer.ts`) is the path that ACTUALLY drives hover/SSA for a top-level `x op= y;` statement (it decomposes into `checkNode(node.left)`/`checkNode(node.right)` rather than calling `checkNode(node)` on the whole assignment — so `checkAssignmentExpression` alone never fixed the primary bug). It now captures `leftTypeForCompoundOp` from the existing `checkNode(node.left)` call, and after computing the RHS-based `dataType` through its existing fs/method/function-return priority chain, applies `dataType = this.typeChecker.computeAssignmentResultType(node, leftTypeForCompoundOp, dataType)` for any non-`=` operator (a new public wrapper on `TypeChecker`, added specifically so semanticAnalyzer doesn't need a second, diagnostic-duplicating `checkNode(node)` pass). This is the change that fixes the `s += 1` → `string` hover bug.
- `computeAssignmentResultType` also caches its result onto the `AssignmentExpressionNode` itself (`this.nodeTypes.set(node, result)`), because a top-level compound-assign statement never otherwise gets an entry in that cache — needed so `getTypeOf`/`nodeTypeForFlow` (used by the flow engine) can see it.
- `flowTypeEngine.ts`'s `makeAssignmentTransfer` no longer requires `expr.operator === '='` to update its environment; for a compound operator it now reads `typeOf(expr)` (the whole assignment's cached type, populated by the point above) instead of leaving the flow env holding the stale pre-assignment type.
- **Known remaining gap:** property-write compound assignment (`obj.prop += 1`, `this.prop -= 1`, `global.X.prop ??= 1`) still routes through `inferAssignmentDataType(node.right)` (RHS-only) — only the bare-identifier/parameter path (the ticket's repro) was fixed. Filed as follow-up, not blocking.
- Test: `tests/test-tc-operator-typing.test.js` (new, 26 cases, all passing) — cases 01-11 cover every compound operator, including the ticket's exact repros (`s += 1` → `string`, `d -= 1` → `double`, `x ??= 5` → `string | integer`, plus `||=`/`&&=`/bitwise/literal-zero-division/unknown-operand compound cases).
- Corpus: adblock-fast/pbr coverage deltas are near-zero (the coverage tool only counts genuinely `unknown`-shown hovers; this bug's main damage — silent WRONG types like `string`→`integer` — is invisible to that specific audit, exactly as the ticket predicted). The unary/arith-unknown fixes (tickets 2/3) are what moved the corpus numbers; see those tickets' Fix sections.

## The gap

Every compound assignment is typed as if it were a plain `=`: the target's new type is set to
the type of the **right-hand side alone**, ignoring the operator. `x op= y` is `x = x op y`
in ucode (the update opcodes route through the same `uc_vm_value_arith` as the binary
operators — vendored `ucode/vm.c` `uc_vm_insn_update_local`/`update_upval`/`update_var`
all call `uc_vm_value_arith(vm, insn>>24, val, inc)`), so the correct type is
`typeof(x_old op y)`.

Minimal repro (verified against the interpreter, and via the real `handleHover` path):

```ucode
let s = "x";
s += 1;        // hover s: `integer`  — runtime: "x1" → STRING (concat)
let d = 1.5;
d -= 1;        // hover d: `integer`  — runtime: 0.5 → DOUBLE

function f(param) {
    let x = param ? "s" : null;  // string | null
    x ??= 5;                     // hover x: `integer` — correct: string | integer
    let y = "hello";
    y ||= 42;                    // hover y: `integer` — correct: string
}
```

These are **false types**, strictly worse than `unknown` — every downstream narrowing,
UC5004/arg-type check, and hover trusts them. The audit surfaced the unknown-producing half
(`n += unknownParam` → `unknown` in the `assign-target` signature, ~46 compound-op sites among
the flagged occurrences; ~296 compound-assign sites corpus-wide), but the mistyping half is
silent and worse.

Real corpus instances:

```ucode
// firewall4/tests/lib/mocklib.uc:106-117 — rv is a string accumulator
rv += sprintf("%s %J: %s", ...);   // ok by luck (sprintf → string)
// firewall4/root/usr/share/ucode/fw4.uc:209 — bits: unknown param
bits -= b;                          // shows unknown; `-` ALWAYS yields integer|double (see below)
// adblock-fast/tests/lib/mocklib/uci.uc:15
h = h * 31 + byte(s, i);            // plain =, same family: h flips to unknown
// luci-app-dockerman docker_rpc.uc:43 — buffer: string accumulator
buffer += data;                     // buffer takes data's type instead of string-concat result
```

## Root cause

Two engines, both operator-blind:

1. `TypeChecker.checkAssignmentExpression` (`src/analysis/typeChecker.ts:3896`) ends with
   `return rightType;` (line ~3936) for **every** operator — the expression's own result type
   is the bare RHS.
2. `SemanticAnalyzer.visitAssignmentExpression` (`src/analysis/semanticAnalyzer.ts:5332`)
   computes `dataType` from the RHS only (`rhsCheckedType` at ~5494, applied at ~5558-5599 via
   `symbol.currentType` / `recordTypeHistory`) with no `node.operator` consultation — so the
   SSA type history that hover reads records the RHS type as the variable's new type.
3. `makeAssignmentTransfer` (`src/analysis/flowTypeEngine.ts:76`) only handles
   `expr.operator === '='` — compound assignments are invisible to the flow env (it keeps the
   stale pre-assignment type; mostly masked because hover prefers the SSA history).

All of the machinery to compute the correct result already exists — it's the binary-operator
inference: `arithmeticTypeInference.inferAdditionFullType` / `inferArithmeticFullType`
(union-aware, `src/analysis/arithmeticTypeInference.ts:30,38`), the `??` handling in
`checkBinaryExpression` (`typeChecker.ts:988-1021`), `logicalTypeInference.inferLogicalOr/AndFullType`
(`typeChecker.ts:1029-1031`), and the bitop rules. Nothing routes compound assignment through them.

## Proposed approach

In `checkAssignmentExpression`, when `node.operator !== '='`, compute the result as the
corresponding binary operation of `leftType` (already checked at line 3899, currently
discarded) and `rightType`:

- `+=` → `inferAdditionFullType(leftType, rightType)`
- `-= *= /= %= **=` → `inferArithmeticFullType(leftType, rightType, op)`
  (plus the existing literal-zero `/`/`%` → double special case if cheap to share)
- `??=` → the `??` result-type logic (extract the `case '??'` body into a helper and share)
- `||=` / `&&=` → `logicalTypeInference.inferLogicalOrFullType` / `AndFullType`
- `&= |= ^= <<= >>=` → the bitwise result (integer, per the existing `~`/bitop rules)

Return that instead of `rightType`. Then in `visitAssignmentExpression`, use the same computed
result (it already captures `rhsCheckedType = this.typeChecker.checkNode(node.right)`; for
compound ops it should instead capture `this.typeChecker.getTypeOf(node)` / the assignment
expression's own checked result) for `symbol.currentType`/`recordTypeHistory`. Optionally teach
`makeAssignmentTransfer` the same rule (or at minimum make compound assignment invalidate the
stale env entry instead of silently keeping it).

The NaN-lint (`checkNaNArithmetic`) that fires for binary arithmetic should probably also fire
for `arr += 1`-style compound assigns while in there — same operator table.

## Classification

**Solvable.** All result-type rules already exist and are union-aware; this is routing, not new
inference. Main risk is the `visitAssignmentExpression` plumbing (several branches set
`dataType`), and tests asserting the current (wrong) behavior.

**Occurrence estimate:** ~296 compound-assignment sites corpus-wide. ~46 currently flagged
`unknown` in the audit's `assign-target` bucket (`+=` 29, `??=` 6, `-=` 4, `|=` 3, others 4)
plus their downstream reads. The larger payoff is the silent wrong-type half (every
string/double accumulator typed `integer`), which the audit can't see because the displayed
type contains no `unknown`. Independent of the four upstream root causes: the inputs
(`s: string`, `d: double`, `x: string | null`) are fully known; the operator handling itself
drops/corrupts them.
