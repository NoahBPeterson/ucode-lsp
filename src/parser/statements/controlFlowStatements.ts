/**
 * Control flow statement parsing methods
 * Handles if, while, for, return, break, continue, try, switch statements
 */

import { TokenType } from '../../lexer';
import { UcodeErrorCode } from '../../analysis/errorConstants';
import {
  type AstNode, type IfStatementNode, type WhileStatementNode, type ForStatementNode,
  type ForInStatementNode, type ReturnStatementNode, type BreakStatementNode, 
  type ContinueStatementNode, type TryStatementNode, type CatchClauseNode, 
  type SwitchStatementNode, type SwitchCaseNode, type BlockStatementNode,
  type IdentifierNode, type VariableDeclarationNode, type VariableDeclaratorNode
} from '../../ast/nodes';
import { DeclarationStatements } from './declarationStatements';
import { Precedence } from '../types';

export abstract class ControlFlowStatements extends DeclarationStatements {

  /**
   * Parse the single-statement body of a control-flow construct (the non-block arm
   * of an `if`/`else`/`while`/`for`).
   *
   * ucode declarations (`let`/`const`) are NOT statements: uc_compiler_compile_statement
   * (compiler.c) has no TK_LOCAL/TK_CONST case, so a bare `if (x) let y = …;` falls
   * through to the expression parser and fails to compile with "Expecting expression"
   * pointing at the keyword. Declarations are only legal at block/program level (via
   * uc_compiler_compile_declaration). Mirror that: surface a targeted syntax error and
   * still parse the declaration for scope/type recovery. `construct` names the arm for
   * the message (e.g. "an 'if' statement").
   */
  protected parseControlFlowBody(construct: string): AstNode | null {
    if (this.check(TokenType.TK_LOCAL) || this.check(TokenType.TK_CONST)) {
      const kw = this.peek()!;
      const kind = kw.type === TokenType.TK_CONST ? 'const' : 'let';
      this.errorAt(
        `a '${kind}' declaration cannot be the body of ${construct}; wrap it in a block { … }`,
        kw.pos, kw.end, UcodeErrorCode.DECLARATION_AS_CONTROL_BODY);
      this.panicMode = false;
      this.advance(); // consume let/const; parseVariableDeclaration reads it via previous()
      return this.parseVariableDeclaration();
    }
    return this.parseStatement();
  }

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
    // Parse at COMMA precedence so the sequence operator is accepted in the condition
    // (`if (a = 1, b = 2)` is valid ucode — verified vs /usr/local/bin/ucode), matching
    // parenthesized expressions and the for-init/update productions.
    const test = this.parseExpression(Precedence.COMMA);
    if (!test) return null;

    this.consume(TokenType.TK_RPAREN, "Expected ')' after if condition");

    // Alternative colon-block syntax: `if (x): … elif (y): … else … endif` (template form).
    if (this.check(TokenType.TK_COLON)) {
      return this.parseColonIfStatement(start, test);
    }

    const consequent = this.parseControlFlowBody("an 'if' statement");
    if (!consequent) return null;

