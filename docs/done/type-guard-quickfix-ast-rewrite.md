# Type-guard quick-fix generator rewritten to be AST-node-driven (no more line-string parsing)

> **STATUS: DONE in 0.6.218.** `generateTypeNarrowingQuickFixes` in `server.ts` no
> longer reconstructs program structure from line text. Full suite green (1593).

## Why

The quick-fix generator decided *where* and *how* to place a guard by regex-parsing
the diagnostic's line (`lineText.match`, `indexOf`, `substring`, a hand-rolled
`replaceAt`, `parseOneLinerControl`, `findBracelessParent`) — ~90 string ops, 62 of
them in this one function. Every comment bug (the ternary swallowing `// comment`),
the hardcoded-tab indentation (finding #45), and the "guard lands outside the
function" bug (#91) traced back to re-deriving, by hand, structure the parser had
already produced. The sibling `generateNullAccessQuickFixes` was already AST-offset
based and had none of these problems — that was the template.

## What changed

Structure now comes from AST nodes; edits are anchored to node offsets.

- **`findEnclosingContext`** exposes the actual `enclosingStatement` node (alongside
  the existing `enclosingFunction` / `enclosingControl` / `enclosingControlBody`).
- **`findBracelessControlBody(ast, offset)`** replaces `parseOneLinerControl` +
  `findBracelessParent`: it finds the deepest if/while/for whose **non-block body**
  holds the diagnostic (following `else if` chains into the inner `if`). One-liner
  and multi-line braceless forms are handled uniformly.
- **The braceless rewrite replaces only the body node's range** with a `{ }` block
  (`makeBracelessGuardAction`). The header, any `else`, and trailing comments are
  never touched — so the old `elseClauseText` re-append logic and its comment
  hazards are gone entirely.
- **`pushEarlyGuard`** centralizes guard placement (redirect / in-condition / same-
  line-decl / braceless / inline-fn / in-loop / in-fn), each offset-anchored.
- **Same-line declaration** detection (`findSameLineDeclEnd`) and the **declared-var**
  check read the AST instead of `let|const` regexes.
- **Extract / guard-with-default** replace the flagged expression's *node range* with
  the temp (`nodeSourceWith` swaps a sub-range inside a copied node), plus an
  offset-anchored prelude — no `replaceAt`, no whole-line rebuild. The top-level
  scope-preserving ternary / if-wrap is a single statement-range replace (avoids the
  column-0 insert/replace overlap).
- Deleted: `parseOneLinerControl`, `findBracelessParent`, `replaceAt`,
  `makeReplaceLineAction`, `makeReplaceRangeAction`, `trailingLineCommentIndex`, and
  the `lineText` parameter.

## Result

Comment-safety is now **structural**, not patched: because edits replace exact node
ranges, anything outside a node (trailing `// comments`, the control header, the
`else`) is preserved automatically. A fuzz over param-guard, one-liner if/while,
braceless for, top-level nullable extract, extract-in-loop, `//`-in-string headers,
and `|| fallback` — each fix applied and re-parsed — produces only valid code.

Tests asserting on the *old* raw-`newText` shape were updated to assert on the
**applied** result (the meaningful contract): `test-server-quickfix-deep.test.js`,
`test-quick-fix-type-narrowing.js`.
