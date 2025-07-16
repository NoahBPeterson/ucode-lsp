/**
 * Operator expression parsing methods
 * Handles unary, binary, assignment, and postfix operations
 */

import { 
  AstNode, UnaryExpressionNode, BinaryExpressionNode, 
  AssignmentExpressionNode, ArrowFunctionExpressionNode,
  IdentifierNode, BlockStatementNode
} from '../../ast/nodes';
import { TokenType } from '../../lexer';
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

  protected parseArrowFunction(left: AstNode): ArrowFunctionExpressionNode | null {
    // arrowToken is the => token, but we don't need to use it currently
    
    // Parse parameters from the left side
    const params: IdentifierNode[] = [];
    
    if (left.type === 'Identifier') {
      // Single parameter without parentheses: param => body
      params.push(left as IdentifierNode);
    } else if (left.type === 'CallExpression') {
      // This is actually a parameter list: (param1, param2) => body
      // The left side would be parsed as a call expression with arguments
      const callExpr = left as any;
      for (const arg of callExpr.arguments) {
        if (arg.type === 'Identifier') {
          params.push(arg as IdentifierNode);
        } else {
          this.error("Invalid parameter in arrow function");
          return null;
        }
      }
    } else {
      // For now, we'll support the basic cases
      // More complex parameter patterns can be added later
      this.error("Invalid parameters for arrow function");
      return null;
    }
    
    // Parse the body - can be an expression or block statement
    let body: AstNode | null;
    let expression: boolean;
    
    if (this.check(TokenType.TK_LBRACE)) {
      // Block statement body: => { ... }
      // For now, we'll create a basic block-like structure
      const start = this.peek()!.pos;
      this.advance(); // consume '{'
      
      // Skip to the matching closing brace for now
      let braceCount = 1;
      const bodyStart = this.peek()?.pos || start;
      let bodyEnd = bodyStart;
      
      while (braceCount > 0 && !this.isAtEnd()) {
        if (this.check(TokenType.TK_LBRACE)) {
          braceCount++;
        } else if (this.check(TokenType.TK_RBRACE)) {
          braceCount--;
        }
        bodyEnd = this.peek()?.end || bodyEnd;
        this.advance();
      }
      
      // Create a simple block representation
      body = {
        type: 'BlockStatement',
        start,
        end: bodyEnd,
        body: [] // Empty for now - proper parsing would go here
      } as BlockStatementNode;
      expression = false;
    } else {
      // Expression body: => expression
      body = this.parseExpression(Precedence.ASSIGNMENT);
      expression = true;
    }
    
    if (!body) return null;
    
    return {
      type: 'ArrowFunctionExpression',
      start: left.start,
      end: body.end,
      params,
      body,
      expression
    };
  }
}