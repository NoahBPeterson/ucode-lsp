/**
 * Custom oxlint rules enforcing the banned-types ruling (docs/ban-record-string-unknown.md):
 * the `unknown` type is forbidden in src/ — it is the escape hatch that
 * `Record<string, unknown>` bag-casts were built on. Together with the stock
 * `typescript/no-explicit-any` rule (which flags every `any`, including
 * `as any` and `Record<string, any>`), this makes reintroducing any of the
 * banned forms a build failure.
 *
 * AST-based, so comment prose and string literals mentioning "unknown"/"any"
 * are never false-flagged.
 */
export default {
  meta: { name: "ban-types" },
  rules: {
    "no-unknown": {
      create(context) {
        return {
          TSUnknownKeyword(node) {
            context.report({
              node,
              message:
                "The `unknown` type is banned in this codebase (docs/ban-record-string-unknown.md). " +
                "Type the value with its real shape: AST values are the AstNode union (`.type` narrows), " +
                "traversals go through src/ast/astChildren.ts, and external JSON gets a concrete local interface.",
            });
          },
        };
      },
    },
  },
};
