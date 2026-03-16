/**
 * Primary expression parsing methods
 * Handles literals, identifiers, this, regex, and grouping
 */

import { TokenType } from '../../lexer';
import { AstNode, IdentifierNode, LiteralNode, ThisExpressionNode, FunctionExpressionNode, BlockStatementNode, TemplateLiteralNode, TemplateElementNode, SpreadElementNode } from '../../ast/nodes';
import { ParseRules } from '../parseRules';
import { Precedence } from '../types';

export abstract class PrimaryExpressions extends ParseRules {

  protected parseIdentifier(): IdentifierNode | null {
    const token = this.previous()!;

    // TK_FROM is a contextual keyword that can be used as an identifier
    // e.g.: import { from } from 'io'; from(resource);
    if (token.type === TokenType.TK_FROM) {
      return {
        type: 'Identifier',
        start: token.pos,
        end: token.end,
        name: 'from'
      };
    }

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
    // Import specifiers can be identifiers, contextual keywords (e.g. 'from'),
    // or string literals (quoted reserved words)
    if (this.check(TokenType.TK_LABEL)) {
      return this.parseIdentifierName();
    } else if (this.check(TokenType.TK_FROM)) {
      // 'from' is a contextual keyword, valid as an import specifier name
      // e.g.: import { from } from 'io';
      const token = this.advance()!;
      return {
        type: 'Identifier',
        start: token.pos,
        end: token.end,
        name: 'from'
      };
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
    else if (this.check(TokenType.TK_LABEL) || this.check(TokenType.TK_ELLIP)) {
      // Handle first parameter (normal identifier or rest parameter)
      if (this.check(TokenType.TK_ELLIP)) {
        this.advance(); // consume spread operator
        if (this.check(TokenType.TK_LABEL)) {
          this.advance(); // consume rest parameter name
        } else {
          // Invalid rest parameter - reset and fall back to regular parsing
          this.current = checkpoint;
          return this.parseExpression();
        }
      } else {
        this.advance(); // consume first identifier
      }
      
      // Check if there's a comma (multi-param) or closing paren followed by arrow
      if (this.check(TokenType.TK_COMMA)) {
        // Multiple parameters - likely arrow function
        while (this.check(TokenType.TK_COMMA)) {
          this.advance(); // consume comma
          if (this.check(TokenType.TK_ELLIP)) {
            this.advance(); // consume spread operator
            if (this.check(TokenType.TK_LABEL)) {
              this.advance(); // consume rest parameter name
              // Rest parameter must be the last one
              break;
            } else {
              break; // Invalid rest parameter
            }
          } else if (this.check(TokenType.TK_LABEL)) {
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
      const params: AstNode[] = [];
      
      if (!this.check(TokenType.TK_RPAREN)) {
        do {
          if (this.match(TokenType.TK_ELLIP)) {
            // Handle rest parameter: ...args
            const spreadStart = this.previous()!.pos;
            if (this.check(TokenType.TK_LABEL)) {
              const token = this.advance()!;
              const restParam: IdentifierNode = {
                type: 'Identifier',
                start: token.pos,
                end: token.end,
                name: token.value as string
              };
              const spreadElement: SpreadElementNode = {
                type: 'SpreadElement',
                start: spreadStart,
                end: token.end,
                argument: restParam
              };
              params.push(spreadElement);
              // Rest parameter must be the last one
              break;
            } else {
              this.error("Expected parameter name after '...'");
            }
          } else if (this.check(TokenType.TK_LABEL)) {
            const token = this.advance()!;
            const identifier: IdentifierNode = {
              type: 'Identifier',
              start: token.pos,
              end: token.end,
              name: token.value as string
            };
            params.push(identifier);
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
    const leadingJsDoc = this.findLeadingJsDoc(start);

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
    if (leadingJsDoc) {
      result.leadingJsDoc = leadingJsDoc;
    }

    return result;
  }

  protected parseTemplateLiteral(): TemplateLiteralNode {
    const startToken = this.previous()!;
    const start = startToken.pos;
    const quasis: TemplateElementNode[] = [];
    const expressions: AstNode[] = [];

    // Add the first quasi (the initial TK_TEMPLATE token)
    quasis.push({
      type: 'TemplateElement',
      start: startToken.pos,
      end: startToken.end,
      value: {
        raw: String(startToken.value),
        cooked: String(startToken.value)
      },
      tail: false // Not the last one yet
    });

    // Parse placeholders and subsequent template parts
    while (this.match(TokenType.TK_PLACEH)) {
      // Parse the expression inside ${...}
      const expr = this.parseExpression();
      if (!expr) {
        break;
      }
      expressions.push(expr);

      // Expect closing brace
      if (!this.match(TokenType.TK_RBRACE)) {
        // Error: expected }
        break;
      }

      // Now we should have another TK_TEMPLATE token (or we're done)
      if (this.match(TokenType.TK_TEMPLATE)) {
        const quasi = this.previous()!;
        quasis.push({
          type: 'TemplateElement',
          start: quasi.pos,
          end: quasi.end,
          value: {
            raw: String(quasi.value),
            cooked: String(quasi.value)
          },
          tail: false // Might not be the last
        });
      } else {
        // No more template parts
        break;
      }
    }

    // Mark the last quasi as tail
    if (quasis.length > 0) {
      const lastQuasi = quasis[quasis.length - 1];
      if (lastQuasi) {
        lastQuasi.tail = true;
      }
    }

    const lastQuasi = quasis.length > 0 ? quasis[quasis.length - 1] : null;
    const end = lastQuasi ? lastQuasi.end : startToken.end;

    return {
      type: 'TemplateLiteral',
      start,
      end,
      expressions,
      quasis
    };
  }

  // Abstract methods that must be implemented by subclasses
  protected abstract parseExpression(precedence?: any): AstNode | null;
  protected abstract parseBlockStatement(openingBrace: any, context: string): BlockStatementNode;
}