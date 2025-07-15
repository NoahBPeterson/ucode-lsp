/**
 * Basic statement parsing methods
 * Handles block statements, expression statements, and empty statements
 */

import { TokenType } from '../../lexer';
import { 
  AstNode, BlockStatementNode, ExpressionStatementNode, EmptyStatementNode
} from '../../ast/nodes';
import { ControlFlowStatements } from './controlFlowStatements';

export abstract class BasicStatements extends ControlFlowStatements {

  protected parseBlockStatement(openingBrace: any, context: string): BlockStatementNode {
    const start = openingBrace.pos;
    const body: AstNode[] = [];
    
    while (!this.check(TokenType.TK_RBRACE) && !this.isAtEnd()) {
      const stmt = this.parseStatement();
      if (stmt) {
        body.push(stmt);
      }
    }
    
    this.consume(TokenType.TK_RBRACE, `Expected '}' to close ${context}`);
    
    return {
      type: 'BlockStatement',
      start,
      end: this.previous()!.end,
      body
    };
  }

  protected parseExpressionStatement(): ExpressionStatementNode | null {
    const start = this.peek()?.pos || 0;
    const expression = this.parseExpression();
    
    if (!expression) return null;
    
    this.consume(TokenType.TK_SCOL, "Expected ';' after expression");
    
    return {
      type: 'ExpressionStatement',
      start,
      end: this.previous()!.end,
      expression
    };
  }

  protected parseEmptyStatement(): EmptyStatementNode {
    const token = this.previous()!;
    return {
      type: 'EmptyStatement',
      start: token.pos,
      end: token.end
    };
  }
}