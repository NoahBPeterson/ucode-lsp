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
    "no-as": {
      create(context) {
        const isConstAssertion = (node) =>
          node.typeAnnotation?.type === "TSTypeReference" &&
          node.typeAnnotation.typeName?.type === "Identifier" &&
          node.typeAnnotation.typeName.name === "const";
        const message =
          "Type assertions are banned in this codebase (docs/rescript-rewrite-audit.md): an `as` is an " +
          "unchecked claim the compiler then trusts. Narrow with a `.type`/`typeof`/`in`/`instanceof` check " +
          "or a type-guard function instead; values already typed `any` by a library assign without a cast. " +
          "(`as const` and `satisfies` are sound and allowed.)";
        return {
          TSAsExpression(node) {
            if (isConstAssertion(node)) return; // `as const` narrows — sound
            context.report({ node, message });
          },
          TSTypeAssertion(node) {
            context.report({ node, message }); // angle-bracket form `<T>x`
          },
        };
      },
    },
    "no-non-null": {
      create(context) {
        return {
          TSNonNullExpression(node) {
            context.report({
              node,
              message:
                "Non-null assertions (`x!`) are banned in this codebase (docs/rescript-rewrite-audit.md): " +
                "`!` is an unchecked nullability claim. Prove it instead — guard with an explicit check, " +
                "restructure so the value is non-nullable by construction, or throw a descriptive error.",
            });
          },
        };
      },
    },
  },
};
