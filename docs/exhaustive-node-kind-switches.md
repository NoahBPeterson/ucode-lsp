# Make `getChildNodes` (and peer node-kind switches) exhaustive via a `never` guard

Status: **NOT STARTED** — follow-up to the `SCOPE_ROLE` work (0.7.63).

## Why

0.7.63 established compile-time totality for one node-kind classification: `SCOPE_ROLE` is a
`Record<AstNodeKind, ScopeRole>` (`src/ast/scopeRoles.ts`), so adding a new `AstNodeKind` is a
**compile error** until it's classified. That closed the class of bug where ad-hoc scope walks
silently drifted (e.g. `computeFreeVariables` forgot `CatchClause` + rest params → false
"undefined variable").

Other `switch (node.type)` traversals in the codebase have the **same drift risk** and are NOT
guarded. The most important is `TypeChecker.getChildNodes` (`src/analysis/typeChecker.ts:5570`) —
a ~42-case switch that returns a node's children. It has **no `default`/`never`**, so a newly
added `AstNodeKind` silently traverses to `[]` (its subtree is skipped by every type-check pass
that walks children). That's an invisible correctness hole exactly like the scope one.

## Task

1. **`getChildNodes`** — add an exhaustiveness guard:
   ```ts
   default: { const _exhaustive: never = node.type; void _exhaustive; return children; }
   ```
   or convert to a total `Record<AstNodeKind, (n) => AstNode[]>`. The first compile after adding
   the guard will likely surface latent missing cases (kinds that fall through today) — **audit
   each one**: is it a genuine leaf (Literal/Identifier/ThisExpression/TemplateElement/JsDocComment
   → no children, correct) or a container whose children were being skipped (a real bug)? Fix the
   real ones; explicitly list the leaves.
2. **Audit peer switches** for the same treatment (grep `switch (node.type)` / `switch (n.type)`):
   - the `visitor.ts` traversal, if it has its own child enumeration;
   - `references.ts` / `definition.ts` / `documentSymbols.ts` walks;
   - any remaining ad-hoc declaration/scope collectors not yet routed through `scopeRoles.ts`.
3. Where a switch is really a *classification* (not traversal), prefer the `SCOPE_ROLE` pattern —
   a total `Record<AstNodeKind, …>` — over a switch, since the Record's totality is enforced
   without needing a `never` line.

## Guard rails

- Do this as a **focused pass**, one switch at a time — enabling exhaustiveness can surface a pile
  of latent cases at once; resist fixing unrelated things in the same change.
- Model: `src/ast/scopeRoles.ts` (the total Record) and its consumers (`collectScopeBindings` etc.).
- The `AstNodeKind` sub-unions (`AstFunctionKind`, `AstStatementKind`, …) already exist in
  `src/ast/nodes.ts` — useful for grouping cases.
