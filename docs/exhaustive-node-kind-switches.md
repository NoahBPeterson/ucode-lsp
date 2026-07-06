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

## Classification switches — AUDITED, no conversion warranted

The remaining `switch (node.type)` sites were audited (2026-07-06). **None should become a total
`Record<AstNodeKind, …>` / `never`-guarded switch.** They are a categorically different kind of
switch from the ones we fixed, and forcing totality would add noise, not safety.

**The distinction that matters.** Exhaustiveness pays off only when *silently doing nothing for an
unlisted kind is a bug*:
- **Traversal** (`getChildNodes`, `BaseVisitor`) — a missing kind SKIPS A SUBTREE → silent
  incorrectness. Guard it.
- **Binding collection** (`SCOPE_ROLE`) — a missing kind FORGETS A BINDING → silent FP/FN. Guard it.
- **Classification with a meaningful default** — a missing kind gets the CORRECT conservative
  answer. Do NOT guard it: totality would force ~30 `case` labels that all resolve to the default.

Every remaining site is the third kind — the `default` is the intended, correct answer:

| site | classifies | default (correct for a new kind) |
|---|---|---|
| `documentLinks.ts:57` | which nodes carry a module-source link | no link |
| `inlayHints.ts:40` `isNonObviousInit` | is an initializer self-evident? | `true` → annotate (conservative) |
| `includeScope.ts:70` `classifyScopeValue` | scope-value → type/ident/require | `{ kind: 'unknown' }` |
| `cfg/cfgBuilder.ts:169` `visitNode` | dispatch control-flow nodes | `addStatement` (opaque) — see note ⚠ |
| `checkers/builtinValidation.ts:249` `coerceArgNeedsParens` | operators looser-binding than `+` | `false` |
| `validations/ast-validator.ts:194` | per-kind structural invariants | no check |
| `completion.ts:1587` `inferDefaultExportPropertyType` | value → completion label kind | `'property'` |
| `completion.ts:2094` | member → completion item kind | conservative default |

For most of these the `default` is provably right (a leaf/import/expression carries no link, no
control flow, a conservative label). Two were verified by *enumerating* the fall-through kinds, not
by inspection:

- **`coerceArgNeedsParens`** — provably safe: the only operators binding looser than `+`
  (comparison/equality = `BinaryExpression`, logical = `LogicalExpression`, ternary =
  `ConditionalExpression`, assignment) are all cased; everything else binds tighter or isn't an
  operator, so `false` (no parens) is correct. It even over-parenthesizes `a * b` harmlessly (extra
  parens never change meaning), so it can only ever be conservative.
- ⚠ **`cfgBuilder.visitNode`** — enumeration found a REAL gap. It cases every control-flow *statement*
  kind, but a terminator call buried in a **`VariableDeclaration` init** (`let x = die(); …`) falls
  to the opaque default, so the following code is wrongly considered reachable (confirmed: no UC4001,
  vs. `die();` as a statement which IS flagged). **This is NOT an exhaustiveness bug** — adding
  `case 'VariableDeclaration': this.addStatement(node)` behaves identically to the default. The fix
  is a CFG feature (recurse a declaration/assignment init for terminator calls). Filed separately →
  `docs/cfg-terminator-in-initializer.md`.

Converting any of these to a total `Record<AstNodeKind, …>` would be cargo-culting: it adds ~30
no-op `case` labels and fixes nothing (the `cfgBuilder` gap included).

**One real (tiny) drift risk, unrelated to totality — FIXED.** `coerceArgNeedsParens`
(builtinValidation) was a hand-copy of `TypeChecker.needsParensForAddition` — two identical
4-operator switches that had to agree or a `"" + (arg)` quick-fix could mis-parenthesize. Deduplicated:
`coerceArgNeedsParens` is now `export`ed as the single source and `TypeChecker` imports it (the copy
is deleted). Not a `Record<AstNodeKind>` — just one shared helper.

**Conclusion:** the exhaustive-node-kind-switch work is complete. `getChildNodes` and `BaseVisitor`
are guarded; `SCOPE_ROLE` is total; two phantoms removed. The classifiers are intentionally partial.
