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
import type { AstNode, AstNodeKind, IdentifierNode } from './nodes';

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

const idName = (n: unknown): string | null => {
  if (n && typeof n === 'object' && (n as { type?: unknown }).type === 'Identifier') {
    const nm = (n as IdentifierNode).name;
    return typeof nm === 'string' && nm ? nm : null;
  }
  return null;
};

/** Names this node binds into its ENCLOSING scope (a nested-function name, a `let`/`const` id, a
 *  `catch` param, an import local). NOT a function's own params — see `functionOwnBindings`. */
export function enclosingBindings(node: AstNode): string[] {
  const n = node as unknown as Record<string, unknown>;
  switch (SCOPE_ROLE[node.type].binds) {
    case 'none': return [];
    case 'id': { const nm = idName(n['id']); return nm ? [nm] : []; }
    case 'param': { const nm = idName(n['param']); return nm ? [nm] : []; }
    case 'import-local': { const nm = idName(n['local']); return nm ? [nm] : []; }
  }
}

/** Names a FUNCTION binds into its OWN scope: params + rest param. `[]` for non-functions. */
export function functionOwnBindings(node: AstNode): string[] {
  if (!SCOPE_ROLE[node.type].opensFunctionScope) return [];
  const fn = node as unknown as { params?: unknown[]; restParam?: unknown };
  const out: string[] = [];
  for (const p of (fn.params ?? [])) { const nm = idName(p); if (nm) out.push(nm); }
  const rest = idName(fn.restParam); if (rest) out.push(rest);
  return out;
}

export const opensFunctionScope = (node: AstNode): boolean => SCOPE_ROLE[node.type].opensFunctionScope;

/**
 * All names bound in one function's (or the program's) OWN scope: its params/rest, plus every
 * `let`/`const`, nested-function name, `catch` param, and import local found ANYWHERE in its body
 * — through blocks / switch cases / try-catch / loops — but NOT descending into nested functions
 * (their bindings are their own scope). The reference collector for "is a bare `x = …` a local of
 * this function?". Pass a Program to collect the top-level scope.
 */
export function collectScopeBindings(node: AstNode): Set<string> {
  const out = new Set<string>(functionOwnBindings(node));
  const walk = (n: unknown): void => {
    if (!n || typeof n !== 'object' || typeof (n as { type?: unknown }).type !== 'string') return;
    const cur = n as AstNode;
    for (const nm of enclosingBindings(cur)) out.add(nm);
    if (opensFunctionScope(cur)) return; // nested function — its own scope
    for (const k of Object.keys(cur)) {
      if (k === 'leadingJsDoc') continue;
      const v = (cur as unknown as Record<string, unknown>)[k];
      if (Array.isArray(v)) { for (const it of v) walk(it); }
      else walk(v);
    }
  };
  const body = (node as unknown as { body?: unknown }).body;
  if (Array.isArray(body)) { for (const it of body) walk(it); }
  else if (body) walk(body);
  return out;
}
