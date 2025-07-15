/**
 * AST Visitor Pattern for semantic analysis
 * Provides base classes for traversing the AST
 */

import { 
  AstNode, ProgramNode, LiteralNode, IdentifierNode, BinaryExpressionNode,
  UnaryExpressionNode, CallExpressionNode, MemberExpressionNode, AssignmentExpressionNode,
  ArrayExpressionNode, ObjectExpressionNode, PropertyNode, BlockStatementNode,
  ExpressionStatementNode, VariableDeclarationNode, VariableDeclaratorNode,
  IfStatementNode, ForStatementNode, WhileStatementNode, FunctionDeclarationNode,
  ReturnStatementNode, BreakStatementNode, ContinueStatementNode, TryStatementNode,
  CatchClauseNode, SwitchStatementNode, SwitchCaseNode, ConditionalExpressionNode,
  ForInStatementNode, EmptyStatementNode, ThisExpressionNode, DeleteExpressionNode
} from '../ast/nodes';

export interface VisitorMethods {
  visitProgram?(node: ProgramNode): void;
  visitLiteral?(node: LiteralNode): void;
  visitIdentifier?(node: IdentifierNode): void;
  visitBinaryExpression?(node: BinaryExpressionNode): void;
  visitUnaryExpression?(node: UnaryExpressionNode): void;
  visitCallExpression?(node: CallExpressionNode): void;
  visitMemberExpression?(node: MemberExpressionNode): void;
  visitAssignmentExpression?(node: AssignmentExpressionNode): void;
  visitArrayExpression?(node: ArrayExpressionNode): void;
  visitObjectExpression?(node: ObjectExpressionNode): void;
  visitProperty?(node: PropertyNode): void;
  visitBlockStatement?(node: BlockStatementNode): void;
  visitExpressionStatement?(node: ExpressionStatementNode): void;
  visitVariableDeclaration?(node: VariableDeclarationNode): void;
  visitVariableDeclarator?(node: VariableDeclaratorNode): void;
  visitIfStatement?(node: IfStatementNode): void;
  visitForStatement?(node: ForStatementNode): void;
  visitForInStatement?(node: ForInStatementNode): void;
  visitWhileStatement?(node: WhileStatementNode): void;
  visitFunctionDeclaration?(node: FunctionDeclarationNode): void;
  visitReturnStatement?(node: ReturnStatementNode): void;
  visitBreakStatement?(node: BreakStatementNode): void;
  visitContinueStatement?(node: ContinueStatementNode): void;
  visitTryStatement?(node: TryStatementNode): void;
  visitCatchClause?(node: CatchClauseNode): void;
  visitSwitchStatement?(node: SwitchStatementNode): void;
  visitSwitchCase?(node: SwitchCaseNode): void;
  visitConditionalExpression?(node: ConditionalExpressionNode): void;
  visitEmptyStatement?(node: EmptyStatementNode): void;
  visitThisExpression?(node: ThisExpressionNode): void;
  visitDeleteExpression?(node: DeleteExpressionNode): void;
}

export class BaseVisitor implements VisitorMethods {
  visit(node: AstNode): void {
    switch (node.type) {
      case 'Program':
        this.visitProgram(node as ProgramNode);
        break;
      case 'Literal':
        this.visitLiteral(node as LiteralNode);
        break;
      case 'Identifier':
        this.visitIdentifier(node as IdentifierNode);
        break;
      case 'BinaryExpression':
        this.visitBinaryExpression(node as BinaryExpressionNode);
        break;
      case 'UnaryExpression':
        this.visitUnaryExpression(node as UnaryExpressionNode);
        break;
      case 'CallExpression':
        this.visitCallExpression(node as CallExpressionNode);
        break;
      case 'MemberExpression':
        this.visitMemberExpression(node as MemberExpressionNode);
        break;
      case 'AssignmentExpression':
        this.visitAssignmentExpression(node as AssignmentExpressionNode);
        break;
      case 'ArrayExpression':
        this.visitArrayExpression(node as ArrayExpressionNode);
        break;
      case 'ObjectExpression':
        this.visitObjectExpression(node as ObjectExpressionNode);
        break;
      case 'Property':
        this.visitProperty(node as PropertyNode);
        break;
      case 'BlockStatement':
        this.visitBlockStatement(node as BlockStatementNode);
        break;
      case 'ExpressionStatement':
        this.visitExpressionStatement(node as ExpressionStatementNode);
        break;
      case 'VariableDeclaration':
        this.visitVariableDeclaration(node as VariableDeclarationNode);
        break;
      case 'VariableDeclarator':
        this.visitVariableDeclarator(node as VariableDeclaratorNode);
        break;
      case 'IfStatement':
        this.visitIfStatement(node as IfStatementNode);
        break;
      case 'ForStatement':
        this.visitForStatement(node as ForStatementNode);
        break;
      case 'ForInStatement':
        this.visitForInStatement(node as ForInStatementNode);
        break;
      case 'WhileStatement':
        this.visitWhileStatement(node as WhileStatementNode);
        break;
      case 'FunctionDeclaration':
        this.visitFunctionDeclaration(node as FunctionDeclarationNode);
        break;
      case 'ReturnStatement':
        this.visitReturnStatement(node as ReturnStatementNode);
        break;
      case 'BreakStatement':
        this.visitBreakStatement(node as BreakStatementNode);
        break;
      case 'ContinueStatement':
        this.visitContinueStatement(node as ContinueStatementNode);
        break;
      case 'TryStatement':
        this.visitTryStatement(node as TryStatementNode);
        break;
      case 'CatchClause':
        this.visitCatchClause(node as CatchClauseNode);
        break;
      case 'SwitchStatement':
        this.visitSwitchStatement(node as SwitchStatementNode);
        break;
      case 'SwitchCase':
        this.visitSwitchCase(node as SwitchCaseNode);
        break;
      case 'ConditionalExpression':
        this.visitConditionalExpression(node as ConditionalExpressionNode);
        break;
      case 'EmptyStatement':
        this.visitEmptyStatement(node as EmptyStatementNode);
        break;
      case 'ThisExpression':
        this.visitThisExpression(node as ThisExpressionNode);
        break;
      case 'DeleteExpression':
        this.visitDeleteExpression(node as DeleteExpressionNode);
        break;
    }
  }

