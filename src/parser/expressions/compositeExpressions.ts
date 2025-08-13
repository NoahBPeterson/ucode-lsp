/**
 * Composite expression parsing methods
 * Handles arrays, objects, and member access
 */

import { TokenType } from '../../lexer';
import { 
  AstNode, IdentifierNode, ArrayExpressionNode, ObjectExpressionNode, 
  PropertyNode, MemberExpressionNode, LiteralNode 
} from '../../ast/nodes';
import { PrimaryExpressions } from './primaryExpressions';

export abstract class CompositeExpressions extends PrimaryExpressions {

  protected parseArray(): ArrayExpressionNode {
    const start = this.previous()!.pos;
    const elements: (AstNode | null)[] = [];

    if (!this.check(TokenType.TK_RBRACK)) {
      do {
        if (this.check(TokenType.TK_COMMA)) {
          elements.push(null);
        } else {
          const expr = this.parseExpression();
          elements.push(expr);
        }
      } while (this.match(TokenType.TK_COMMA));
    }

    this.consume(TokenType.TK_RBRACK, "Expected ']' after array elements");

    return {
      type: 'ArrayExpression',
      start,
      end: this.previous()!.end,
      elements
    };
  }

  protected parseObject(): ObjectExpressionNode {
    const start = this.previous()!.pos;
    const properties: PropertyNode[] = [];

    if (!this.check(TokenType.TK_RBRACE)) {
      do {
        let key: AstNode;
        let computed = false;

        if (this.match(TokenType.TK_LBRACK)) {
          computed = true;
          key = this.parseExpression() || { type: 'Identifier', start: 0, end: 0, name: '' } as IdentifierNode;
          this.consume(TokenType.TK_RBRACK, "Expected ']' after computed property key");
        } else if (this.check(TokenType.TK_LABEL)) {
          // Accept labels as property keys - treat them as string literals, not identifiers
          const token = this.advance()!;
          key = {
            type: 'Literal',
            start: token.pos,
            end: token.end,
            value: token.value as string,
            raw: token.value as string,
            literalType: 'string'
          } as LiteralNode;
        } else if (this.check(TokenType.TK_NUMBER) || this.check(TokenType.TK_DOUBLE)) {
          // Accept numbers as property keys (they become string keys)
          const token = this.advance()!;
          key = {
            type: 'Literal',
            start: token.pos,
            end: token.end,
            value: token.value as string,
            raw: token.value as string,
            literalType: 'string'
          } as LiteralNode;
        } else if (this.check(TokenType.TK_STRING)) {
          this.advance();
          key = this.parseLiteral('string');
        } else {
          this.error("Expected property name");
          break;
        }

        this.consume(TokenType.TK_COLON, "Expected ':' after property key");
        
        const value = this.parseExpression();
        if (!value) continue;

        properties.push({
          type: 'Property',
          start: key.start,
          end: value.end,
          key,
          value,
          computed
        });
      } while (this.match(TokenType.TK_COMMA));
    }

    this.consume(TokenType.TK_RBRACE, "Expected '}' after object properties");

    return {
      type: 'ObjectExpression',
      start,
      end: this.previous()!.end,
      properties
    };
  }

  protected parseMemberAccess(left: AstNode): MemberExpressionNode | null {
    const operatorToken = this.previous()!;
    const computed = operatorToken.type === TokenType.TK_LBRACK || operatorToken.type === TokenType.TK_QLBRACK;
    const optional = operatorToken.type === TokenType.TK_QDOT || operatorToken.type === TokenType.TK_QLBRACK;
    
    let property: AstNode;
    
    if (computed) {
      property = this.parseExpression() || { type: 'Identifier', start: 0, end: 0, name: '' } as IdentifierNode;
      this.consume(TokenType.TK_RBRACK, "Expected ']' after computed property");
    } else {
      if (!this.check(TokenType.TK_LABEL)) {
        this.error("Expected property name after '.' or '?.'");
        return null;
      }
      property = this.parseIdentifierName() || { type: 'Identifier', start: 0, end: 0, name: '' } as IdentifierNode;
    }

    return {
      type: 'MemberExpression',
      start: left.start,
      end: property.end,
      object: left,
      property,
      computed,
      optional
    };
  }
}