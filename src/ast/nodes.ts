/**
 * AST Node definitions for ucode language
 * Based on the ucode compiler's grammar and token types
 */

// AST node type discriminants, split by semantic category

/** Structural containers that hold ordered lists of children */
export type AstContainerKind =
  | 'Program' | 'BlockStatement';

/** Control flow and declaration statements */
export type AstStatementKind =
  | 'ExpressionStatement' | 'VariableDeclaration'
  | 'IfStatement' | 'ForStatement' | 'ForInStatement' | 'WhileStatement'
  | 'SwitchStatement' | 'SwitchCase'
  | 'TryStatement' | 'CatchClause'
  | 'ReturnStatement' | 'ThrowStatement' | 'BreakStatement' | 'ContinueStatement'
  | 'EmptyStatement';

/** Function declarations and expressions */
export type AstFunctionKind =
  | 'FunctionDeclaration' | 'FunctionExpression' | 'ArrowFunctionExpression';

/** Expressions that produce values */
export type AstExpressionKind =
  | 'BinaryExpression' | 'LogicalExpression' | 'UnaryExpression'
  | 'AssignmentExpression' | 'ConditionalExpression'
  | 'CallExpression' | 'MemberExpression' | 'DeleteExpression' | 'SpreadElement'
  | 'ArrayExpression' | 'ObjectExpression' | 'TemplateLiteral';

/** Leaf nodes with no children to traverse */
export type AstLeafKind =
  | 'Literal' | 'Identifier' | 'ThisExpression'
  | 'TemplateElement' | 'JsDocComment';

/** Module import/export nodes */
export type AstModuleKind =
  | 'ImportDeclaration' | 'ImportSpecifier' | 'ImportDefaultSpecifier' | 'ImportNamespaceSpecifier'
  | 'ExportDefaultDeclaration' | 'ExportNamedDeclaration' | 'ExportAllDeclaration' | 'ExportSpecifier';

/** Structural sub-nodes (parts of larger constructs) */
export type AstSubNodeKind =
  | 'VariableDeclarator' | 'Property';

/** All possible AST node type discriminants */
export type AstNodeKind =
  | AstContainerKind | AstStatementKind | AstFunctionKind
  | AstExpressionKind | AstLeafKind | AstModuleKind | AstSubNodeKind;

// Base AST Node with position tracking. Every concrete node interface extends
// this; consumer code should use `AstNode` (the discriminated union below), on
// which `node.type === '…'` narrows without casts.
export interface AstNodeBase {
  type: AstNodeKind;
  start: number;
  end: number;
  // parent?: AstNode; // REMOVED: Causes memory leaks due to circular references
}

// JSDoc comment node (attached to function declarations/expressions)
export interface JsDocCommentNode extends AstNodeBase {
  type: 'JsDocComment';
  value: string;       // Raw comment text (between /** and */)
}

// Program root - contains all top-level statements
export interface ProgramNode extends AstNodeBase {
  type: 'Program';
  body: AstNode[];
}

// ========== EXPRESSIONS ==========

// Literal values
export interface LiteralNode extends AstNodeBase {
  type: 'Literal';
  value: string | number | boolean | null;
  raw: string;
  literalType: 'string' | 'number' | 'double' | 'boolean' | 'null' | 'regexp';
}

// Variable/function identifiers
export interface IdentifierNode extends AstNodeBase {
  type: 'Identifier';
  name: string;
}

// Binary operations: +, -, *, /, %, ==, !=, <, >, etc.
export interface BinaryExpressionNode extends AstNodeBase {
  type: 'BinaryExpression';
  operator: '+' | '-' | '*' | '/' | '%' | '**' | 
            '==' | '!=' | '===' | '!==' | '<' | '>' | '<=' | '>=' |
            '&&' | '||' | '&' | '|' | '^' | '<<' | '>>' | 
            'in' | '??' | '+=' | '-=' | '*=' | '/=' | '%=' | '**=' |
            '<<=' | '>>=' | '&=' | '^=' | '|=' | '&&=' | '||=' | '??=';
  left: AstNode;
  right: AstNode;
}

