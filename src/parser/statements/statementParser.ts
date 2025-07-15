/**
 * Main statement parser that combines all statement parsing capabilities
 */

import { TokenType } from '../../lexer';
import { AstNode } from '../../ast/nodes';
import { RecoveryMode } from '../types';
import { BasicStatements } from './basicStatements';

export abstract class StatementParser extends BasicStatements {

  protected parseStatement(): AstNode | null {
    // Skip comments and handle error tokens
    if (this.match(TokenType.TK_COMMENT)) {
      return null; // Skip comments
    }

    if (this.check(TokenType.TK_ERROR)) {
      const errorToken = this.advance()!;
      const message = errorToken.value ? String(errorToken.value) : "Unexpected token";
      this.errorAt(message, errorToken.pos, errorToken.end);
      return null;
    }

    try {
      // Variable declarations
      if (this.match(TokenType.TK_LOCAL, TokenType.TK_CONST)) {
        return this.parseVariableDeclaration();
      }

      // Function declarations
      if (this.match(TokenType.TK_FUNC)) {
        return this.parseFunctionDeclaration();
      }

      // Control flow statements
      if (this.match(TokenType.TK_IF)) {
        return this.parseIfStatement();
      }

      if (this.match(TokenType.TK_WHILE)) {
        return this.parseWhileStatement();
      }

      if (this.match(TokenType.TK_FOR)) {
        return this.parseForStatement();
      }

      if (this.match(TokenType.TK_RETURN)) {
        return this.parseReturnStatement();
      }

      if (this.match(TokenType.TK_BREAK)) {
        return this.parseBreakStatement();
      }

      if (this.match(TokenType.TK_CONTINUE)) {
        return this.parseContinueStatement();
      }

      if (this.match(TokenType.TK_TRY)) {
        return this.parseTryStatement();
      }

      if (this.match(TokenType.TK_SWITCH)) {
        return this.parseSwitchStatement();
      }

      // Block statements
      if (this.match(TokenType.TK_LBRACE)) {
        const openingBrace = this.previous()!;
        return this.parseBlockStatement(openingBrace, "block statement");
      }

      // Empty statements
      if (this.match(TokenType.TK_SCOL)) {
        return this.parseEmptyStatement();
      }

      // Expression statements (default)
      return this.parseExpressionStatement();

    } catch (error) {
      // Statement-level error recovery
      this.synchronize(RecoveryMode.STATEMENT);
      return null;
    }
  }
}