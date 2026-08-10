/**
 * Operator expression parsing methods
 * Handles unary, binary, assignment, and postfix operations
 */

import {
  type AstNode, type UnaryExpressionNode, type BinaryExpressionNode,
  type AssignmentExpressionNode, type ArrowFunctionExpressionNode,
  type IdentifierNode
} from '../../ast/nodes';
import { TokenType } from '../../lexer';
import { Precedence } from '../types';
import { CompositeExpressions } from './compositeExpressions';

/** All assignment-operator tokens (`=`, `+=`, … `??=`). */
const ASSIGNMENT_OPERATORS: ReadonlySet<TokenType> = new Set([
  TokenType.TK_ASSIGN, TokenType.TK_ASADD, TokenType.TK_ASSUB, TokenType.TK_ASMUL,
  TokenType.TK_ASDIV, TokenType.TK_ASMOD, TokenType.TK_ASEXP, TokenType.TK_ASLEFT,
  TokenType.TK_ASRIGHT, TokenType.TK_ASBAND, TokenType.TK_ASBXOR, TokenType.TK_ASBOR,
  TokenType.TK_ASAND, TokenType.TK_ASOR, TokenType.TK_ASNULLISH,
]);

/** Prefix unary operators that wrap a following assignment (`!`, `~`, `+`, `-`).
 *  NOT `++`/`--`: ucode rejects `++a = b` ("Invalid increment/decrement operand"). */
const ASSIGN_ABSORBING_UNARY: ReadonlySet<TokenType> = new Set([
  TokenType.TK_NOT, TokenType.TK_COMPL, TokenType.TK_ADD, TokenType.TK_SUB,
]);

/** Token → operator for the tokens registered with parseUnary (prefix position).
 *  The table is the validation: mapping at the parser boundary is what turns a
 *  token kind into a typed operator. */
const UNARY_OPERATOR_BY_TOKEN: Partial<Record<TokenType, UnaryExpressionNode['operator']>> = {
  [TokenType.TK_ADD]: '+',
  [TokenType.TK_SUB]: '-',
  [TokenType.TK_NOT]: '!',
  [TokenType.TK_COMPL]: '~',
  [TokenType.TK_INC]: '++',
  [TokenType.TK_DEC]: '--',
};

/** Token → operator for the tokens registered with parseBinary. TK_COMMA is the
 *  one binary-rule token deliberately absent: `,` is not (yet) a member of
 *  BinaryExpressionNode['operator'] (widening that union is a src/ast/nodes.ts
 *  change), so the comma keeps its historical assertion in parseBinary. */
const BINARY_OPERATOR_BY_TOKEN: Partial<Record<TokenType, BinaryExpressionNode['operator']>> = {
  [TokenType.TK_ADD]: '+',
  [TokenType.TK_SUB]: '-',
  [TokenType.TK_MUL]: '*',
  [TokenType.TK_DIV]: '/',
  [TokenType.TK_MOD]: '%',
  [TokenType.TK_EXP]: '**',
  [TokenType.TK_EQ]: '==',
  [TokenType.TK_NE]: '!=',
  [TokenType.TK_EQS]: '===',
  [TokenType.TK_NES]: '!==',
  [TokenType.TK_LT]: '<',
  [TokenType.TK_LE]: '<=',
  [TokenType.TK_GT]: '>',
  [TokenType.TK_GE]: '>=',
  [TokenType.TK_AND]: '&&',
  [TokenType.TK_OR]: '||',
  [TokenType.TK_BAND]: '&',
  [TokenType.TK_BOR]: '|',
  [TokenType.TK_BXOR]: '^',
  [TokenType.TK_LSHIFT]: '<<',
  [TokenType.TK_RSHIFT]: '>>',
  [TokenType.TK_IN]: 'in',
  [TokenType.TK_NULLISH]: '??',
};

/** Token → operator for the tokens registered with parseAssignment
 *  (the ASSIGNMENT_OPERATORS set above, given their typed spellings). */
const ASSIGNMENT_OPERATOR_BY_TOKEN: Partial<Record<TokenType, AssignmentExpressionNode['operator']>> = {
  [TokenType.TK_ASSIGN]: '=',
  [TokenType.TK_ASADD]: '+=',
  [TokenType.TK_ASSUB]: '-=',
  [TokenType.TK_ASMUL]: '*=',
  [TokenType.TK_ASDIV]: '/=',
  [TokenType.TK_ASMOD]: '%=',
  [TokenType.TK_ASEXP]: '**=',
  [TokenType.TK_ASLEFT]: '<<=',
  [TokenType.TK_ASRIGHT]: '>>=',
  [TokenType.TK_ASBAND]: '&=',
  [TokenType.TK_ASBXOR]: '^=',
  [TokenType.TK_ASBOR]: '|=',
  [TokenType.TK_ASAND]: '&&=',
  [TokenType.TK_ASOR]: '||=',
  [TokenType.TK_ASNULLISH]: '??=',
};

export abstract class OperatorExpressions extends CompositeExpressions {