// Unary operations: +, -, !, ~, ++, --
export interface UnaryExpressionNode extends AstNodeBase {
  type: 'UnaryExpression';
  operator: '+' | '-' | '!' | '~' | '++' | '--';
  argument: AstNode;
  prefix: boolean; // true for ++x, false for x++
  // Set when the parser absorbed an UNPARENTHESIZED assignment as the operand
  // (e.g. `!x = y` → `!(x = y)`). Distinguishes it from the already-clear `!(x = y)`,
  // which carries the same AST shape but should not be warned about (UC6007).
  absorbedAssignment?: boolean;
}

// Assignment expressions: x = y
export interface AssignmentExpressionNode extends AstNodeBase {
  type: 'AssignmentExpression';
  operator: '=' | '+=' | '-=' | '*=' | '/=' | '%=' | '**=' |
            '<<=' | '>>=' | '&=' | '^=' | '|=' | '&&=' | '||=' | '??=';
  left: AstNode;
  right: AstNode;
}

// Function calls: func(arg1, arg2)
export interface CallExpressionNode extends AstNodeBase {
  type: 'CallExpression';
  callee: AstNode;
  arguments: AstNode[];
  optional?: boolean; // for optional chaining ?.()
  unclosed?: boolean; // true when no closing `)` was consumed (error recovery) — its arg region runs to EOF (signature help #85)
}

// Spread elements: ...args
export interface SpreadElementNode extends AstNodeBase {
  type: 'SpreadElement';
  argument: AstNode;
}

// Property access: obj.prop or obj[prop]
export interface MemberExpressionNode extends AstNodeBase {
  type: 'MemberExpression';
  object: AstNode;
  property: AstNode;
  computed: boolean; // true for obj[prop], false for obj.prop
  optional?: boolean; // for optional chaining ?. or ?.[
}

// Array literals: [1, 2, 3]
export interface ArrayExpressionNode extends AstNodeBase {
  type: 'ArrayExpression';
  elements: (AstNode | null)[]; // null for sparse arrays [1, , 3]
}

// Object literals: {key: value, ...}
export interface ObjectExpressionNode extends AstNodeBase {
  type: 'ObjectExpression';
  properties: (PropertyNode | SpreadElementNode)[];
}

// Object property: key: value
export interface PropertyNode extends AstNodeBase {
  type: 'Property';
  key: AstNode;
  value: AstNode;
  computed: boolean; // true for {[key]: value}
  leadingJsDoc?: JsDocCommentNode; // JSDoc immediately before the property key (if any)
}

// Conditional expression: test ? consequent : alternate
export interface ConditionalExpressionNode extends AstNodeBase {
  type: 'ConditionalExpression';
  test: AstNode;
  consequent: AstNode;
  alternate: AstNode;
}

// Logical expressions: &&, ||, ??
export interface LogicalExpressionNode extends AstNodeBase {
  type: 'LogicalExpression';
  operator: '&&' | '||' | '??';
  left: AstNode;
  right: AstNode;
}

// This expression
export interface ThisExpressionNode extends AstNodeBase {
  type: 'ThisExpression';
}

// Template literal interpolation: ${expression}
export interface TemplateLiteralNode extends AstNodeBase {
  type: 'TemplateLiteral';
  expressions: AstNode[];
  quasis: TemplateElementNode[];
}

export interface TemplateElementNode extends AstNodeBase {
  type: 'TemplateElement';
  value: {
    raw: string;
    cooked: string;
  };
  tail: boolean;
}

// ========== STATEMENTS ==========

// Block of statements: { ... }
export interface BlockStatementNode extends AstNodeBase {
  type: 'BlockStatement';
  body: AstNode[];
}

// Expression used as statement
export interface ExpressionStatementNode extends AstNodeBase {
  type: 'ExpressionStatement';
  expression: AstNode;
}

// Variable declarations: let x = 5; const y = 10;
export interface VariableDeclarationNode extends AstNodeBase {
  type: 'VariableDeclaration';
  kind: 'let' | 'const';
  declarations: VariableDeclaratorNode[];
  leadingJsDoc?: JsDocCommentNode;
}

export interface VariableDeclaratorNode extends AstNodeBase {
  type: 'VariableDeclarator';
  id: IdentifierNode;
  init: AstNode | null;
  /**
   * True when an `=` was present but the initializer expression failed to parse
   * (e.g. `let x = (1 +;`). Distinguishes a broken initializer from a legitimate
   * no-initializer `let x;`, so downstream diagnostics (UC1006 unused-variable)
   * don't cascade on top of the real parse error.
   */
  initHadParseError?: boolean;
}

