# Exhaustive node-kind switches — audit + follow-ups

Status: **MOSTLY DONE** (0.7.63 follow-up). The traversal walks are now guarded; a phantom union
member was removed. Remaining work is the optional classification-switch pass (see bottom).

## What the audit found (the original premise was wrong)

The ticket assumed `TypeChecker.getChildNodes` lacked a `never` guard. It does **not** — it already
ends in `default: { const _exhaustive: never = node.type; … }` (typeChecker.ts). The real gaps were
elsewhere:

- **`BaseVisitor.dispatch` (visitor.ts)** — the base traversal that `SemanticAnalyzer extends` — had
  **no guard** and was **missing** `LogicalExpression`, `ThrowStatement` (real containers) plus the
  leaves `TemplateElement` / `JsDocComment` / `ExportAllDeclaration` / `ExportSpecifier`.
  `LogicalExpression` was a genuine oversight: structurally identical to `BinaryExpression` (which
  *was* handled), so identifiers inside `&&` / `||` / `??` were skipped by the base symbol pass.
  Benign today (the typeChecker's independent complete pass still catches undefined vars — UC1001
  fires), but a latent trap for any future subclass.
  → **FIXED:** all cases added with proper child traversal + a `never` default. Full suite
  unchanged, so no behavioral regression. Test: `tests/inference/test-visitor-exhaustiveness.test.js`.

- **Two phantom union members removed** — `DoWhileStatement` AND `LabeledStatement`:
  - **`DoWhileStatement`**: ucode has **no `do` token at all** (`lexer.c` keyword table has `while`,
    no `do`). No do-while loops exist.
  - **`LabeledStatement`**: ucode has **no statement labels**. `TK_LABEL` in the lexer is just
    ucode's *identifier* token (`parse_label` lexes any non-keyword word); `uc_compiler_compile_labelexpr`
    compiles a variable/arrow-fn, not a label. The real binary rejects `outer: while (…)` with
    "Syntax error: Unexpected token, Expecting ';'", and `break`/`continue` (`uc_compiler_compile_control`)
    take no label operand. (The separate `break LABEL;` JS-ism *is* handled — UC6010, 0.7.42 — but
    that's a `.label` field on `BreakStatement`/`ContinueStatement`, a different node.)

  Neither is constructed by any parser path or has a live producer. → **REMOVED** from `AstNodeKind`,
  compiler-guided: deleting each union member turned every consumer into a compile error
  (getChildNodes cases, `Record<AstNodeKind, …>` keys in the taint dispatch + `SCOPE_ROLE`, a
  `CONDITIONAL_CONTAINERS` set, `server.ts` comparisons, the `Statement` union + `isStatement` list,
  the `LabeledStatementNode` interface) — each removed. This is the exhaustiveness discipline working
  in reverse: deleting a union member surfaces every consumer.

- **The two `visitChildren` helpers** (`ast-validator.ts`, `fileResolver.ts`) are generic
  `Object.keys`/`for…in` walks — inherently exhaustive, no drift risk. Left as-is.

## Remaining (optional): classification switches

Several `switch (node.type)` sites are *classifications* (not child traversal), where a missing case
falls through to a safe default rather than skipping a subtree — lower risk, but they could still
drift. If we want to spread the discipline further, convert them to a `satisfies Record<AstNodeKind, …>`
(the pattern `SemanticAnalyzer` already uses for its taint dispatch and `scopeRoles.ts` uses for
`SCOPE_ROLE`), one at a time:

- `documentLinks.ts:57`, `inlayHints.ts:40`, `completion.ts` (1587/2094), `fileResolver.ts` (303/1156/2296),
  `cfg/cfgBuilder.ts:169`, `checkers/builtinValidation.ts:249`, `validations/ast-validator.ts:194`,
  `includeScope.ts:70`.

Guard rail: one switch per change; a `never` guard can surface a pile of latent cases at once.
Model: `src/ast/scopeRoles.ts`.