  visitProgram(node: ProgramNode): void {
    for (const statement of node.body) {
      this.visit(statement);
    }
  }

  visitLiteral(_node: LiteralNode): void {
    // Default: do nothing
  }

  visitIdentifier(_node: IdentifierNode): void {
    // Default: do nothing
  }

  visitBinaryExpression(node: BinaryExpressionNode): void {
    this.visit(node.left);
    this.visit(node.right);
  }

  visitUnaryExpression(node: UnaryExpressionNode): void {
    this.visit(node.argument);
  }

  visitCallExpression(node: CallExpressionNode): void {
    this.visit(node.callee);
    for (const arg of node.arguments) {
      this.visit(arg);
    }
  }

  visitMemberExpression(node: MemberExpressionNode): void {
    this.visit(node.object);
    this.visit(node.property);
  }

  visitAssignmentExpression(node: AssignmentExpressionNode): void {
    this.visit(node.left);
    this.visit(node.right);
  }

  visitArrayExpression(node: ArrayExpressionNode): void {
    for (const element of node.elements) {
      if (element) {
        this.visit(element);
      }
    }
  }

  visitObjectExpression(node: ObjectExpressionNode): void {
    for (const property of node.properties) {
      this.visit(property);
    }
  }

  visitProperty(node: PropertyNode): void {
    this.visit(node.key);
    this.visit(node.value);
  }

  visitBlockStatement(node: BlockStatementNode): void {
    for (const statement of node.body) {
      this.visit(statement);
    }
  }

  visitExpressionStatement(node: ExpressionStatementNode): void {
    this.visit(node.expression);
  }

  visitVariableDeclaration(node: VariableDeclarationNode): void {
    for (const declarator of node.declarations) {
      this.visit(declarator);
    }
  }

  visitVariableDeclarator(node: VariableDeclaratorNode): void {
    this.visit(node.id);
    if (node.init) {
      this.visit(node.init);
    }
  }

  visitIfStatement(node: IfStatementNode): void {
    this.visit(node.test);
    this.visit(node.consequent);
    if (node.alternate) {
      this.visit(node.alternate);
    }
  }

  visitForStatement(node: ForStatementNode): void {
    if (node.init) {
      this.visit(node.init);
    }
    if (node.test) {
      this.visit(node.test);
    }
    if (node.update) {
      this.visit(node.update);
    }
    this.visit(node.body);
  }

  visitForInStatement(node: ForInStatementNode): void {
    this.visit(node.left);
    this.visit(node.right);
    this.visit(node.body);
  }

  visitWhileStatement(node: WhileStatementNode): void {
    this.visit(node.test);
    this.visit(node.body);
  }

  visitFunctionDeclaration(node: FunctionDeclarationNode): void {
    this.visit(node.id);
    for (const param of node.params) {
      this.visit(param);
    }
    this.visit(node.body);
  }

  visitReturnStatement(node: ReturnStatementNode): void {
    if (node.argument) {
      this.visit(node.argument);
    }
  }

  visitBreakStatement(_node: BreakStatementNode): void {
    // Default: do nothing
  }

  visitContinueStatement(_node: ContinueStatementNode): void {
    // Default: do nothing
  }

  visitTryStatement(node: TryStatementNode): void {
    this.visit(node.block);
    if (node.handler) {
      this.visit(node.handler);
    }
    if (node.finalizer) {
      this.visit(node.finalizer);
    }
  }

  visitCatchClause(node: CatchClauseNode): void {
    if (node.param) {
      this.visit(node.param);
    }
    this.visit(node.body);
  }

  visitSwitchStatement(node: SwitchStatementNode): void {
    this.visit(node.discriminant);
    for (const case_ of node.cases) {
      this.visit(case_);
    }
  }

  visitSwitchCase(node: SwitchCaseNode): void {
    if (node.test) {
      this.visit(node.test);
    }
    for (const statement of node.consequent) {
      this.visit(statement);
    }
  }

  visitConditionalExpression(node: ConditionalExpressionNode): void {
    this.visit(node.test);
    this.visit(node.consequent);
    this.visit(node.alternate);
  }

  visitEmptyStatement(_node: EmptyStatementNode): void {
    // Default: do nothing
  }

  visitThisExpression(_node: ThisExpressionNode): void {
    // Default: do nothing
  }

  visitDeleteExpression(node: DeleteExpressionNode): void {
    this.visit(node.argument);
  }
}