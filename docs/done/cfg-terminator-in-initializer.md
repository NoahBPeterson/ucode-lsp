# CFG misses a terminator call inside a declaration/assignment initializer

Status: ✅ **FIXED 0.7.65.** `cfgBuilder.visitNode` now cuts the flow for a direct terminator call in
a `VariableDeclaration` init (`let x = die();`) and as an assignment RHS (`x = die();`), via a shared
`isTerminatorCall` + `cutToExit` helper. Conservative — only the DIRECT unconditional form (not
`cond ? die() : y` / `y || die()`, where a cut would be a false "unreachable"). 5 e2e tests
(`tests/diagnostics/test-cfg-terminator-initializer.test.js`). Found 2026-07-06 while enumerating
`cfgBuilder.visitNode` fall-through kinds during the exhaustive-node-kind-switch audit (see
`docs/exhaustive-node-kind-switches.md`).

## Symptom

Code after a variable declaration whose initializer *is* (or contains) a terminator call is not
flagged unreachable:

```ucode
function f() {
    die("boom");       // ← as a statement: UC4001 on the next line ✓
    print("after");
}

function g() {
    let x = die("boom");   // ← as a var-init: NOT flagged ✗
    print("after");        //   this is genuinely unreachable (die throws before assigning x)
}
```

`die()` (and other terminators — the `terminatorNames` set) throws, so `print("after")` in `g()` is
unreachable, exactly as in `f()`. But the LSP flags only `f()`.

## Cause

`cfgBuilder.visitNode` (`src/analysis/cfg/cfgBuilder.ts`) special-cases terminator calls only in the
`ExpressionStatement` branch:

```ts
case 'ExpressionStatement': {
    this.addStatement(node);
    if (exprStmt.expression.type === 'CallExpression') {
        const call = exprStmt.expression as CallExpressionNode;
        const calleeName = ...;
        if (calleeName && this.terminatorNames.has(calleeName)) {
            this.connect(this.currentBlock, this.cfg.exit);   // cut the CFG here
            ...
        }
    }
}
```

A `VariableDeclaration` (and a bare `AssignmentExpression`, and a terminator nested in a `return`
argument, `&&`/`||`, ternary, etc.) falls to `default: this.addStatement(node)` — opaque, so the
terminator-cuts-the-flow edge is never added.

**Not an exhaustiveness issue.** The `visitNode` switch already handles every control-flow statement
kind; making it total (`case 'VariableDeclaration': addStatement`) is a no-op vs. the default.

## Fix sketch

Factor the "does this expression definitely terminate?" check out of the `ExpressionStatement` branch
into a small helper, and consult it wherever an expression is evaluated for effect:
- `VariableDeclaration` — each declarator's `init`.
- bare `AssignmentExpression` right-hand side.
- (optionally) a terminator as the last operand of `&&`/`||`, a ternary arm, or a `return` argument —
  though these are rarer; scope to declaration/assignment inits first.

Guard: keep it conservative — only cut the flow when the call PROVABLY terminates (callee name in
`terminatorNames`, not behind a `?.` or in a non-taken branch). A missed cut (current behavior) is a
false negative; a wrong cut would be a false "unreachable" positive, which is worse.

## Test

- `let x = die(); print(y);` → UC4001 on `print` (currently missing).
- `let x = f();  print(y);` (non-terminator) → NOT flagged (regression guard).
- Parity with the existing `die();` statement-position test.
