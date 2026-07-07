/**
 * Main expression parser that combines all expression parsing capabilities
 */

import { TokenType } from '../../lexer';
import { type AstNode } from '../../ast/nodes';
import { Precedence, RecoveryMode, STATEMENT_SYNC_TOKENS } from '../types';
import { CallExpressions } from './callExpressions';

export abstract class ExpressionParser extends CallExpressions {

  /**
   * Nesting depth of the recursive-descent expression parser. Each parenthesised /
   * bracketed sub-expression descends one level, and every level burns several JS call
   * frames — so a pathologically nested expression (thousands of `(`) would silently blow
   * the Node call stack (RangeError), which the catch below turned into confusing cascaded
   * "Expected ';'"/"Unexpected token" errors. We cap the depth well below the crash point
   * (~1950 levels observed) and emit a single clear diagnostic instead. Real ucode has no
   * cap either — it just segfaults at extreme nesting — so any realistic program (which
   * never nests more than a handful deep) is unaffected.
   */
  private expressionDepth = 0;
  private static readonly MAX_EXPRESSION_DEPTH = 1000;

  protected parseExpression(precedence: Precedence = Precedence.ASSIGNMENT): AstNode | null {
    this.expressionDepth++;
    try {
      if (this.expressionDepth > ExpressionParser.MAX_EXPRESSION_DEPTH) {
        const tok = this.peek();
        const pos = tok?.pos ?? (this.previous()?.end ?? 0);
        const end = tok?.end ?? pos;
        // errorAt sets panicMode, so the many `consume(')')` calls unwinding above us stay
        // quiet (no cascade). Then skip the rest of this over-nested expression up to the
        // next statement boundary so the parser makes progress and terminates cleanly.
        this.errorAt("Expression is too deeply nested to parse", pos, end);
        while (!this.isAtEnd() && !STATEMENT_SYNC_TOKENS.includes(this.peek()!.type)) {
          this.advance();
        }
        return null;
      }

      // Handle error tokens in expressions too
      if (this.check(TokenType.TK_ERROR)) {
        const errorToken = this.advance()!;
        const message = errorToken.value ? String(errorToken.value) : "Unexpected token";
        this.lexerErrorAt(message, errorToken.pos, errorToken.end);
        return null;
      }

      const prefixRule = this.getRule(this.peek()?.type).prefix;

      // If there's no prefix rule, it's not a valid expression start
      if (!prefixRule) {
        this.error("Unexpected token in expression");
        this.advance(); // Consume the invalid token
        return null;
      }

      this.advance();
      let left = prefixRule();
      if (!left) return null;

      while (precedence <= this.getRule(this.peek()?.type).precedence) {
        const infixRule = this.getRule(this.peek()?.type).infix;
        if (!infixRule) break;

        this.advance();
        left = infixRule(left);
        if (!left) break;
      }

      return left;
    } catch (error) {
      this.synchronize(RecoveryMode.EXPRESSION);
      return null;
    } finally {
      this.expressionDepth--;
    }
  }
}