// If statements: if (test) consequent else alternate
export interface IfStatementNode extends AstNodeBase {
  type: 'IfStatement';
  test: AstNode;
  consequent: AstNode;
  alternate: AstNode | null;
}

// For loops: for (init; test; update) body
export interface ForStatementNode extends AstNodeBase {
  type: 'ForStatement';
  init: AstNode | null;
  test: AstNode | null;
  update: AstNode | null;
  body: AstNode;
}

// For-in loops: for (left in right) body
export interface ForInStatementNode extends AstNodeBase {
  type: 'ForInStatement';
  left: AstNode;
  right: AstNode;
  body: AstNode;
}

// While loops: while (test) body
export interface WhileStatementNode extends AstNodeBase {
  type: 'WhileStatement';
  test: AstNode;
  body: AstNode;
}

// Function declarations: function name(params) { body }
export interface FunctionDeclarationNode extends AstNodeBase {
  type: 'FunctionDeclaration';
  id: IdentifierNode;
  params: IdentifierNode[];
  restParam?: IdentifierNode; // for ...args parameters
  body: BlockStatementNode;
  leadingJsDoc?: JsDocCommentNode;
  // Forward declaration `function name;` — declares the name (for mutual
  // recursion / use-before-definition) with no parameter list or body. The
  // `body` is a synthetic empty block. A forward declaration that is never
  // completed by a real definition is an unimplemented stub.
  forwardDeclaration?: boolean;
  /** Whether a trailing `;` immediately followed the declaration. Relevant for
   *  the `export function` form (ucode ≤24.10 requires it; main made it optional). */
  hadSemicolon?: boolean;
}

// Function expressions: function(params) { body }
export interface FunctionExpressionNode extends AstNodeBase {
  type: 'FunctionExpression';
  id: IdentifierNode | null;
  params: IdentifierNode[];
  restParam?: IdentifierNode; // for ...args parameters
  body: BlockStatementNode;
  leadingJsDoc?: JsDocCommentNode;
}

// Arrow functions: (params) => body
export interface ArrowFunctionExpressionNode extends AstNodeBase {
  type: 'ArrowFunctionExpression';
  params: IdentifierNode[];
  restParam?: IdentifierNode; // for ...args parameters
  body: AstNode; // can be BlockStatement or Expression
  expression: boolean; // true if body is expression, false if block
  leadingJsDoc?: JsDocCommentNode;
}

// Return statements: return value;
export interface ReturnStatementNode extends AstNodeBase {
  type: 'ReturnStatement';
  argument: AstNode | null;
}

// Break statements: break;
export interface BreakStatementNode extends AstNodeBase {
  type: 'BreakStatement';
  label: IdentifierNode | null;
}

// Continue statements: continue;
export interface ContinueStatementNode extends AstNodeBase {
  type: 'ContinueStatement';
  label: IdentifierNode | null;
}

// Try-catch statements: try { } catch (param) { }
export interface TryStatementNode extends AstNodeBase {
  type: 'TryStatement';
  block: BlockStatementNode;
  handler: CatchClauseNode | null;
}

export interface CatchClauseNode extends AstNodeBase {
  type: 'CatchClause';
  param: IdentifierNode | null;
  body: BlockStatementNode;
}

// Throw statements: throw expression;
export interface ThrowStatementNode extends AstNodeBase {
  type: 'ThrowStatement';
  argument: AstNode;
}

// Switch statements: switch (discriminant) { cases }
export interface SwitchStatementNode extends AstNodeBase {
  type: 'SwitchStatement';
  discriminant: AstNode;
  cases: SwitchCaseNode[];
}

export interface SwitchCaseNode extends AstNodeBase {
  type: 'SwitchCase';
  test: AstNode | null; // null for default case
  consequent: AstNode[];
}

// Delete expression: delete obj.prop
export interface DeleteExpressionNode extends AstNodeBase {
  type: 'DeleteExpression';
  argument: AstNode;
}

// Empty statement: ;
export interface EmptyStatementNode extends AstNodeBase {
  type: 'EmptyStatement';
}

// Import statements: import { name } from 'module';
export interface ImportDeclarationNode extends AstNodeBase {
  type: 'ImportDeclaration';
  specifiers: (ImportSpecifierNode | ImportDefaultSpecifierNode | ImportNamespaceSpecifierNode)[];
  source: LiteralNode;
}

