/**
 * Operator expression parsing methods
 * Handles unary, binary, assignment, and postfix operations
 */

import { 
  AstNode, UnaryExpressionNode, BinaryExpressionNode, 
  AssignmentExpressionNode 
} from '../../ast/nodes';
import { Precedence } from '../types';
import { CompositeExpressions } from './compositeExpressions';

export abstract class OperatorExpressions extends CompositeExpressions {

  protected parseUnary(): UnaryExpressionNode | null {
    const operatorToken = this.previous()!;
    const operator = this.tokenToOperator(operatorToken.type);
    const argument = this.parseExpression(Precedence.UNARY);
    
    if (!argument) return null;

    return {
      type: 'UnaryExpression',
      start: operatorToken.pos,
      end: argument.end,
      operator: operator as any,
      argument,
      prefix: true
    };
  }

  protected parseBinary(left: AstNode): BinaryExpressionNode | null {
    const operatorToken = this.previous()!;
    const operator = this.tokenToOperator(operatorToken.type);
    const rule = this.getRule(operatorToken.type);
    
    const right = this.parseExpression(rule.precedence + 1);
    if (!right) return null;

    return {
      type: 'BinaryExpression',
      start: left.start,
      end: right.end,
      operator: operator as any,
      left,
      right
    };
  }

  protected parseAssignment(left: AstNode): AssignmentExpressionNode | null {
    const operatorToken = this.previous()!;
    const operator = this.tokenToOperator(operatorToken.type);
    
    if (left.type !== 'Identifier' && left.type !== 'MemberExpression') {
      this.error("Invalid assignment target");
      return null;
    }

    const right = this.parseExpression(Precedence.ASSIGNMENT);
    if (!right) return null;

    return {
      type: 'AssignmentExpression',
      start: left.start,
      end: right.end,
      operator: operator as any,
      left,
      right
    };
  }

  protected parsePostfix(left: AstNode): UnaryExpressionNode {
    const operatorToken = this.previous()!;
    const operator = this.tokenToOperator(operatorToken.type);

    return {
      type: 'UnaryExpression',
      start: left.start,
      end: operatorToken.end,
      operator: operator as any,
      argument: left,
      prefix: false
    };
  }
}