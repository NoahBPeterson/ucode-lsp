/**
 * Call and conditional expression parsing methods
 * Handles function calls, conditional expressions, and delete expressions
 */

import { TokenType } from '../../lexer';
import { UcodeErrorCode } from '../../analysis/errorConstants';
import {
  type AstNode, type CallExpressionNode, type ConditionalExpressionNode,
  type DeleteExpressionNode, type SpreadElementNode
} from '../../ast/nodes';
import { Precedence } from '../types';
import { OperatorExpressions } from './operatorExpressions';

export abstract class CallExpressions extends OperatorExpressions {

  protected parseCall(left: AstNode): CallExpressionNode {
    const start = left.start;
    const args: AstNode[] = [];
    
    // Check if this is an optional call ?.( by looking at the previous token
    // Note: For optional calls, we need to check if the token before the current position was TK_QLPAREN
    // The current implementation assumes parseCall is called after consuming the opening paren
    const prevToken = this.previous();
    const optional = prevToken?.type === TokenType.TK_QLPAREN;

    if (!this.check(TokenType.TK_RPAREN)) {
      do {
        // Check for spread element (...args)
        if (this.match(TokenType.TK_ELLIP)) {
          const argument = this.parseExpression();
          if (argument) {
            const spreadElement: SpreadElementNode = {
              type: 'SpreadElement',
              start: this.previous()!.pos,
              end: argument.end,
              argument
            };
            args.push(spreadElement);
          }
        } else {
          const arg = this.parseExpression();
          if (arg) args.push(arg);
        }
      } while (this.match(TokenType.TK_COMMA));
    }

    const rparen = this.consume(TokenType.TK_RPAREN, "Expected ')' after arguments");

    return {
      type: 'CallExpression',
      start,
      end: this.previous()!.end,
      callee: left,
      arguments: args,
      optional,
      // No closing paren consumed → the call is unterminated (error recovery). Its
      // recorded `end` stops at the last token seen (e.g. a trailing comma), so
      // signature help must treat its argument region as running to EOF (#85).
      unclosed: rparen === null
    };
  }

  protected parseConditional(left: AstNode): ConditionalExpressionNode | null {
    const consequent = this.parseExpression();
    if (!consequent) return null;

    this.consume(TokenType.TK_COLON, "Expected ':' after '?' in conditional expression");

    // The alternate is an ASSIGNMENT expression, like the consequent: ucode accepts
    // `cond ? a = 1 : b = 2` unparenthesized (verified vs the interpreter — the C compiler
    // inherits assignability from the enclosing statement via its exprstack parent walk, so
    // the trailing `= …` is absorbed into the member/label compile). Parsing the alternate
    // at CONDITIONAL excluded the `=`, and the outer Pratt loop then handed the whole
    // ternary to parseAssignment → spurious "Invalid assignment target". Right-associative
    // chaining (`a ? b : c ? d : e`) is unaffected: `?` binds tighter than `=`.
    const alternate = this.parseExpression(Precedence.ASSIGNMENT);
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

    // `delete object` (bare identifier / call result / anything non-member) is a
    // compile error in ucode — uc_compiler_compile_delete requires the operand to
    // compile to a property access ("expecting a property access expression"),
    // unconditionally in strict AND non-strict, for every target we support (the
    // strict-only gate belonged to the legacy delete() CALL form, removed 2022-01).
    // Parenthesized members (`delete (o.b)`) survive: grouping returns the inner node.
    if (argument.type !== 'MemberExpression') {
      this.errorAt("'delete' expects a property access expression (e.g. obj.key or obj[key])",
                   argument.start, argument.end, UcodeErrorCode.DELETE_NON_PROPERTY);
      this.panicMode = false;
    }

    return {
      type: 'DeleteExpression',
      start,
      end: argument.end,
      argument
    };
  }
}