  protected parseUnary(): UnaryExpressionNode | null {
    const operatorToken = this.previous()!;
    const operator = UNARY_OPERATOR_BY_TOKEN[operatorToken.type];
    let argument = this.parseExpression(Precedence.UNARY);
    let absorbedAssignment = false;

    if (!argument) return null;

    // ucode parses `<unary> <lvalue> = <rhs>` as `<unary>(<lvalue> = <rhs>)`:
    // assignment binds *below* a prefix unary operator, and the assignment target
    // is the unary's operand. Verified against ucode — `!k[2] = f()` runs as
    // `!(k[2] = f())`, and `!a += b` as `!(a += b)`. Our Pratt loop parses the
    // operand at UNARY precedence (above ASSIGNMENT), so the trailing assignment
    // must be absorbed here; otherwise the outer loop hands a non-lvalue unary to
    // parseAssignment and we emit a spurious "Invalid assignment target".
    // Scope matches ucode exactly: only `! ~ + -` (not `++`/`--`), and only when
    // the operand is itself an lvalue (Identifier/MemberExpression) — ucode rejects
    // `!(a+1) = b` and `!a() = 5`.
    const nextType = this.peek()?.type;
    if (nextType !== undefined &&
        ASSIGN_ABSORBING_UNARY.has(operatorToken.type) &&
        ASSIGNMENT_OPERATORS.has(nextType) &&
        (argument.type === 'Identifier' || argument.type === 'MemberExpression')) {
      this.advance(); // consume the assignment operator (parseAssignment reads previous())
      const assigned = this.parseAssignment(argument);
      if (!assigned) return null;
      argument = assigned;
      absorbedAssignment = true;
    }

    if (operator === undefined) return null;

    return {
      type: 'UnaryExpression',
      start: operatorToken.pos,
      end: argument.end,
      operator,
      argument,
      prefix: true,
      absorbedAssignment,
    };
  }

  protected parseBinary(left: AstNode): BinaryExpressionNode | null {
    const operatorToken = this.previous()!;
    // TK_COMMA (the sequence operator — reachable via `(a, b)` and `for (i = 0, j = 1; …)`)
    // is the one binary-rule token whose operator is missing from
    // BinaryExpressionNode['operator']; see BINARY_OPERATOR_BY_TOKEN.
    const operator = BINARY_OPERATOR_BY_TOKEN[operatorToken.type] ?? ',';
    const rule = this.getRule(operatorToken.type);

    const right = this.parseExpression(rule.precedence + 1);
    if (!right) return null;

    return {
      type: 'BinaryExpression',
      start: left.start,
      end: right.end,
      operator,
      left,
      right
    };
  }

  protected parseAssignment(left: AstNode): AssignmentExpressionNode | null {
    const operatorToken = this.previous()!;
    const operator = ASSIGNMENT_OPERATOR_BY_TOKEN[operatorToken.type];

    if (left.type !== 'Identifier' && left.type !== 'MemberExpression') {
      this.error("Invalid assignment target");
      return null;
    }

    const right = this.parseExpression(Precedence.ASSIGNMENT);
    if (!right) return null;

    if (operator === undefined) return null;

    return {
      type: 'AssignmentExpression',
      start: left.start,
      end: right.end,
      operator,
      left,
      right
    };
  }

  protected parsePostfix(left: AstNode): UnaryExpressionNode {
    const operatorToken = this.previous()!;
    // Only TK_INC/TK_DEC are registered as postfix rules.
    const operator: UnaryExpressionNode['operator'] = operatorToken.type === TokenType.TK_DEC ? '--' : '++';

    return {
      type: 'UnaryExpression',
      start: left.start,
      end: operatorToken.end,
      operator,
      argument: left,
      prefix: false
    };
  }

  protected parseArrowFunction(left: AstNode): ArrowFunctionExpressionNode | null {
    const leadingJsDoc = this.findLeadingJsDoc(left.start);

    // Parse parameters from the left side
    const params: IdentifierNode[] = [];
    let restParam: IdentifierNode | undefined = undefined;
    
    if (left.type === 'Identifier') {
      // Single parameter without parentheses: param => body
      params.push(left);
    } else if (left.type === 'CallExpression') {
      // This is actually a parameter list: (param1, param2) => body
      // The left side would be parsed as a call expression with arguments
      for (const arg of left.arguments) {
        if (arg.type === 'Identifier') {
          params.push(arg);
        } else if (arg.type === 'SpreadElement') {
          // Handle rest parameter: ...args
          if (arg.argument && arg.argument.type === 'Identifier') {
            restParam = arg.argument;
            // Params after a rest param already got their one UC6011 in
            // parseGrouping; keep converting them so they stay declared for
            // body analysis (recovery).
          } else {
            this.error("Invalid rest parameter in arrow function");
            return null;
          }
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
      const openingBrace = this.consume(TokenType.TK_LBRACE, "Expected '{' for arrow function body");
      body = this.parseBlockStatement(openingBrace, "arrow function body");
      expression = false;
    } else {
      // Expression body: => expression
      body = this.parseExpression(Precedence.ASSIGNMENT);
      expression = true;
    }
    
    if (!body) return null;
    
    const arrowFunctionNode: ArrowFunctionExpressionNode = {
      type: 'ArrowFunctionExpression',
      start: left.start,
      end: body.end,
      params,
      body,
      expression
    };

    if (restParam) {
      arrowFunctionNode.restParam = restParam;
    }
    if (leadingJsDoc) {
      arrowFunctionNode.leadingJsDoc = leadingJsDoc;
    }

    return arrowFunctionNode;
  }
}