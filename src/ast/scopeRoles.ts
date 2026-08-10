/**
 * How each AST node kind participates in lexical scoping — the single, compiler-enforced source
 * of truth for "which constructs introduce a binding / open a scope".
 *
 * `SCOPE_ROLE` is a TOTAL `Record<AstNodeKind, ScopeRole>`: adding a new node kind to `AstNodeKind`
 * is a COMPILE ERROR until it's classified here. That totality is the whole point — before this,
 * every scope/declaration collector rolled its own ad-hoc `switch`, and they drifted (e.g.
 * `computeFreeVariables` silently forgot `CatchClause` and rest params → false "undefined
 * variable"). Now every collector reads its bindings through this map, so a forgotten construct
 * can't slip past the type checker.
 *
 * Two axes, because two questions need different granularity:
 *   • `binds` / `opensFunctionScope` — for "is a bare `x = …` a LOCAL of this function?" (the
 *     function-scope collectors: implicit-globals, must-assign, free-variables).
 *   • `opensBlockScope` — for the position-precise "is `x` in scope HERE?" (the used-after-loop
 *     check, owned by the symbol table). Not consulted by the function-scope collectors; carried
 *     so this map stays the complete classification.
 */
import type { AstNode, AstNodeKind } from './nodes';
import { astChildren } from './astChildren';

export interface ScopeRole {
  /** Binding this node contributes to its ENCLOSING scope, and via which field:
   *   'id'           → `.id`           (VariableDeclarator, FunctionDeclaration)
   *   'param'        → `.param`        (CatchClause)
   *   'import-local' → `.local`        (import specifiers)
   *   'none'         → no enclosing binding
   *  A function's OWN params + rest bind into ITS scope — see `functionOwnBindings`, not here. */
  readonly binds: 'none' | 'id' | 'param' | 'import-local';
  /** Function/Arrow: opens a new FUNCTION scope. A function-scope collector must not descend past
   *  it (inner params/locals belong to the inner scope). */
  readonly opensFunctionScope: boolean;
  /** A block-level boundary (block / for / switch / catch). For position-precise scope analysis
   *  only; irrelevant to function-scope collection. */
  readonly opensBlockScope: boolean;
}

const NONE: ScopeRole      = { binds: 'none',         opensFunctionScope: false, opensBlockScope: false };
const BINDS_ID: ScopeRole  = { binds: 'id',           opensFunctionScope: false, opensBlockScope: false };
const FN_NAMED: ScopeRole  = { binds: 'id',           opensFunctionScope: true,  opensBlockScope: false };
const FN_ANON: ScopeRole   = { binds: 'none',         opensFunctionScope: true,  opensBlockScope: false }; // a named FunctionExpression's id is self-scoped → not an enclosing binding
const CATCH: ScopeRole     = { binds: 'param',        opensFunctionScope: false, opensBlockScope: true };
const BLOCK: ScopeRole     = { binds: 'none',         opensFunctionScope: false, opensBlockScope: true };
const IMPORT_SPEC: ScopeRole = { binds: 'import-local', opensFunctionScope: false, opensBlockScope: false };

/** TOTAL over AstNodeKind — the compiler rejects an incomplete map, so a new kind must be classified. */
export const SCOPE_ROLE: Record<AstNodeKind, ScopeRole> = {
  // containers
  Program: NONE,                 // the root scope; a collector seeds from its body directly
  BlockStatement: BLOCK,
  // statements
  ExpressionStatement: NONE,
  VariableDeclaration: NONE,     // the VariableDeclarator children carry the `.id` bindings
  IfStatement: NONE,
  ForStatement: BLOCK,
  ForInStatement: BLOCK,
  WhileStatement: NONE,
  SwitchStatement: BLOCK,        // one block scope shared by all cases (verified vs the interpreter)
  SwitchCase: NONE,
  TryStatement: NONE,            // try/finally bodies are BlockStatements; the handler is CatchClause
  CatchClause: CATCH,
  ReturnStatement: NONE, ThrowStatement: NONE, BreakStatement: NONE, ContinueStatement: NONE,
  EmptyStatement: NONE,
  // functions
  FunctionDeclaration: FN_NAMED,
  FunctionExpression: FN_ANON,
  ArrowFunctionExpression: FN_ANON,
  // expressions
  BinaryExpression: NONE, LogicalExpression: NONE, UnaryExpression: NONE,
  AssignmentExpression: NONE, ConditionalExpression: NONE,
  CallExpression: NONE, MemberExpression: NONE, DeleteExpression: NONE, SpreadElement: NONE,
  ArrayExpression: NONE, ObjectExpression: NONE, TemplateLiteral: NONE,
  // leaves
  Literal: NONE, Identifier: NONE, ThisExpression: NONE, TemplateElement: NONE, JsDocComment: NONE,
  // module
  ImportDeclaration: NONE,       // the specifier children carry the `.local` bindings
  ImportSpecifier: IMPORT_SPEC,
  ImportDefaultSpecifier: IMPORT_SPEC,
  ImportNamespaceSpecifier: IMPORT_SPEC,
  ExportDefaultDeclaration: NONE, ExportNamedDeclaration: NONE, ExportAllDeclaration: NONE, ExportSpecifier: NONE,
  // sub-nodes
  VariableDeclarator: BINDS_ID,
  Property: NONE,
};

