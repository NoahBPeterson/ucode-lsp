/**
 * Parser rules initialization
 */

import { TokenType } from '../lexer';
import { Precedence, ParseRule } from './types';
import { ParserUtils } from './parserUtils';

export abstract class ParseRules extends ParserUtils {
  protected rules: Map<TokenType, ParseRule> = new Map();

  // Abstract methods that must be implemented by subclasses
  protected abstract parseLiteral(type: string): any;
  protected abstract parseIdentifier(): any;
  protected abstract parseThis(): any;
  protected abstract parseRegex(): any;
  protected abstract parseGrouping(): any;
  protected abstract parseCall(left: any): any;
  protected abstract parseArray(): any;
  protected abstract parseMemberAccess(left: any): any;
  protected abstract parseObject(): any;
  protected abstract parseUnary(): any;
  protected abstract parseBinary(left: any): any;
  protected abstract parsePostfix(left: any): any;
  protected abstract parseAssignment(left: any): any;
  protected abstract parseConditional(left: any): any;
  protected abstract parseDelete(): any;
  protected abstract parseFunctionExpression(): any;
  protected abstract parseArrowFunction(left: any): any;
  protected abstract parseTemplateLiteral(): any;

  protected initializeParseRules(): void {
    // Primary expressions
    this.rules.set(TokenType.TK_NUMBER, { 
      prefix: () => this.parseLiteral('number'), 
      precedence: Precedence.NONE 
    });
    this.rules.set(TokenType.TK_DOUBLE, { 
      prefix: () => this.parseLiteral('double'), 
      precedence: Precedence.NONE 
    });
    this.rules.set(TokenType.TK_STRING, { 
      prefix: () => this.parseLiteral('string'), 
      precedence: Precedence.NONE 
    });
    this.rules.set(TokenType.TK_TRUE, { 
      prefix: () => this.parseLiteral('boolean'), 
      precedence: Precedence.NONE 
    });
    this.rules.set(TokenType.TK_FALSE, { 
      prefix: () => this.parseLiteral('boolean'), 
      precedence: Precedence.NONE 
    });
    this.rules.set(TokenType.TK_NULL, { 
      prefix: () => this.parseLiteral('null'), 
      precedence: Precedence.NONE 
    });
    this.rules.set(TokenType.TK_TEMPLATE, { 
      prefix: () => this.parseTemplateLiteral(), 
      precedence: Precedence.NONE 
    });
    this.rules.set(TokenType.TK_LABEL, { 
      prefix: () => this.parseIdentifier(), 
      precedence: Precedence.NONE 
    });
    this.rules.set(TokenType.TK_THIS, { 
      prefix: () => this.parseThis(), 
      precedence: Precedence.NONE 
    });
    this.rules.set(TokenType.TK_REGEXP, { 
      prefix: () => this.parseRegex(), 
      precedence: Precedence.NONE 
    });

    // Grouping
    this.rules.set(TokenType.TK_LPAREN, { 
      prefix: () => this.parseGrouping(), 
      infix: (left) => this.parseCall(left),
      precedence: Precedence.CALL 
    });

    // Array and object literals
    this.rules.set(TokenType.TK_LBRACK, { 
      prefix: () => this.parseArray(),
      infix: (left) => this.parseMemberAccess(left),
      precedence: Precedence.CALL 
    });
    this.rules.set(TokenType.TK_LBRACE, { 
      prefix: () => this.parseObject(), 
      precedence: Precedence.NONE 
    });

    // Unary operators
    this.rules.set(TokenType.TK_NOT, { 
      prefix: () => this.parseUnary(), 
      precedence: Precedence.NONE 
    });
    this.rules.set(TokenType.TK_SUB, { 
      prefix: () => this.parseUnary(),
      infix: (left) => this.parseBinary(left),
      precedence: Precedence.ADDITIVE 
    });
    this.rules.set(TokenType.TK_ADD, { 
      prefix: () => this.parseUnary(),
      infix: (left) => this.parseBinary(left),
      precedence: Precedence.ADDITIVE 
    });
    this.rules.set(TokenType.TK_COMPL, { 
      prefix: () => this.parseUnary(), 
      precedence: Precedence.NONE 
    });
    this.rules.set(TokenType.TK_INC, { 
      prefix: () => this.parseUnary(),
      infix: (left) => this.parsePostfix(left),
      precedence: Precedence.POSTFIX 
    });
    this.rules.set(TokenType.TK_DEC, { 
      prefix: () => this.parseUnary(),
      infix: (left) => this.parsePostfix(left),
      precedence: Precedence.POSTFIX 
    });

    // Binary operators
    this.addBinaryRule(TokenType.TK_MUL, Precedence.MULTIPLICATIVE);
    this.addBinaryRule(TokenType.TK_DIV, Precedence.MULTIPLICATIVE);
    this.addBinaryRule(TokenType.TK_MOD, Precedence.MULTIPLICATIVE);
    this.addBinaryRule(TokenType.TK_EXP, Precedence.EXPONENTIAL);
    
    this.addBinaryRule(TokenType.TK_LT, Precedence.RELATIONAL);
    this.addBinaryRule(TokenType.TK_LE, Precedence.RELATIONAL);
    this.addBinaryRule(TokenType.TK_GT, Precedence.RELATIONAL);
    this.addBinaryRule(TokenType.TK_GE, Precedence.RELATIONAL);
    this.addBinaryRule(TokenType.TK_IN, Precedence.RELATIONAL);
    
    this.addBinaryRule(TokenType.TK_EQ, Precedence.EQUALITY);
    this.addBinaryRule(TokenType.TK_NE, Precedence.EQUALITY);
    this.addBinaryRule(TokenType.TK_EQS, Precedence.EQUALITY);
    this.addBinaryRule(TokenType.TK_NES, Precedence.EQUALITY);
    
    this.addBinaryRule(TokenType.TK_BAND, Precedence.BITWISE_AND);
    this.addBinaryRule(TokenType.TK_BXOR, Precedence.BITWISE_XOR);
    this.addBinaryRule(TokenType.TK_BOR, Precedence.BITWISE_OR);
    this.addBinaryRule(TokenType.TK_LSHIFT, Precedence.SHIFT);
    this.addBinaryRule(TokenType.TK_RSHIFT, Precedence.SHIFT);
    
    this.addBinaryRule(TokenType.TK_AND, Precedence.LOGICAL_AND);
    this.addBinaryRule(TokenType.TK_OR, Precedence.LOGICAL_OR);
    this.addBinaryRule(TokenType.TK_NULLISH, Precedence.NULLISH);

    // Assignment operators
    this.addAssignmentRule(TokenType.TK_ASSIGN);
    this.addAssignmentRule(TokenType.TK_ASADD);
    this.addAssignmentRule(TokenType.TK_ASSUB);
    this.addAssignmentRule(TokenType.TK_ASMUL);
    this.addAssignmentRule(TokenType.TK_ASDIV);
    this.addAssignmentRule(TokenType.TK_ASMOD);
    this.addAssignmentRule(TokenType.TK_ASEXP);
    this.addAssignmentRule(TokenType.TK_ASLEFT);
    this.addAssignmentRule(TokenType.TK_ASRIGHT);
    this.addAssignmentRule(TokenType.TK_ASBAND);
    this.addAssignmentRule(TokenType.TK_ASBXOR);
    this.addAssignmentRule(TokenType.TK_ASBOR);
    this.addAssignmentRule(TokenType.TK_ASAND);
    this.addAssignmentRule(TokenType.TK_ASOR);
    this.addAssignmentRule(TokenType.TK_ASNULLISH);

    // Member access
    this.rules.set(TokenType.TK_DOT, { 
      infix: (left) => this.parseMemberAccess(left),
      precedence: Precedence.CALL 
    });
    
    // Optional chaining operators
    this.rules.set(TokenType.TK_QDOT, { 
      infix: (left) => this.parseMemberAccess(left),
      precedence: Precedence.CALL 
    });
    this.rules.set(TokenType.TK_QLBRACK, { 
      infix: (left) => this.parseMemberAccess(left),
      precedence: Precedence.CALL 
    });
    this.rules.set(TokenType.TK_QLPAREN, { 
      infix: (left) => this.parseCall(left),
      precedence: Precedence.CALL 
    });

    // Conditional operator
    this.rules.set(TokenType.TK_QMARK, { 
      infix: (left) => this.parseConditional(left),
      precedence: Precedence.CONDITIONAL 
    });

    // Delete operator
    this.rules.set(TokenType.TK_DELETE, { 
      prefix: () => this.parseDelete(), 
      precedence: Precedence.NONE 
    });

    // Function expressions
    this.rules.set(TokenType.TK_FUNC, { 
      prefix: () => this.parseFunctionExpression(), 
      precedence: Precedence.NONE 
    });

    // Arrow function operator
    this.rules.set(TokenType.TK_ARROW, { 
      infix: (left) => this.parseArrowFunction(left), 
      precedence: Precedence.ASSIGNMENT 
    });
  }

  private addBinaryRule(tokenType: TokenType, precedence: Precedence): void {
    this.rules.set(tokenType, {
      infix: (left) => this.parseBinary(left),
      precedence
    });
  }

  private addAssignmentRule(tokenType: TokenType): void {
    this.rules.set(tokenType, {
      infix: (left) => this.parseAssignment(left),
      precedence: Precedence.ASSIGNMENT
    });
  }

  protected getRule(tokenType: TokenType | undefined): ParseRule {
    if (!tokenType) {
      return { precedence: Precedence.NONE };
    }
    
    return this.rules.get(tokenType) || { precedence: Precedence.NONE };
  }
}