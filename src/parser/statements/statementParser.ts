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
      // Import declarations
      if (this.match(TokenType.TK_IMPORT)) {
        return this.parseImportDeclaration();
      }

      // Export declarations
      if (this.match(TokenType.TK_EXPORT)) {
        return this.parseExportDeclaration();
      }

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
        // Check if 'try' is followed by '{' to determine if it's a try statement
        if (this.check(TokenType.TK_LBRACE)) {
          return this.parseTryStatement();
        } else {
          // 'try' is not followed by '{', treat it as an identifier
          // Back up one token so it can be parsed as an expression
          this.current--;
          this.warningAt("'try' keyword used as identifier", this.peek()!.pos, this.peek()!.end);
          return this.parseExpressionStatement();
        }
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