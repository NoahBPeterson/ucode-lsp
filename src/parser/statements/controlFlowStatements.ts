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
  IdentifierNode, VariableDeclarationNode, VariableDeclaratorNode
} from '../../ast/nodes';
import { DeclarationStatements } from './declarationStatements';
import { Precedence } from '../types';

export abstract class ControlFlowStatements extends DeclarationStatements {

  /**
   * Parse a colon-end block (e.g., : statements endfor)
   * Used by for-in, while, if statements when using colon syntax
   */
  protected parseColonEndBlock(endToken: TokenType, endKeyword: string): BlockStatementNode | null {
    const start = this.peek()?.pos || 0;
    
    this.consume(TokenType.TK_COLON, `Expected ':' for ${endKeyword} block`);
    
    const statements: AstNode[] = [];
    
    // Parse statements until we hit the end token
    while (!this.check(endToken) && !this.isAtEnd()) {
      const stmt = this.parseStatement();
      if (stmt) {
        statements.push(stmt);
      } else {
        // If we can't parse a statement, skip this token and try again
        this.advance();
      }
    }
    
    this.consume(endToken, `Expected '${endKeyword}' to close block`);
    
    // Return a block statement containing all the statements
    return {
      type: 'BlockStatement',
      start,
      end: this.previous()!.end,
      body: statements
    } as BlockStatementNode;
  }

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

  private parseVariableDeclarationWithoutSemicolon(): VariableDeclarationNode {
    const start = this.previous()!.pos;
    const kind = this.previous()!.type === TokenType.TK_CONST ? 'const' : 'let';
    const declarations: VariableDeclaratorNode[] = [];

    // Parse variable declarators for for-in loops (supports 1 or 2 variables)
    do {
      if (this.check(TokenType.TK_LABEL)) {
        const idStart = this.peek()?.pos || 0;
        const name = this.advance()!.value as string;
        
        const declarator: VariableDeclaratorNode = {
          type: 'VariableDeclarator',
          start: idStart,
          end: this.previous()!.end,
          id: {
            type: 'Identifier',
            start: idStart,
            end: this.previous()!.end,
            name
          },
          init: null // No initialization in for-in loops
        };
        
        declarations.push(declarator);
      }
      
      // Support for two-variable syntax: let i, item in array
      // Break if we encounter 'in' or if we've parsed 2 variables already
      if (this.check(TokenType.TK_IN) || declarations.length >= 2) {
        break;
      }
    } while (this.match(TokenType.TK_COMMA));

    // No semicolon expected in for-in loop declarations
    return {
      type: 'VariableDeclaration',
      start,
      end: this.previous()!.end,
      kind,
      declarations
    };
  }

  protected parseForStatement(): ForStatementNode | ForInStatementNode | null {
    const start = this.previous()!.pos;

    this.consume(TokenType.TK_LPAREN, "Expected '(' after 'for'");

    // Check for for-in loop
    if (this.check(TokenType.TK_LABEL) || this.check(TokenType.TK_LOCAL) || this.check(TokenType.TK_CONST)) {
      const checkpoint = this.current;
      let left: AstNode | null = null;
      
      // Handle variable declarations in for-in loops
      if (this.match(TokenType.TK_LOCAL, TokenType.TK_CONST)) {
        left = this.parseVariableDeclarationWithoutSemicolon();
      } else {
        // Parse only the left-hand side identifier, not a full expression
        // to avoid consuming the 'in' operator as part of a binary expression
        left = this.parseIdentifierName();
      }
      
      if (left && this.match(TokenType.TK_IN)) {
        const right = this.parseExpression();
        if (!right) return null;

        this.consume(TokenType.TK_RPAREN, "Expected ')' after for-in");
        
        // Check for colon-endfor syntax vs regular statement/block
        let body: AstNode | null = null;
        if (this.check(TokenType.TK_COLON)) {
          body = this.parseColonEndBlock(TokenType.TK_ENDFOR, "endfor");
        } else {
          body = this.parseStatement();
        }
        
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
      update = this.parseExpression(Precedence.COMMA);
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
    
    if (!handler) {
      this.error("Missing catch after try");
      return null;
    }
    
    return {
      type: 'TryStatement',
      start,
      end: (handler || block).end,
      block,
      handler
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