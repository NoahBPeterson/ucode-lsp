/**
 * Declaration statement parsing methods
 * Handles variable declarations and function declarations
 */

import { TokenType } from '../../lexer';
import { 
  AstNode, VariableDeclarationNode, VariableDeclaratorNode, 
  FunctionDeclarationNode, IdentifierNode, BlockStatementNode
} from '../../ast/nodes';
import { ExpressionParser } from '../expressions/expressionParser';

export abstract class DeclarationStatements extends ExpressionParser {

  protected parseVariableDeclaration(): VariableDeclarationNode {
    const start = this.previous()!.pos;
    const kind = this.previous()!.type === TokenType.TK_CONST ? 'const' : 'let';
    const declarations: VariableDeclaratorNode[] = [];

    do {
      const declarator = this.parseVariableDeclarator();
      if (declarator) {
        declarations.push(declarator);
      }
    } while (this.match(TokenType.TK_COMMA));

    this.consume(TokenType.TK_SCOL, "Expected ';' after variable declaration");

    return {
      type: 'VariableDeclaration',
      start,
      end: this.previous()!.end,
      kind,
      declarations
    };
  }

  private parseVariableDeclarator(): VariableDeclaratorNode | null {
    const start = this.peek()?.pos || 0;
    
    if (!this.check(TokenType.TK_LABEL)) {
      this.error("Expected variable name");
      return null;
    }

    const id = this.parseIdentifierName();
    if (!id) return null;

    let init: AstNode | null = null;
    if (this.match(TokenType.TK_ASSIGN)) {
      init = this.parseExpression();
    }

    return {
      type: 'VariableDeclarator',
      start,
      end: this.previous()!.end,
      id,
      init
    };
  }

  protected parseFunctionDeclaration(): FunctionDeclarationNode | null {
    const start = this.previous()!.pos;

    if (!this.check(TokenType.TK_LABEL)) {
      this.error("Expected function name");
      return null;
    }

    const id = this.parseIdentifierName();
    if (!id) return null;

    this.consume(TokenType.TK_LPAREN, "Expected '(' after function name");

    const params: IdentifierNode[] = [];
    if (!this.check(TokenType.TK_RPAREN)) {
      do {
        const param = this.parseIdentifierName();
        if (param) {
          params.push(param);
        }
      } while (this.match(TokenType.TK_COMMA));
    }

    this.consume(TokenType.TK_RPAREN, "Expected ')' after parameters");

    const openingBrace = this.consume(TokenType.TK_LBRACE, "Expected '{' to start function body");
    const body = this.parseBlockStatement(openingBrace, "function body");

    return {
      type: 'FunctionDeclaration',
      start,
      end: body.end,
      id,
      params,
      body
    };
  }

  // Abstract method that must be implemented by subclasses
  protected abstract parseBlockStatement(openingBrace: any, context: string): BlockStatementNode;
}