// Import specifiers: { name } or { name as alias }
export interface ImportSpecifierNode extends AstNodeBase {
  type: 'ImportSpecifier';
  imported: IdentifierNode;
  local: IdentifierNode;
}

// Import default specifier: name
export interface ImportDefaultSpecifierNode extends AstNodeBase {
  type: 'ImportDefaultSpecifier';
  local: IdentifierNode;
}

// Import namespace specifier: * as name
export interface ImportNamespaceSpecifierNode extends AstNodeBase {
  type: 'ImportNamespaceSpecifier';
  local: IdentifierNode;
}

// Export statements: export function name() {}
export interface ExportNamedDeclarationNode extends AstNodeBase {
  type: 'ExportNamedDeclaration';
  declaration: AstNode | null;
  specifiers: ExportSpecifierNode[];
  source: LiteralNode | null;
  /** For the `export function NAME(){}` form: whether a trailing `;` followed the
   *  function. ucode ≤24.10 requires it; main made it optional. Undefined for the
   *  other export forms (which consume their own terminator). */
  declarationHadSemicolon?: boolean;
}

// Export default: export default function() {}
export interface ExportDefaultDeclarationNode extends AstNodeBase {
  type: 'ExportDefaultDeclaration';
  declaration: AstNode;
}

// Export specifiers: { name } or { name as alias }
export interface ExportSpecifierNode extends AstNodeBase {
  type: 'ExportSpecifier';
  local: IdentifierNode;
  exported: IdentifierNode;
}

// Export all: export * from 'module'
export interface ExportAllDeclarationNode extends AstNodeBase {
  type: 'ExportAllDeclaration';
  source: LiteralNode;
  exported: IdentifierNode | null;
}

// ========== UNION TYPES ==========

// All expression types
export type Expression = 
  | LiteralNode
  | IdentifierNode
  | BinaryExpressionNode
  | UnaryExpressionNode
  | AssignmentExpressionNode
  | CallExpressionNode
  | SpreadElementNode
  | MemberExpressionNode
  | ArrayExpressionNode
  | ObjectExpressionNode
  | ConditionalExpressionNode
  | LogicalExpressionNode
  | ThisExpressionNode
  | TemplateLiteralNode
  | FunctionExpressionNode
  | ArrowFunctionExpressionNode
  | DeleteExpressionNode;

// All statement types
export type Statement = 
  | BlockStatementNode
  | ExpressionStatementNode
  | VariableDeclarationNode
  | IfStatementNode
  | ForStatementNode
  | ForInStatementNode
  | WhileStatementNode
  | FunctionDeclarationNode
  | ReturnStatementNode
  | BreakStatementNode
  | ContinueStatementNode
  | TryStatementNode
  | ThrowStatementNode
  | SwitchStatementNode
  | EmptyStatementNode
  | ImportDeclarationNode
  | ExportNamedDeclarationNode
  | ExportDefaultDeclarationNode
  | ExportAllDeclarationNode;

// All AST node types — TOTAL over AstNodeKind (statically asserted below).
export type AstNodeType = ProgramNode | Expression | Statement |
  VariableDeclaratorNode | PropertyNode | TemplateElementNode |
  CatchClauseNode | SwitchCaseNode | JsDocCommentNode |
  ImportSpecifierNode | ImportDefaultSpecifierNode | ImportNamespaceSpecifierNode |
  ExportSpecifierNode;

/** The canonical node type: a discriminated union, so `node.type === '…'`
 *  narrows to the concrete interface with no casts. */
export type AstNode = AstNodeType;

// Static totality proof: if a new AstNodeKind is added without a corresponding
// interface in AstNodeType, this line becomes a compile error.
const _astNodeUnionIsTotal: Exclude<AstNodeKind, AstNodeType['type']> extends never ? true : never = true;
void _astNodeUnionIsTotal;

// Helper type guards
export function isStatement(node: AstNode): node is Statement {
  return [
    'BlockStatement', 'ExpressionStatement', 'VariableDeclaration',
    'IfStatement', 'ForStatement', 'ForInStatement', 'WhileStatement',
    'FunctionDeclaration', 'ReturnStatement', 'BreakStatement',
    'ContinueStatement', 'TryStatement', 'ThrowStatement',
    'SwitchStatement', 'EmptyStatement'
  ].includes(node.type);
}