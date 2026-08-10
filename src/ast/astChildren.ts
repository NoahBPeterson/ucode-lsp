/**
 * Typed AST child enumeration — the single generic traversal for the codebase.
 *
 * Built as a TOTAL switch over the AstNode discriminated union: adding a new
 * AstNodeKind is a compile error here (the `default: never` arm) instead of a
 * silent behavior change in a dozen hand-rolled `Object.keys(node)` walks.
 *
 * Traversal semantics (deliberate, matching the historical typeChecker walk):
 * - `leadingJsDoc` is metadata, not a child — never visited.
 * - break/continue labels, import/export `source` literals, specifier
 *   identifiers, and TemplateLiteral quasis are not visited: they contain no
 *   expressions, and visiting label/specifier Identifiers would make generic
 *   identifier-use scans record spurious uses.
 * - SwitchStatement flattens its cases (discriminant, then each case's test
 *   and consequent statements) — SwitchCase nodes do not appear in the child
 *   stream, mirroring the traversal every existing consumer was written for.
 * - Function params are visited (they are Identifier declarations; semantic
 *   walks that treat declarations differently must special-case function
 *   kinds before recursing, as they always have).
 */

import type { AstNode } from './nodes';

/** The AST children of `node`, in source-field order. */
export function astChildren(node: AstNode): AstNode[] {
  switch (node.type) {
    // Containers
    case 'Program':
    case 'BlockStatement':
      return [...node.body];

    // Statements
    case 'ExpressionStatement':
      return [node.expression];
    case 'VariableDeclaration':
      return [...node.declarations];
    case 'VariableDeclarator':
      return node.init ? [node.id, node.init] : [node.id];
    case 'IfStatement':
      return node.alternate
        ? [node.test, node.consequent, node.alternate]
        : [node.test, node.consequent];
    case 'ForStatement': {
      const out: AstNode[] = [];
      if (node.init) out.push(node.init);
      if (node.test) out.push(node.test);
      if (node.update) out.push(node.update);
      out.push(node.body);
      return out;
    }
    case 'ForInStatement':
      return [node.left, node.right, node.body];
    case 'WhileStatement':
      return [node.test, node.body];
    case 'ReturnStatement':
      return node.argument ? [node.argument] : [];
    case 'ThrowStatement':
      return [node.argument];
    case 'BreakStatement':
    case 'ContinueStatement':
    case 'EmptyStatement':
      return [];
    case 'SwitchStatement': {
      const out: AstNode[] = [node.discriminant];
      for (const c of node.cases) {
        if (c.test) out.push(c.test);
        out.push(...c.consequent);
      }
      return out;
    }
    case 'SwitchCase':
      // Flattened into SwitchStatement above; standalone enumeration still works.
      return node.test ? [node.test, ...node.consequent] : [...node.consequent];
    case 'TryStatement':
      return node.handler ? [node.block, node.handler] : [node.block];
    case 'CatchClause':
      return [node.body];

    // Functions
    case 'FunctionDeclaration':
      return [node.id, ...node.params, node.body];
    case 'FunctionExpression':
      return node.id ? [node.id, ...node.params, node.body] : [...node.params, node.body];
    case 'ArrowFunctionExpression':
      return [...node.params, node.body];

    // Expressions
    case 'BinaryExpression':
    case 'LogicalExpression':
    case 'AssignmentExpression':
      return [node.left, node.right];
    case 'UnaryExpression':
    case 'DeleteExpression':
    case 'SpreadElement':
      return [node.argument];
    case 'ConditionalExpression':
      return [node.test, node.consequent, node.alternate];
    case 'CallExpression':
      return [node.callee, ...node.arguments.filter(arg => arg != null)];
    case 'MemberExpression':
      return [node.object, node.property];
    case 'ObjectExpression':
      return [...node.properties];
    case 'Property':
      return [node.key, node.value];
    case 'ArrayExpression':
      return node.elements.filter((el): el is AstNode => el != null);
    case 'TemplateLiteral':
      return [...node.expressions];

    // Leaves
    case 'TemplateElement':
    case 'Literal':
    case 'Identifier':
    case 'ThisExpression':
    case 'JsDocComment':
      return [];

    // Imports/exports
    case 'ImportDeclaration':
      return [...node.specifiers];
    case 'ImportSpecifier':
    case 'ImportDefaultSpecifier':
    case 'ImportNamespaceSpecifier':
    case 'ExportSpecifier':
      return [];
    case 'ExportDefaultDeclaration':
      return [node.declaration];
    case 'ExportNamedDeclaration':
      return node.declaration ? [node.declaration] : [];
    case 'ExportAllDeclaration':
      return [];

    default: {
      // Totality proof: a new AstNodeKind fails to compile until listed above.
      const _exhaustive: never = node;
      void _exhaustive;
      return [];
    }
  }
}

/** Visit each direct AST child of `node`. */
export function forEachAstChild(node: AstNode, visit: (child: AstNode) => void): void {
  for (const child of astChildren(node)) visit(child);
}

/**
 * Pre-order recursive walk. `visit` may return `false` to prune the subtree
 * under that node (its children are not visited); any other return value
 * continues the walk.
 */
export function walkAst(node: AstNode, visit: (n: AstNode) => boolean | void): void {
  if (visit(node) === false) return;
  for (const child of astChildren(node)) walkAst(child, visit);
}
