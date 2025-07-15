/**
 * Main expression parser that combines all expression parsing capabilities
 */

import { TokenType } from '../../lexer';
import { AstNode } from '../../ast/nodes';
import { Precedence, RecoveryMode } from '../types';
import { CallExpressions } from './callExpressions';

export abstract class ExpressionParser extends CallExpressions {

  protected parseExpression(precedence: Precedence = Precedence.ASSIGNMENT): AstNode | null {
    try {
      // Handle error tokens in expressions too
      if (this.check(TokenType.TK_ERROR)) {
        const errorToken = this.advance()!;
        const message = errorToken.value ? String(errorToken.value) : "Unexpected token";
        this.errorAt(message, errorToken.pos, errorToken.end);
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
    }
  }
}