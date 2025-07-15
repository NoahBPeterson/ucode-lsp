/**
 * Call and conditional expression parsing methods
 * Handles function calls, conditional expressions, and delete expressions
 */

import { TokenType } from '../../lexer';
import { 
  AstNode, CallExpressionNode, ConditionalExpressionNode, 
  DeleteExpressionNode 
} from '../../ast/nodes';
import { Precedence } from '../types';
import { OperatorExpressions } from './operatorExpressions';

export abstract class CallExpressions extends OperatorExpressions {

  protected parseCall(left: AstNode): CallExpressionNode {
    const start = left.start;
    const args: AstNode[] = [];

    if (!this.check(TokenType.TK_RPAREN)) {
      do {
        const arg = this.parseExpression();
        if (arg) args.push(arg);
      } while (this.match(TokenType.TK_COMMA));
    }

    this.consume(TokenType.TK_RPAREN, "Expected ')' after arguments");

    return {
      type: 'CallExpression',
      start,
      end: this.previous()!.end,
      callee: left,
      arguments: args
    };
  }

  protected parseConditional(left: AstNode): ConditionalExpressionNode | null {
    const consequent = this.parseExpression();
    if (!consequent) return null;

    this.consume(TokenType.TK_COLON, "Expected ':' after '?' in conditional expression");
    
    const alternate = this.parseExpression(Precedence.CONDITIONAL);
    if (!alternate) return null;

    return {
      type: 'ConditionalExpression',
      start: left.start,
      end: alternate.end,
      test: left,
      consequent,
      alternate
    };
  }

  protected parseDelete(): DeleteExpressionNode | null {
    const start = this.previous()!.pos;
    const argument = this.parseExpression(Precedence.UNARY);
    if (!argument) return null;

    return {
      type: 'DeleteExpression',
      start,
      end: argument.end,
      argument
    };
  }
}