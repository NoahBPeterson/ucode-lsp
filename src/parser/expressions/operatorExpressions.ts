/**
 * Operator expression parsing methods
 * Handles unary, binary, assignment, and postfix operations
 */

import { 
  type AstNode, type UnaryExpressionNode, type BinaryExpressionNode, 
  type AssignmentExpressionNode, type ArrowFunctionExpressionNode,
  type IdentifierNode, type BlockStatementNode
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

export abstract class OperatorExpressions extends CompositeExpressions {

  protected parseUnary(): UnaryExpressionNode | null {
    const operatorToken = this.previous()!;
    const operator = this.tokenToOperator(operatorToken.type);
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

    return {
      type: 'UnaryExpression',
      start: operatorToken.pos,
      end: argument.end,
      operator: operator as any,
      argument,
      prefix: true,
      absorbedAssignment,
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
    const leadingJsDoc = this.findLeadingJsDoc(left.start);

    // Parse parameters from the left side
    const params: IdentifierNode[] = [];
    let restParam: IdentifierNode | undefined = undefined;
    
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
        } else if (arg.type === 'SpreadElement') {
          // Handle rest parameter: ...args
          if (arg.argument && arg.argument.type === 'Identifier') {
            restParam = arg.argument as IdentifierNode;
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
      body = this.parseBlockStatement(openingBrace, "arrow function body") as BlockStatementNode;
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