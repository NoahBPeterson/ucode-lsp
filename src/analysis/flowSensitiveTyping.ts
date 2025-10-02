/**
 * Flow-Sensitive Type Tracking for ucode semantic analysis
 * Handles type narrowing within conditional blocks and control flow
 */

import { UcodeType, UcodeDataType, SymbolTable } from './symbolTable';
import { TypeNarrowingEngine } from './typeNarrowing';
import { AstNode, IdentifierNode, BinaryExpressionNode, IfStatementNode } from '../ast/nodes';

export interface FlowTypeInfo {
  variableName: string;
  narrowedType: UcodeDataType;
  effectiveFromOffset: number;
  effectiveToOffset: number;
  scopeId: string; // Unique identifier for the scope
}

export interface TypeGuardInfo {
  variableName: string;
  guard: TypeGuard;
  positiveNarrowing: UcodeDataType; // Type when guard is true
  negativeNarrowing: UcodeDataType; // Type when guard is false (for else branches)
}

export interface TypeGuard {
  type: 'null-check' | 'type-check' | 'instanceof-check';
  expression: string; // The guard expression as text
  testedType?: UcodeType; // For type-check guards
}

export class FlowSensitiveTypeTracker {
  private narrowingEngine: TypeNarrowingEngine;
  private symbolTable: SymbolTable;
  private flowTypeStack: FlowTypeInfo[][] = []; // Stack of scopes, each containing narrowed types
  private currentScopeId = 0;

  constructor(symbolTable: SymbolTable) {
    this.symbolTable = symbolTable;
    this.narrowingEngine = new TypeNarrowingEngine();
    // Initialize with global scope
    this.flowTypeStack.push([]);
  }

  /**
   * Enter a new scope (e.g., inside an if block)
   */
  enterScope(): string {
    this.currentScopeId++;
    const scopeId = `scope_${this.currentScopeId}`;
    this.flowTypeStack.push([]);
    return scopeId;
  }

  /**
   * Exit the current scope
   */
  exitScope(): void {
    if (this.flowTypeStack.length > 1) {
      this.flowTypeStack.pop();
    }
  }

  /**
   * Get the effective type of a variable at a specific position, considering flow-sensitive narrowing
   */
  getEffectiveType(variableName: string, position: number): UcodeDataType | null {
    // Look through scopes from innermost to outermost
    for (let i = this.flowTypeStack.length - 1; i >= 0; i--) {
      const scope = this.flowTypeStack[i];
      if (!scope) continue; // Safety check
      for (const flowInfo of scope) {
        if (flowInfo.variableName === variableName &&
            position >= flowInfo.effectiveFromOffset &&
            (flowInfo.effectiveToOffset === -1 || position <= flowInfo.effectiveToOffset)) {
          return flowInfo.narrowedType;
        }
      }
    }
    return null; // No narrowing found, use original type
  }

  /**
   * Apply type narrowing within the current scope
   */
  narrowTypeInCurrentScope(variableName: string, narrowedType: UcodeDataType, startOffset: number, endOffset: number = -1): void {
    const currentScope = this.flowTypeStack[this.flowTypeStack.length - 1];
    if (!currentScope) return; // Safety check
    
    const scopeId = `scope_${this.currentScopeId}`;
    
    currentScope.push({
      variableName,
      narrowedType,
      effectiveFromOffset: startOffset,
      effectiveToOffset: endOffset,
      scopeId
    });
  }

  /**
   * Analyze an if statement for type guards and apply narrowing
   */
  analyzeIfStatement(ifStatement: IfStatementNode): TypeGuardInfo[] {
    const guards: TypeGuardInfo[] = [];
    
    if (ifStatement.test && ifStatement.test.type === 'BinaryExpression') {
      const binaryExpr = ifStatement.test as BinaryExpressionNode;
      const guard = this.extractTypeGuard(binaryExpr);
      if (guard) {
        guards.push(guard);
      }
    }
    
    return guards;
  }

  /**
   * Extract type guard information from a binary expression
   */
  private extractTypeGuard(expr: BinaryExpressionNode): TypeGuardInfo | null {
    // Handle null checks: variable != null, variable == null, etc.
    if ((expr.operator === '!=' || expr.operator === '!==') && this.isNullLiteral(expr.right)) {
      const variableName = this.getVariableName(expr.left);
      if (variableName) {
        const originalType = this.getOriginalVariableType(variableName);
        
        
        if (originalType) {
          const narrowingResult = this.narrowingEngine.removeNullFromType(originalType);
          return {
            variableName,
            guard: {
              type: 'null-check',
              expression: `${variableName} != null`
            },
            positiveNarrowing: narrowingResult.narrowedType, // null removed
            negativeNarrowing: originalType // keeps null
          };
        }
      }
    }

    // Handle type checks: type(variable) == 'array', etc.
    if (expr.operator === '==' && this.isTypeCall(expr.left) && this.isStringLiteral(expr.right)) {
      const typeCall = expr.left as any;
      if (typeCall.arguments && typeCall.arguments.length > 0) {
        const variableName = this.getVariableName(typeCall.arguments[0]);
        const testedTypeStr = (expr.right as any).value;
        const testedType = this.stringToUcodeType(testedTypeStr);
        
        if (variableName && testedType) {
          const originalType = this.getOriginalVariableType(variableName);
          if (originalType) {
            const positiveNarrowing = this.narrowingEngine.keepOnlyTypes(originalType, [testedType]);
            const negativeNarrowing = this.narrowingEngine.removeTypesFromUnion(originalType, [testedType]);
            
            return {
              variableName,
              guard: {
                type: 'type-check',
                expression: `type(${variableName}) == '${testedTypeStr}'`,
                testedType
              },
              positiveNarrowing: positiveNarrowing.narrowedType,
              negativeNarrowing: negativeNarrowing.narrowedType
            };
          }
        }
      }
    }

    return null;
  }

  private isNullLiteral(node: AstNode): boolean {
    return node.type === 'Literal' && (node as any).value === null;
  }

  private isStringLiteral(node: AstNode): boolean {
    return node.type === 'Literal' && typeof (node as any).value === 'string';
  }

  private isTypeCall(node: AstNode): boolean {
    return node.type === 'CallExpression' && 
           (node as any).callee?.type === 'Identifier' && 
           (node as any).callee?.name === 'type';
  }

  private getVariableName(node: AstNode): string | null {
    if (node.type === 'Identifier') {
      return (node as IdentifierNode).name;
    }
    return null;
  }

  private getOriginalVariableType(variableName: string): UcodeDataType | null {
    const symbol = this.symbolTable.lookup(variableName);
    if (symbol) {
      // Get the symbol's original type before any flow-sensitive narrowing
      return symbol.dataType;
    }
    return null;
  }

  private stringToUcodeType(typeStr: string): UcodeType | null {
    switch (typeStr) {
      case 'array': return UcodeType.ARRAY;
      case 'object': return UcodeType.OBJECT;
      case 'string': return UcodeType.STRING;
      case 'int': return UcodeType.INTEGER;
      case 'double': return UcodeType.DOUBLE;
      case 'bool': return UcodeType.BOOLEAN;
      case 'null': return UcodeType.NULL;
      case 'function': return UcodeType.FUNCTION;
      case 'regex': return UcodeType.REGEX;
      default: return null;
    }
  }

  /**
   * Debug method to show current flow type information
   */
  debugFlowTypes(): void {
    console.log('Flow Type Stack:', this.flowTypeStack);
  }
}