    let alternate: AstNode | null = null;
    if (this.match(TokenType.TK_ELSE)) {
      alternate = this.parseControlFlowBody("an 'else' clause");
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

  /** Parse the body of a colon-block branch — statements up to (but not consuming) any
   *  of the `stops` tokens (e.g. `elif`/`else`/`endif`). Used by the alternative
   *  `if (x): … endif` template syntax, where the consequent/else bodies are bounded by
   *  block-control keywords rather than braces. */
  private parseColonBranchBody(stops: TokenType[]): BlockStatementNode {
    const start = this.peek()?.pos || 0;
    const statements: AstNode[] = [];
    while (!stops.some(s => this.check(s)) && !this.isAtEnd()) {
      const stmt = this.parseStatement();
      if (stmt) {
        statements.push(stmt);
      } else {
        this.advance();
      }
    }
    return {
      type: 'BlockStatement',
      start,
      end: this.previous()?.end ?? start,
      body: statements
    } as BlockStatementNode;
  }

  /** `if (test): … [elif (c): …]* [else …] endif`. The whole chain shares ONE `endif`:
   *  an `elif` recurses (consuming the shared `endif`), so this caller must not consume
   *  it again on that path. */
  private parseColonIfStatement(start: number, test: AstNode): IfStatementNode {
    this.consume(TokenType.TK_COLON, "Expected ':' for if block");
    const consequent = this.parseColonBranchBody([TokenType.TK_ELIF, TokenType.TK_ELSE, TokenType.TK_ENDIF]);

    let alternate: AstNode | null = null;

    if (this.check(TokenType.TK_ELIF)) {
      const elifStart = this.peek()!.pos;
      this.advance(); // 'elif'
      this.consume(TokenType.TK_LPAREN, "Expected '(' after 'elif'");
      const elifTest = this.parseExpression(Precedence.COMMA);
      this.consume(TokenType.TK_RPAREN, "Expected ')' after elif condition");
      // Recurse — the nested if consumes the shared `endif`.
      alternate = elifTest ? this.parseColonIfStatement(elifStart, elifTest) : null;
      return { type: 'IfStatement', start, end: this.previous()!.end, test, consequent, alternate };
    }

    if (this.match(TokenType.TK_ELSE)) {
      if (this.check(TokenType.TK_COLON)) this.advance(); // optional `else:`
      alternate = this.parseColonBranchBody([TokenType.TK_ENDIF]);
    }

    this.consume(TokenType.TK_ENDIF, "Expected 'endif' to close if block");
    return { type: 'IfStatement', start, end: this.previous()!.end, test, consequent, alternate };
  }

  protected parseWhileStatement(): WhileStatementNode | null {
    const start = this.previous()!.pos;

    this.consume(TokenType.TK_LPAREN, "Expected '(' after 'while'");
    // COMMA precedence — `while (a = next(), b = next())` is valid ucode (the sequence
    // operator drives the multi-assignment loop-condition idiom in the corpus).
    const test = this.parseExpression(Precedence.COMMA);
    if (!test) return null;

    this.consume(TokenType.TK_RPAREN, "Expected ')' after while condition");

    // Alternative colon-block syntax: `while (x): … endwhile` (template form).
    const body = this.check(TokenType.TK_COLON)
      ? this.parseColonEndBlock(TokenType.TK_ENDWHILE, "endwhile")
      : this.parseControlFlowBody("a 'while' loop");
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
      const kwToken = this.peek(); // `let`/`const` keyword (or the bare identifier)
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
        // `for (const a in x)` is a JS-ism: ucode's for grammar only matches TK_LOCAL
        // (uc_compiler_compile_for) — `const` falls through to the expression path and
        // fails to compile ("Expecting expression"). Keep parsing for scope/type
        // recovery, but surface the compile error, anchored on the keyword.
        if (kwToken && kwToken.type === TokenType.TK_CONST) {
          this.errorAt("ucode does not allow 'const' in a for loop; use 'let'",
                       kwToken.pos, kwToken.end, UcodeErrorCode.FOR_LOOP_CONST);
          this.panicMode = false;
        }
        const right = this.parseExpression();
        if (!right) return null;

        this.consume(TokenType.TK_RPAREN, "Expected ')' after for-in");
        
        // Check for colon-endfor syntax vs regular statement/block
        let body: AstNode | null = null;
        if (this.check(TokenType.TK_COLON)) {
          body = this.parseColonEndBlock(TokenType.TK_ENDFOR, "endfor");
        } else {
          body = this.parseControlFlowBody("a 'for' loop");
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
        // Same JS-ism in the C-style form: `for (const i = 0; …)` fails to compile.
        const kw = this.previous()!;
        if (kw.type === TokenType.TK_CONST) {
          this.errorAt("ucode does not allow 'const' in a for loop; use 'let'",
                       kw.pos, kw.end, UcodeErrorCode.FOR_LOOP_CONST);
          this.panicMode = false;
        }
        init = this.parseVariableDeclaration();
      } else {
        init = this.parseExpression();
        this.consume(TokenType.TK_SCOL, "Expected ';' after for loop initializer", UcodeErrorCode.MISSING_SEMICOLON);
      }
    } else {
      this.advance();
    }

    let test: AstNode | null = null;
    if (!this.check(TokenType.TK_SCOL)) {
      test = this.parseExpression();
    }
    this.consume(TokenType.TK_SCOL, "Expected ';' after for loop condition", UcodeErrorCode.MISSING_SEMICOLON);

    let update: AstNode | null = null;
    if (!this.check(TokenType.TK_RPAREN)) {
      update = this.parseExpression(Precedence.COMMA);
    }
    this.consume(TokenType.TK_RPAREN, "Expected ')' after for loop");

    const body = this.parseControlFlowBody("a 'for' loop");
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
    // A return value's terminating `;` is optional immediately before a block close `}`
    // (or EOF) — that's valid ucode, verified vs the interpreter, strict and non-strict —
    // but still required between two statements. Mirror the general statement-terminator
    // rule so `return expr` before `}` isn't a false UC6004, while `return expr` followed
    // by another statement still is. Also skip parsing an expression for bare `return }`.
    if (!this.check(TokenType.TK_SCOL) && !this.check(TokenType.TK_RBRACE) && !this.isAtEnd()) {
      argument = this.parseExpression();
    }

    if (this.check(TokenType.TK_RBRACE) || this.isAtEnd()) {
      this.match(TokenType.TK_SCOL); // optional before block close / EOF
    } else {
      this.consume(TokenType.TK_SCOL, "Expected ';' after return value", UcodeErrorCode.MISSING_SEMICOLON);
    }
    
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
      // Labelled break is a JS-ism: ucode has no labels — uc_compiler_compile_control
      // takes no operand, so the statement must end at `;` ("Expecting ';'"). Consume
      // the label for recovery (nothing downstream validates it) but surface the error.
      const labelToken = this.peek()!;
      label = this.parseIdentifierName();
      this.errorAt("ucode does not support labels; expected ';' after 'break'",
                   labelToken.pos, labelToken.end, UcodeErrorCode.LABELED_BREAK_CONTINUE);
      this.panicMode = false;
    }

    this.consume(TokenType.TK_SCOL, "Expected ';' after 'break'", UcodeErrorCode.MISSING_SEMICOLON);
    
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
      // Same JS-ism as labelled break — see parseBreakStatement.
      const labelToken = this.peek()!;
      label = this.parseIdentifierName();
      this.errorAt("ucode does not support labels; expected ';' after 'continue'",
                   labelToken.pos, labelToken.end, UcodeErrorCode.LABELED_BREAK_CONTINUE);
      this.panicMode = false;
    }

    this.consume(TokenType.TK_SCOL, "Expected ';' after 'continue'", UcodeErrorCode.MISSING_SEMICOLON);
    
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
    // COMMA precedence — `switch (a, b)` is valid ucode (the discriminant is a full
    // expression, sequence operator included).
    const discriminant = this.parseExpression(Precedence.COMMA);
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