/**
 * Primary expression parsing methods
 * Handles literals, identifiers, this, regex, and grouping
 */

import { TokenType } from '../../lexer';
import { AstNode, IdentifierNode, LiteralNode, ThisExpressionNode, FunctionExpressionNode, BlockStatementNode, TemplateLiteralNode, TemplateElementNode } from '../../ast/nodes';
import { ParseRules } from '../parseRules';
import { Precedence } from '../types';

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

  protected parseImportSpecifierName(): IdentifierNode | null {
    // Import specifiers can be either identifiers (regular names) or string literals (quoted reserved words)
    if (this.check(TokenType.TK_LABEL)) {
      return this.parseIdentifierName();
    } else if (this.check(TokenType.TK_STRING)) {
      const token = this.advance()!;
      // Convert string literal to identifier for import specifier
      return {
        type: 'Identifier',
        start: token.pos,
        end: token.end,
        name: token.value as string // Remove quotes from string value
      };
    } else {
      this.error("Expected identifier or string literal in import specifier");
      return null;
    }
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
    // Check if this might be arrow function parameters by looking ahead
    const checkpoint = this.current;
    let isArrowParams = false;
    
    // Try to detect if this is an arrow function parameter list
    // Look for patterns: () => or (identifier [, identifier]* ) =>
    
    // Check for empty parameter list: () =>
    if (this.check(TokenType.TK_RPAREN)) {
      this.advance(); // consume closing paren
      if (this.check(TokenType.TK_ARROW)) {
        isArrowParams = true;
      }
    }
    // Check for parameter list with identifiers: (identifier [, identifier]* ) =>
    else if (this.check(TokenType.TK_LABEL)) {
      this.advance(); // consume first identifier
      
      // Check if there's a comma (multi-param) or closing paren followed by arrow
      if (this.check(TokenType.TK_COMMA)) {
        // Multiple parameters - likely arrow function
        while (this.check(TokenType.TK_COMMA)) {
          this.advance(); // consume comma
          if (this.check(TokenType.TK_LABEL)) {
            this.advance(); // consume next identifier
          } else {
            break; // Invalid parameter list
          }
        }
        if (this.check(TokenType.TK_RPAREN)) {
          this.advance(); // consume closing paren
          if (this.check(TokenType.TK_ARROW)) {
            isArrowParams = true;
          }
        }
      } else if (this.check(TokenType.TK_RPAREN)) {
        this.advance(); // consume closing paren
        if (this.check(TokenType.TK_ARROW)) {
          isArrowParams = true;
        }
      }
    }
    
    // Reset position
    this.current = checkpoint;
    
    if (isArrowParams) {
      // Parse as parameter list for arrow function
      const params: IdentifierNode[] = [];
      
      if (!this.check(TokenType.TK_RPAREN)) {
        do {
          if (this.check(TokenType.TK_LABEL)) {
            const token = this.advance()!;
            params.push({
              type: 'Identifier',
              start: token.pos,
              end: token.end,
              name: token.value as string
            });
          }
        } while (this.match(TokenType.TK_COMMA));
      }
      
      this.consume(TokenType.TK_RPAREN, "Expected ')' after arrow function parameters");
      
      // Create a fake CallExpression node with parameters as arguments
      // This is what the arrow function parser expects
      const prevToken = this.previous();
      return {
        type: 'CallExpression',
        start: params.length > 0 ? params[0]!.start : (prevToken?.pos || 0),
        end: prevToken?.end || 0,
        callee: {
          type: 'Identifier',
          start: 0,
          end: 0,
          name: '__arrow_params__'
        } as IdentifierNode,
        arguments: params
      } as any;
    } else {
      // Parse as regular grouped expression with comma operator support
      const expr = this.parseExpression(Precedence.COMMA);
      this.consume(TokenType.TK_RPAREN, "Expected ')' after expression");
      return expr;
    }
  }

  protected parseFunctionExpression(): FunctionExpressionNode | null {
    const start = this.previous()!.pos;

    // Function expressions can be anonymous, so ID is optional
    let id: IdentifierNode | null = null;
    if (this.check(TokenType.TK_LABEL)) {
      id = this.parseIdentifierName();
    }

    this.consume(TokenType.TK_LPAREN, "Expected '(' after 'function'");

    const params: IdentifierNode[] = [];
    let restParam: IdentifierNode | undefined = undefined;
    
    if (!this.check(TokenType.TK_RPAREN)) {
      do {
        // Check for rest parameter (...)
        if (this.match(TokenType.TK_ELLIP)) {
          const param = this.parseIdentifierName();
          if (param) {
            restParam = param;
            // Rest parameter must be the last parameter
            break;
          }
        } else {
          const param = this.parseIdentifierName();
          if (param) {
            params.push(param);
          }
        }
      } while (this.match(TokenType.TK_COMMA));
    }

    this.consume(TokenType.TK_RPAREN, "Expected ')' after parameters");

    const openingBrace = this.consume(TokenType.TK_LBRACE, "Expected '{' to start function body");
    const body = this.parseBlockStatement(openingBrace, "function expression body");

    const result: FunctionExpressionNode = {
      type: 'FunctionExpression',
      start,
      end: body.end,
      id,
      params,
      body
    };
    
    if (restParam) {
      result.restParam = restParam;
    }
    
    return result;
  }

  protected parseTemplateLiteral(): TemplateLiteralNode {
    const token = this.previous()!;
    const templateValue = String(token.value);
    
    // For now, parse the template literal as a single quasi without expressions
    // TODO: Implement proper parsing of embedded expressions ${...}
    const quasi: TemplateElementNode = {
      type: 'TemplateElement',
      start: token.pos,
      end: token.end,
      value: {
        raw: templateValue,
        cooked: templateValue // For now, just use the raw value
      },
      tail: true // This is the only/last quasi
    };

    return {
      type: 'TemplateLiteral',
      start: token.pos,
      end: token.end,
      expressions: [], // No embedded expressions for now
      quasis: [quasi]
    };
  }

  // Abstract methods that must be implemented by subclasses
  protected abstract parseExpression(precedence?: any): AstNode | null;
  protected abstract parseBlockStatement(openingBrace: any, context: string): BlockStatementNode;
}