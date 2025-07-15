/**
 * Control flow statement parsing methods
 * Handles if, while, for, return, break, continue, try, switch statements
 */

import { TokenType } from '../../lexer';
import { 
  AstNode, IfStatementNode, WhileStatementNode, ForStatementNode, 
  ForInStatementNode, ReturnStatementNode, BreakStatementNode, 
  ContinueStatementNode, TryStatementNode, CatchClauseNode, 
  SwitchStatementNode, SwitchCaseNode, BlockStatementNode, 
  IdentifierNode
} from '../../ast/nodes';
import { DeclarationStatements } from './declarationStatements';

export abstract class ControlFlowStatements extends DeclarationStatements {

  protected parseIfStatement(): IfStatementNode | null {
    const start = this.previous()!.pos;

    this.consume(TokenType.TK_LPAREN, "Expected '(' after 'if'");
    const test = this.parseExpression();
    if (!test) return null;

    this.consume(TokenType.TK_RPAREN, "Expected ')' after if condition");

    const consequent = this.parseStatement();
    if (!consequent) return null;

    let alternate: AstNode | null = null;
    if (this.match(TokenType.TK_ELSE)) {
      alternate = this.parseStatement();
    }

    return {
      type: 'IfStatement',
      start,
      end: (alternate || consequent).end,
      test,
      consequent,
      alternate
    };
  }

  protected parseWhileStatement(): WhileStatementNode | null {
    const start = this.previous()!.pos;

    this.consume(TokenType.TK_LPAREN, "Expected '(' after 'while'");
    const test = this.parseExpression();
    if (!test) return null;

    this.consume(TokenType.TK_RPAREN, "Expected ')' after while condition");

    const body = this.parseStatement();
    if (!body) return null;

    return {
      type: 'WhileStatement',
      start,
      end: body.end,
      test,
      body
    };
  }

  protected parseForStatement(): ForStatementNode | ForInStatementNode | null {
    const start = this.previous()!.pos;

    this.consume(TokenType.TK_LPAREN, "Expected '(' after 'for'");

    // Check for for-in loop
    if (this.check(TokenType.TK_LABEL)) {
      const checkpoint = this.current;
      const left = this.parseExpression();
      
      if (left && this.match(TokenType.TK_IN)) {
        const right = this.parseExpression();
        if (!right) return null;

        this.consume(TokenType.TK_RPAREN, "Expected ')' after for-in");
        const body = this.parseStatement();
        if (!body) return null;

        return {
          type: 'ForInStatement',
          start,
          end: body.end,
          left,
          right,
          body
        };
      } else {
        this.current = checkpoint;
      }
    }

    // Regular for loop
    let init: AstNode | null = null;
    if (!this.check(TokenType.TK_SCOL)) {
      if (this.match(TokenType.TK_LOCAL, TokenType.TK_CONST)) {
        init = this.parseVariableDeclaration();
      } else {
        init = this.parseExpression();
        this.consume(TokenType.TK_SCOL, "Expected ';' after for loop initializer");
      }
    } else {
      this.advance();
    }

    let test: AstNode | null = null;
    if (!this.check(TokenType.TK_SCOL)) {
      test = this.parseExpression();
    }
    this.consume(TokenType.TK_SCOL, "Expected ';' after for loop condition");

    let update: AstNode | null = null;
    if (!this.check(TokenType.TK_RPAREN)) {
      update = this.parseExpression();
    }
    this.consume(TokenType.TK_RPAREN, "Expected ')' after for loop");

    const body = this.parseStatement();
    if (!body) return null;

    return {
      type: 'ForStatement',
      start,
      end: body.end,
      init,
      test,
      update,
      body
    };
  }

  protected parseReturnStatement(): ReturnStatementNode {
    const start = this.previous()!.pos;
    
    let argument: AstNode | null = null;
    if (!this.check(TokenType.TK_SCOL) && !this.isAtEnd()) {
      argument = this.parseExpression();
    }
    
    this.consume(TokenType.TK_SCOL, "Expected ';' after return value");
    
    return {
      type: 'ReturnStatement',
      start,
      end: this.previous()!.end,
      argument
    };
  }

