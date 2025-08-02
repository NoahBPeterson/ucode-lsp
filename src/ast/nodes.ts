/**
 * AST Node definitions for ucode language
 * Based on the ucode compiler's grammar and token types
 */

// Base AST Node with position tracking
export interface AstNode {
  type: string;
  start: number;
  end: number;
  // parent?: AstNode; // REMOVED: Causes memory leaks due to circular references
}

// Program root - contains all top-level statements
export interface ProgramNode extends AstNode {
  type: 'Program';
  body: AstNode[];
}

// ========== EXPRESSIONS ==========

// Literal values
export interface LiteralNode extends AstNode {
  type: 'Literal';
  value: string | number | boolean | null;
  raw: string;
  literalType: 'string' | 'number' | 'double' | 'boolean' | 'null' | 'regexp';
}

// Variable/function identifiers
export interface IdentifierNode extends AstNode {
  type: 'Identifier';
  name: string;
}

// Binary operations: +, -, *, /, %, ==, !=, <, >, etc.
export interface BinaryExpressionNode extends AstNode {
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
export interface UnaryExpressionNode extends AstNode {
  type: 'UnaryExpression';
  operator: '+' | '-' | '!' | '~' | '++' | '--';
  argument: AstNode;
  prefix: boolean; // true for ++x, false for x++
}

// Assignment expressions: x = y
export interface AssignmentExpressionNode extends AstNode {
  type: 'AssignmentExpression';
  operator: '=' | '+=' | '-=' | '*=' | '/=' | '%=' | '**=' |
            '<<=' | '>>=' | '&=' | '^=' | '|=' | '&&=' | '||=' | '??=';
  left: AstNode;
  right: AstNode;
}

// Function calls: func(arg1, arg2)
export interface CallExpressionNode extends AstNode {
  type: 'CallExpression';
  callee: AstNode;
  arguments: AstNode[];
  optional?: boolean; // for optional chaining ?.()
}

// Property access: obj.prop or obj[prop]
export interface MemberExpressionNode extends AstNode {
  type: 'MemberExpression';
  object: AstNode;
  property: AstNode;
  computed: boolean; // true for obj[prop], false for obj.prop
  optional?: boolean; // for optional chaining ?. or ?.[
}

// Array literals: [1, 2, 3]
export interface ArrayExpressionNode extends AstNode {
  type: 'ArrayExpression';
  elements: (AstNode | null)[]; // null for sparse arrays [1, , 3]
}

// Object literals: {key: value, ...}
export interface ObjectExpressionNode extends AstNode {
  type: 'ObjectExpression';
  properties: PropertyNode[];
}

// Object property: key: value
export interface PropertyNode extends AstNode {
  type: 'Property';
  key: AstNode;
  value: AstNode;
  computed: boolean; // true for {[key]: value}
}

// Conditional expression: test ? consequent : alternate
export interface ConditionalExpressionNode extends AstNode {
  type: 'ConditionalExpression';
  test: AstNode;
  consequent: AstNode;
  alternate: AstNode;
}

// Logical expressions: &&, ||, ??
export interface LogicalExpressionNode extends AstNode {
  type: 'LogicalExpression';
  operator: '&&' | '||' | '??';
  left: AstNode;
  right: AstNode;
}

// This expression
export interface ThisExpressionNode extends AstNode {
  type: 'ThisExpression';
}

// Template literal interpolation: ${expression}
export interface TemplateLiteralNode extends AstNode {
  type: 'TemplateLiteral';
  expressions: AstNode[];
  quasis: TemplateElementNode[];
}

export interface TemplateElementNode extends AstNode {
  type: 'TemplateElement';
  value: {
    raw: string;
    cooked: string;
  };
  tail: boolean;
}

// ========== STATEMENTS ==========

// Block of statements: { ... }
export interface BlockStatementNode extends AstNode {
  type: 'BlockStatement';
  body: AstNode[];
}

// Expression used as statement
export interface ExpressionStatementNode extends AstNode {
  type: 'ExpressionStatement';
  expression: AstNode;
}

// Variable declarations: let x = 5; const y = 10;
export interface VariableDeclarationNode extends AstNode {
  type: 'VariableDeclaration';
  kind: 'let' | 'const';
  declarations: VariableDeclaratorNode[];
}

export interface VariableDeclaratorNode extends AstNode {
  type: 'VariableDeclarator';
  id: IdentifierNode;
  init: AstNode | null;
}

// If statements: if (test) consequent else alternate
export interface IfStatementNode extends AstNode {
  type: 'IfStatement';
  test: AstNode;
  consequent: AstNode;
  alternate: AstNode | null;
}

// For loops: for (init; test; update) body
export interface ForStatementNode extends AstNode {
  type: 'ForStatement';
  init: AstNode | null;
  test: AstNode | null;
  update: AstNode | null;
  body: AstNode;
}

// For-in loops: for (left in right) body
export interface ForInStatementNode extends AstNode {
  type: 'ForInStatement';
  left: AstNode;
  right: AstNode;
  body: AstNode;
}

// While loops: while (test) body
export interface WhileStatementNode extends AstNode {
  type: 'WhileStatement';
  test: AstNode;
  body: AstNode;
}

// Function declarations: function name(params) { body }
export interface FunctionDeclarationNode extends AstNode {
  type: 'FunctionDeclaration';
  id: IdentifierNode;
  params: IdentifierNode[];
  body: BlockStatementNode;
}

// Function expressions: function(params) { body }
export interface FunctionExpressionNode extends AstNode {
  type: 'FunctionExpression';
  id: IdentifierNode | null;
  params: IdentifierNode[];
  body: BlockStatementNode;
}

// Arrow functions: (params) => body
export interface ArrowFunctionExpressionNode extends AstNode {
  type: 'ArrowFunctionExpression';
  params: IdentifierNode[];
  body: AstNode; // can be BlockStatement or Expression
  expression: boolean; // true if body is expression, false if block
}

// Return statements: return value;
export interface ReturnStatementNode extends AstNode {
  type: 'ReturnStatement';
  argument: AstNode | null;
}

// Break statements: break;
export interface BreakStatementNode extends AstNode {
  type: 'BreakStatement';
  label: IdentifierNode | null;
}

// Continue statements: continue;
export interface ContinueStatementNode extends AstNode {
  type: 'ContinueStatement';
  label: IdentifierNode | null;
}

// Try-catch statements: try { } catch (param) { }
export interface TryStatementNode extends AstNode {
  type: 'TryStatement';
  block: BlockStatementNode;
  handler: CatchClauseNode | null;
}

export interface CatchClauseNode extends AstNode {
  type: 'CatchClause';
  param: IdentifierNode | null;
  body: BlockStatementNode;
}

// Throw statements: throw expression;
export interface ThrowStatementNode extends AstNode {
  type: 'ThrowStatement';
  argument: AstNode;
}

// Switch statements: switch (discriminant) { cases }
export interface SwitchStatementNode extends AstNode {
  type: 'SwitchStatement';
  discriminant: AstNode;
  cases: SwitchCaseNode[];
}

export interface SwitchCaseNode extends AstNode {
  type: 'SwitchCase';
  test: AstNode | null; // null for default case
  consequent: AstNode[];
}

// Delete expression: delete obj.prop
export interface DeleteExpressionNode extends AstNode {
  type: 'DeleteExpression';
  argument: AstNode;
}

// Empty statement: ;
export interface EmptyStatementNode extends AstNode {
  type: 'EmptyStatement';
}

// Label statements: label: statement
export interface LabeledStatementNode extends AstNode {
  type: 'LabeledStatement';
  label: IdentifierNode;
  body: AstNode;
}

// Import statements: import { name } from 'module';
export interface ImportDeclarationNode extends AstNode {
  type: 'ImportDeclaration';
  specifiers: (ImportSpecifierNode | ImportDefaultSpecifierNode | ImportNamespaceSpecifierNode)[];
  source: LiteralNode;
}

// Import specifiers: { name } or { name as alias }
export interface ImportSpecifierNode extends AstNode {
  type: 'ImportSpecifier';
  imported: IdentifierNode;
  local: IdentifierNode;
}

// Import default specifier: name
export interface ImportDefaultSpecifierNode extends AstNode {
  type: 'ImportDefaultSpecifier';
  local: IdentifierNode;
}

// Import namespace specifier: * as name
export interface ImportNamespaceSpecifierNode extends AstNode {
  type: 'ImportNamespaceSpecifier';
  local: IdentifierNode;
}

// Export statements: export function name() {}
export interface ExportNamedDeclarationNode extends AstNode {
  type: 'ExportNamedDeclaration';
  declaration: AstNode | null;
  specifiers: ExportSpecifierNode[];
  source: LiteralNode | null;
}

// Export default: export default function() {}
export interface ExportDefaultDeclarationNode extends AstNode {
  type: 'ExportDefaultDeclaration';
  declaration: AstNode;
}

// Export specifiers: { name } or { name as alias }
export interface ExportSpecifierNode extends AstNode {
  type: 'ExportSpecifier';
  local: IdentifierNode;
  exported: IdentifierNode;
}

// Export all: export * from 'module'
export interface ExportAllDeclarationNode extends AstNode {
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
  | LabeledStatementNode
  | ImportDeclarationNode
  | ExportNamedDeclarationNode
  | ExportDefaultDeclarationNode
  | ExportAllDeclarationNode;

// All AST node types
export type AstNodeType = ProgramNode | Expression | Statement | 
  VariableDeclaratorNode | PropertyNode | TemplateElementNode | 
  CatchClauseNode | SwitchCaseNode;

// Helper type guards
export function isExpression(node: AstNode): node is Expression {
  return [
    'Literal', 'Identifier', 'BinaryExpression', 'UnaryExpression',
    'AssignmentExpression', 'CallExpression', 'MemberExpression',
    'ArrayExpression', 'ObjectExpression', 'ConditionalExpression',
    'LogicalExpression', 'ThisExpression', 'TemplateLiteral',
    'FunctionExpression', 'ArrowFunctionExpression', 'DeleteExpression'
  ].includes(node.type);
}

export function isStatement(node: AstNode): node is Statement {
  return [
    'BlockStatement', 'ExpressionStatement', 'VariableDeclaration',
    'IfStatement', 'ForStatement', 'ForInStatement', 'WhileStatement',
    'FunctionDeclaration', 'ReturnStatement', 'BreakStatement',
    'ContinueStatement', 'TryStatement', 'ThrowStatement',
    'SwitchStatement', 'EmptyStatement', 'LabeledStatement'
  ].includes(node.type);
}