/**
 * Total-safe lookup: `SCOPE_ROLE` is exhaustive over `AstNodeKind`, but callers sometimes hand
 * these helpers a value that merely *looks* AST-like (a stamped annotation such as
 * `_inferredParams`'s `{ name, type, isRest }` entries, or a rich `UcodeDataType` object) — its
 * `.type` is a string, but not one of our node kinds. Indexing `SCOPE_ROLE` with such a string is
 * a lookup miss, not a type error at runtime — guard it so a miss degrades to "no scope role"
 * instead of throwing `Cannot read properties of undefined`.
 */
function roleOf(node: AstNode): ScopeRole {
  return SCOPE_ROLE[node.type] ?? NONE;
}

const idName = (n: AstNode | null | undefined): string | null => {
  if (n && n.type === 'Identifier') {
    const nm = n.name;
    return typeof nm === 'string' && nm ? nm : null;
  }
  return null;
};

/** Names this node binds into its ENCLOSING scope (a nested-function name, a `let`/`const` id, a
 *  `catch` param, an import local). NOT a function's own params — see `functionOwnBindings`. */
export function enclosingBindings(node: AstNode): string[] {
  switch (roleOf(node).binds) {
    case 'none': return [];
    case 'id': { const nm = 'id' in node ? idName(node.id) : null; return nm ? [nm] : []; }
    case 'param': { const nm = node.type === 'CatchClause' ? idName(node.param) : null; return nm ? [nm] : []; }
    case 'import-local': { const nm = 'local' in node ? idName(node.local) : null; return nm ? [nm] : []; }
  }
}

/** Names a FUNCTION binds into its OWN scope: params + rest param. `[]` for non-functions. */
export function functionOwnBindings(node: AstNode): string[] {
  if (!roleOf(node).opensFunctionScope) return [];
  if (node.type !== 'FunctionDeclaration' && node.type !== 'FunctionExpression'
      && node.type !== 'ArrowFunctionExpression') return [];
  const out: string[] = [];
  for (const p of (node.params ?? [])) { const nm = idName(p); if (nm) out.push(nm); }
  const rest = idName(node.restParam); if (rest) out.push(rest);
  return out;
}

export const opensFunctionScope = (node: AstNode): boolean => roleOf(node).opensFunctionScope;

/**
 * All names bound in one function's (or the program's) OWN scope: its params/rest, plus every
 * `let`/`const`, nested-function name, `catch` param, and import local found ANYWHERE in its body
 * — through blocks / switch cases / try-catch / loops — but NOT descending into nested functions
 * (their bindings are their own scope). The reference collector for "is a bare `x = …` a local of
 * this function?". Pass a Program to collect the top-level scope.
 */
export function collectScopeBindings(node: AstNode): Set<string> {
  const out = new Set<string>(functionOwnBindings(node));
  const walk = (cur: AstNode): void => {
    for (const nm of enclosingBindings(cur)) out.add(nm);
    if (opensFunctionScope(cur)) return; // nested function — its own scope
    // astChildren skips `leadingJsDoc` and runtime-stamped `_`-prefixed annotations
    // (_inferredParams, etc.) by construction — it only enumerates declared child fields.
    for (const child of astChildren(cur)) walk(child);
  };
  if (node.type === 'Program' || node.type === 'BlockStatement') {
    for (const it of node.body) walk(it);
  } else if ('body' in node && node.body) {
    walk(node.body);
  }
  return out;
}