  protected parseBreakStatement(): BreakStatementNode {
    const start = this.previous()!.pos;
    
    let label: IdentifierNode | null = null;
    if (this.check(TokenType.TK_LABEL)) {
      label = this.parseIdentifierName();
    }
    
    this.consume(TokenType.TK_SCOL, "Expected ';' after 'break'");
    
    return {
      type: 'BreakStatement',
      start,
      end: this.previous()!.end,
      label
    };
  }

  protected parseContinueStatement(): ContinueStatementNode {
    const start = this.previous()!.pos;
    
    let label: IdentifierNode | null = null;
    if (this.check(TokenType.TK_LABEL)) {
      label = this.parseIdentifierName();
    }
    
    this.consume(TokenType.TK_SCOL, "Expected ';' after 'continue'");
    
    return {
      type: 'ContinueStatement',
      start,
      end: this.previous()!.end,
      label
    };
  }

  protected parseTryStatement(): TryStatementNode | null {
    const start = this.previous()!.pos;
    
    const openingBrace = this.consume(TokenType.TK_LBRACE, "Expected '{' after 'try'");
    const block = this.parseBlockStatement(openingBrace, "try block");
    
    let handler: CatchClauseNode | null = null;
    if (this.match(TokenType.TK_CATCH)) {
      const catchStart = this.previous()!.pos;
      
      let param: IdentifierNode | null = null;
      if (this.match(TokenType.TK_LPAREN)) {
        param = this.parseIdentifierName();
        this.consume(TokenType.TK_RPAREN, "Expected ')' after catch parameter");
      }
      
      const catchBrace = this.consume(TokenType.TK_LBRACE, "Expected '{' after catch");
      const body = this.parseBlockStatement(catchBrace, "catch block");
      
      handler = {
        type: 'CatchClause',
        start: catchStart,
        end: body.end,
        param,
        body
      };
    }
    
    let finalizer: BlockStatementNode | null = null;
    if (this.match(TokenType.TK_FINALLY)) {
      const finallyBrace = this.consume(TokenType.TK_LBRACE, "Expected '{' after 'finally'");
      finalizer = this.parseBlockStatement(finallyBrace, "finally block");
    }
    
    if (!handler && !finalizer) {
      this.error("Missing catch or finally after try");
      return null;
    }
    
    return {
      type: 'TryStatement',
      start,
      end: (finalizer || handler || block).end,
      block,
      handler,
      finalizer
    };
  }

  protected parseSwitchStatement(): SwitchStatementNode | null {
    const start = this.previous()!.pos;
    
    this.consume(TokenType.TK_LPAREN, "Expected '(' after 'switch'");
    const discriminant = this.parseExpression();
    if (!discriminant) return null;
    
    this.consume(TokenType.TK_RPAREN, "Expected ')' after switch discriminant");
    this.consume(TokenType.TK_LBRACE, "Expected '{' after switch");
    
    const cases: SwitchCaseNode[] = [];
    
    while (!this.check(TokenType.TK_RBRACE) && !this.isAtEnd()) {
      const caseStart = this.peek()?.pos || 0;
      
      let test: AstNode | null = null;
      if (this.match(TokenType.TK_CASE)) {
        test = this.parseExpression();
      } else if (this.match(TokenType.TK_DEFAULT)) {
        test = null;
      } else {
        this.error("Expected 'case' or 'default' in switch statement");
        break;
      }
      
      this.consume(TokenType.TK_COLON, "Expected ':' after case label");
      
      const consequent: AstNode[] = [];
      while (!this.check(TokenType.TK_CASE) && !this.check(TokenType.TK_DEFAULT) && 
             !this.check(TokenType.TK_RBRACE) && !this.isAtEnd()) {
        const stmt = this.parseStatement();
        if (stmt) {
          consequent.push(stmt);
        }
      }
      
      cases.push({
        type: 'SwitchCase',
        start: caseStart,
        end: consequent.length > 0 ? consequent[consequent.length - 1]!.end : caseStart,
        test,
        consequent
      });
    }
    
    this.consume(TokenType.TK_RBRACE, "Expected '}' after switch body");
    
    return {
      type: 'SwitchStatement',
      start,
      end: this.previous()!.end,
      discriminant,
      cases
    };
  }

  // Abstract method that must be implemented by subclasses
  protected abstract parseStatement(): AstNode | null;
}