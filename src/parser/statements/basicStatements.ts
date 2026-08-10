/**
 * Basic statement parsing methods
 * Handles block statements, expression statements, and empty statements
 */

import { TokenType, type Token } from '../../lexer';
import { UcodeErrorCode } from '../../analysis/errorConstants';
import {
  type AstNode, type BlockStatementNode, type ExpressionStatementNode, type EmptyStatementNode
} from '../../ast/nodes';
import { Precedence } from '../types';
import { ControlFlowStatements } from './controlFlowStatements';

export abstract class BasicStatements extends ControlFlowStatements {

  protected parseBlockStatement(openingBrace: Token | null, context: string): BlockStatementNode {
    // openingBrace is null only when the caller's `consume('{')` already failed (a parse
    // error was emitted) — fall back to the current position so we don't deref null.
    const start = openingBrace?.pos ?? this.peek()?.pos ?? 0;
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
      end: this.prevToken().end,
      body
    };
  }

  protected parseExpressionStatement(): ExpressionStatementNode | null {
    const start = this.peek()?.pos || 0;
    const firstTok = this.peek();
    const expression = this.parseExpression(Precedence.COMMA);

    if (!expression) return null;
    
    // Check for semicolon but don't let missing semicolon trigger panic mode
    const hadSemicolon = this.check(TokenType.TK_SCOL);
    if (hadSemicolon) {
      this.advance();
    } else {
      // Allow optional semicolons before closing tokens (}, EOF, etc.)
      const nextToken = this.peek()?.type;
      const isOptionalSemicolon = nextToken === TokenType.TK_RBRACE || 
                                 nextToken === TokenType.TK_EOF;
      
      if (!isOptionalSemicolon) {
        // A statement that BEGINS with a regex literal and then fails to terminate
        // is almost always a broken line comment (`/` typed for `//`): the lone
        // slash starts a regex that swallows everything to the next `/`, and every
        // diagnostic after it is noise - often a whole CASCADE of regex-led
        // statements. Point at the root cause ONCE and silence the echoes.
        if (firstTok && firstTok.type === TokenType.TK_REGEXP) {
          if (!this.regexCommentHintEmitted) {
            this.regexCommentHintEmitted = true;
            this.regexCommentHintLine = firstTok.line ?? -1;
            this.errorAt("This '/' starts a regex literal (running to the next unescaped '/', possibly across lines). If a comment was intended, use '//'. Diagnostics after this point may be side effects of the mis-lexed region.",
                         firstTok.pos, firstTok.pos + 1,
                         UcodeErrorCode.MISSING_SEMICOLON);
          }
          // Subsequent regex-led failures are the documented side effects - silent.
        } else if (this.regexCommentHintEmitted && firstTok?.line === this.regexCommentHintLine) {
          // Prose swallowed on the SAME line as the hinted broken comment parses as a
          // run of bare identifiers - each would add an "Expected ';'". All echoes.
        } else {
          // Record error but continue parsing
          this.errorAt("Expected ';' after expression",
                       this.previous()?.end || start,
                       this.previous()?.end || start,
                       UcodeErrorCode.MISSING_SEMICOLON);
        }
        // Reset panic mode for missing semicolon to allow subsequent errors
        this.panicMode = false;
      }
    }
    
    // Propagate a leading JSDoc block to a function expression assigned via `=`
    // (e.g. `/** @param {object} reg */ obj.init = function(reg) {…}`). The
    // comment precedes the statement, not the function node, so without this it
    // never reaches the function's params (types stay unknown, UC7003 still
    // fires). Mirrors the variable-declaration propagation in the analyzer.
    if (expression.type === 'AssignmentExpression') {
      const rhs = expression.right;
      if (rhs && (rhs.type === 'FunctionExpression' || rhs.type === 'ArrowFunctionExpression') && !rhs.leadingJsDoc) {
        const leadingJsDoc = this.findLeadingJsDoc(start);
        if (leadingJsDoc) rhs.leadingJsDoc = leadingJsDoc;
      }
    }

    return {
      type: 'ExpressionStatement',
      start,
      end: this.prevToken().end,
      expression
    };
  }

  protected parseEmptyStatement(): EmptyStatementNode {
    const token = this.prevToken();
    return {
      type: 'EmptyStatement',
      start: token.pos,
      end: token.end
    };
  }
}