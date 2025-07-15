/**
 * Primary expression parsing methods
 * Handles literals, identifiers, this, regex, and grouping
 */

import { TokenType } from '../../lexer';
import { AstNode, IdentifierNode, LiteralNode, ThisExpressionNode } from '../../ast/nodes';
import { ParseRules } from '../parseRules';

export abstract class PrimaryExpressions extends ParseRules {

  protected parseIdentifier(): IdentifierNode | null {
    const token = this.previous()!;
    
    if (token.type !== TokenType.TK_LABEL) {
      this.error("Expected identifier");
      return null;
    }

    return {
      type: 'Identifier',
      start: token.pos,
      end: token.end,
      name: token.value as string
    };
  }

  protected parseIdentifierName(): IdentifierNode | null {
    if (!this.check(TokenType.TK_LABEL)) {
      this.error("Expected identifier");
      return null;
    }

    const token = this.advance()!;
    return {
      type: 'Identifier',
      start: token.pos,
      end: token.end,
      name: token.value as string
    };
  }

  protected parseLiteral(literalType: string): LiteralNode {
    const token = this.previous()!;
    let value: string | number | boolean | null;

    switch (literalType) {
      case 'number':
        value = Number(token.value);
        break;
      case 'double':
        value = Number(token.value);
        break;
      case 'string':
        value = String(token.value);
        break;
      case 'boolean':
        value = token.type === TokenType.TK_TRUE;
        break;
      case 'null':
        value = null;
        break;
      case 'regexp':
        value = String(token.value);
        break;
      default:
        value = token.value;
    }

    return {
      type: 'Literal',
      start: token.pos,
      end: token.end,
      value,
      raw: String(token.value),
      literalType: literalType as any
    };
  }

  protected parseThis(): ThisExpressionNode {
    const token = this.previous()!;
    return {
      type: 'ThisExpression',
      start: token.pos,
      end: token.end
    };
  }

  protected parseRegex(): LiteralNode {
    const token = this.previous()!;
    return {
      type: 'Literal',
      start: token.pos,
      end: token.end,
      value: String(token.value),
      raw: String(token.value),
      literalType: 'regexp'
    };
  }

  protected parseGrouping(): AstNode | null {
    const expr = this.parseExpression();
    this.consume(TokenType.TK_RPAREN, "Expected ')' after expression");
    return expr;
  }

  // Abstract method that must be implemented by subclasses
  protected abstract parseExpression(precedence?: any): AstNode | null;
}