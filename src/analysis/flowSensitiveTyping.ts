/**
 * Flow-Sensitive Type Tracking for ucode semantic analysis
 * Handles type narrowing within conditional blocks and control flow
 */

import { UcodeType, UcodeDataType, SymbolTable, getUnionTypes } from './symbolTable';
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
  private getActiveGuardCallback?: (variableName: string, position: number) => UcodeDataType | null;

  constructor(symbolTable: SymbolTable) {
    this.symbolTable = symbolTable;
    this.narrowingEngine = new TypeNarrowingEngine();
    // Initialize with global scope
    this.flowTypeStack.push([]);
  }

  /**
   * Set a callback to get active guard types from the type checker
   */
  setActiveGuardCallback(callback: (variableName: string, position: number) => UcodeDataType | null): void {
    this.getActiveGuardCallback = callback;
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

    if (!ifStatement.test) {
      return guards;
    }

    if (ifStatement.test.type === 'BinaryExpression') {
      const binaryExpr = ifStatement.test as BinaryExpressionNode;
      const guard = this.extractTypeGuard(binaryExpr, ifStatement.test.start);
      if (guard) {
        guards.push(guard);
      }
    }

    return guards;
  }

  /**
   * Count the number of branches in an OR chain
   */
  private countOrBranches(expr: BinaryExpressionNode): number {
    if (expr.operator !== '||') {
      return 1;
    }

    let count = 0;
    if (expr.left.type === 'BinaryExpression' && (expr.left as BinaryExpressionNode).operator === '||') {
      count += this.countOrBranches(expr.left as BinaryExpressionNode);
    } else {
      count += 1;
    }

    if (expr.right.type === 'BinaryExpression' && (expr.right as BinaryExpressionNode).operator === '||') {
      count += this.countOrBranches(expr.right as BinaryExpressionNode);
    } else {
      count += 1;
    }

    return count;
  }

  /**
   * Collect all individual type guard conditions from an AND chain
   */
  private collectAndTypeGuards(expr: BinaryExpressionNode, position: number): Array<{
    variableName: string;
    testedType: UcodeType;
    isNegative: boolean;
  }> {
    const guards: Array<{ variableName: string; testedType: UcodeType; isNegative: boolean }> = [];

    // Recursively collect from AND chains
    if (expr.operator === '&&') {
      if (expr.left.type === 'BinaryExpression') {
        guards.push(...this.collectAndTypeGuards(expr.left as BinaryExpressionNode, position));
      }
      if (expr.right.type === 'BinaryExpression') {
        guards.push(...this.collectAndTypeGuards(expr.right as BinaryExpressionNode, position));
      }
      return guards;
    }

    // Extract single type guard (reuse the same logic as OR)
    return this.extractSingleTypeGuardFromExpr(expr);
  }

  /**
   * Collect all individual type guard conditions from an OR chain
   */
  private collectOrTypeGuards(expr: BinaryExpressionNode, position: number): Array<{
    variableName: string;
    testedType: UcodeType;
    isNegative: boolean;
  }> {
    const guards: Array<{ variableName: string; testedType: UcodeType; isNegative: boolean }> = [];

    // Recursively collect from OR chains
    if (expr.operator === '||') {
      if (expr.left.type === 'BinaryExpression') {
        guards.push(...this.collectOrTypeGuards(expr.left as BinaryExpressionNode, position));
      }
      if (expr.right.type === 'BinaryExpression') {
        guards.push(...this.collectOrTypeGuards(expr.right as BinaryExpressionNode, position));
      }
      return guards;
    }

    // Extract single type guard
    return this.extractSingleTypeGuardFromExpr(expr);
  }

  /**
   * Extract a single type guard from a binary expression (helper for AND/OR chains)
   */
  private extractSingleTypeGuardFromExpr(expr: BinaryExpressionNode): Array<{
    variableName: string;
    testedType: UcodeType;
    isNegative: boolean;
  }> {
    const guards: Array<{ variableName: string; testedType: UcodeType; isNegative: boolean }> = [];

    // Positive type guard: type(x) == 'typename' or type(x) === 'typename'
    if ((expr.operator === '==' || expr.operator === '===') && this.isTypeCall(expr.left) && this.isStringLiteral(expr.right)) {
      const typeCall = expr.left as any;
      if (typeCall.arguments && typeCall.arguments.length > 0) {
        const variableName = this.getVariableName(typeCall.arguments[0]);
        const testedTypeStr = (expr.right as any).value;
        const testedType = this.stringToUcodeType(testedTypeStr);

        if (variableName && testedType) {
          guards.push({ variableName, testedType, isNegative: false });
        }
      }
    }

    // Negative type guard: type(x) != 'typename' or type(x) !== 'typename'
    if ((expr.operator === '!=' || expr.operator === '!==') && this.isTypeCall(expr.left) && this.isStringLiteral(expr.right)) {
      const typeCall = expr.left as any;
      if (typeCall.arguments && typeCall.arguments.length > 0) {
        const variableName = this.getVariableName(typeCall.arguments[0]);
        const testedTypeStr = (expr.right as any).value;
        const testedType = this.stringToUcodeType(testedTypeStr);

        if (variableName && testedType) {
          guards.push({ variableName, testedType, isNegative: true });
        }
      }
    }

    // Handle null checks as special guards
    if ((expr.operator === '!=' || expr.operator === '!==') && this.isNullLiteral(expr.right)) {
      const variableName = this.getVariableName(expr.left);
      if (variableName) {
        guards.push({ variableName, testedType: UcodeType.NULL, isNegative: true });
      }
    }

    if ((expr.operator === '!=' || expr.operator === '!==') && this.isNullLiteral(expr.left)) {
      const variableName = this.getVariableName(expr.right);
      if (variableName) {
        guards.push({ variableName, testedType: UcodeType.NULL, isNegative: true });
      }
    }

    if ((expr.operator === '==' || expr.operator === '===') && this.isNullLiteral(expr.right)) {
      const variableName = this.getVariableName(expr.left);
      if (variableName) {
        guards.push({ variableName, testedType: UcodeType.NULL, isNegative: false });
      }
    }

    if ((expr.operator === '==' || expr.operator === '===') && this.isNullLiteral(expr.left)) {
      const variableName = this.getVariableName(expr.right);
      if (variableName) {
        guards.push({ variableName, testedType: UcodeType.NULL, isNegative: false });
      }
    }

    return guards;
  }

  /**
   * Extract type guard information from a binary expression
   */
  private extractTypeGuard(expr: BinaryExpressionNode, position: number): TypeGuardInfo | null {
    // Handle AND operator for combining type guards (type(x) !== 'object' && type(x) == 'string')
    if (expr.operator === '&&') {
      // Collect all type guards in the AND chain
      const allGuards = this.collectAndTypeGuards(expr, position);

      if (allGuards.length >= 2) {
        // Check they all guard the same variable
        const firstGuard = allGuards[0];
        if (!firstGuard) {
          return null;
        }
        const variableName = firstGuard.variableName;
        if (!allGuards.every(g => g.variableName === variableName)) {
          return null;
        }

        const originalType = this.getOriginalVariableType(variableName, position);
        if (!originalType) {
          return null;
        }

        const originalTypes = getUnionTypes(originalType);

        // Filter out guards that don't actually narrow anything
        const effectiveGuards = allGuards.filter(guard => {
          return originalTypes.includes(guard.testedType);
        });

        // If no effective guards, no narrowing occurs
        if (effectiveGuards.length === 0) {
          return null;
        }

        // For AND guards: a type satisfies if it satisfies ALL guards
        const satisfyingTypes = originalTypes.filter(type => {
          return effectiveGuards.every(guard => {
            if (guard.isNegative) {
              // Negative guard: type satisfies if it's NOT the guarded type
              return type !== guard.testedType;
            } else {
              // Positive guard: type satisfies if it IS the guarded type
              return type === guard.testedType;
            }
          });
        });

        // Check if narrowing occurred
        if (satisfyingTypes.length === 0 || satisfyingTypes.length === originalTypes.length) {
          return null;
        }

        const positiveNarrowing = this.narrowingEngine.keepOnlyTypes(originalType, satisfyingTypes);
        const negativeNarrowing = this.narrowingEngine.removeTypesFromUnion(originalType, satisfyingTypes);

        // Build expression string using only effective guards
        const guardExprs = effectiveGuards.map(g =>
          `type(${g.variableName}) ${g.isNegative ? '!=' : '=='} '${this.ucodeTypeToString(g.testedType)}'`
        ).join(' && ');

        const representativeType = effectiveGuards.find(g => !g.isNegative)?.testedType || effectiveGuards[0]?.testedType;
        if (!representativeType) {
          return null;
        }

        return {
          variableName,
          guard: {
            type: 'type-check',
            expression: guardExprs,
            testedType: representativeType
          },
          positiveNarrowing: positiveNarrowing.narrowedType,
          negativeNarrowing: negativeNarrowing.narrowedType
        };
      }

      // If not enough guards collected, fall through to single guard handling
    }

    // Handle OR operator for combining type guards (type(x) == 'array' || type(x) == 'string')
    if (expr.operator === '||') {
      // Count total branches in the OR chain
      const totalBranches = this.countOrBranches(expr);

      // Collect all type guards in the OR chain
      const allGuards = this.collectOrTypeGuards(expr, position);

      // If we have fewer guards than branches, there's a non-guard expression (possibly tautology)
      // In this case, don't narrow - the non-guard branch could make the whole condition true
      if (allGuards.length < totalBranches) {
        return null;
      }

      if (allGuards.length >= 2) {
        // Check they all guard the same variable
        const firstGuard = allGuards[0];
        if (!firstGuard) {
          return null;
        }
        const variableName = firstGuard.variableName;
        if (!allGuards.every(g => g.variableName === variableName)) {
          return null;
        }

        const originalType = this.getOriginalVariableType(variableName, position);
        if (!originalType) {
          return null;
        }

        const originalTypes = getUnionTypes(originalType);

        // For OR guards: a type satisfies if it satisfies ANY guard
        // Check each guard to see if ALL types satisfy it (making it useless for narrowing)
        const satisfyingTypes = originalTypes.filter(type => {
          return allGuards.some(guard => {
            if (guard.isNegative) {
              // Negative guard: type satisfies if it's NOT the guarded type
              return type !== guard.testedType;
            } else {
              // Positive guard: type satisfies if it IS the guarded type
              return type === guard.testedType;
            }
          });
        });

        // Check if any guard is a tautology (always true for all types)
        // If a guard is always true, it means ALL types satisfy it
        const hasTautology = allGuards.some(guard => {
          if (guard.isNegative) {
            // Negative guard is a tautology if the tested type is NOT in the original union
            return !originalTypes.includes(guard.testedType);
          }
          return false;
        });

        // If there's a tautology in an OR chain, no narrowing occurs (all types pass)
        if (hasTautology && satisfyingTypes.length === originalTypes.length) {
          return null;
        }

        // Filter effective guards for expression building
        const effectiveGuards = allGuards.filter(guard => {
          if (guard.isNegative) {
            return originalTypes.includes(guard.testedType);
          } else {
            return originalTypes.includes(guard.testedType);
          }
        });

        if (effectiveGuards.length === 0) {
          return null;
        }

        // Check if narrowing occurred
        if (satisfyingTypes.length === 0 || satisfyingTypes.length === originalTypes.length) {
          return null;
        }

        const positiveNarrowing = this.narrowingEngine.keepOnlyTypes(originalType, satisfyingTypes);
        const negativeNarrowing = this.narrowingEngine.removeTypesFromUnion(originalType, satisfyingTypes);

        // Build expression string using only effective guards
        const guardExprs = effectiveGuards.map(g =>
          `type(${g.variableName}) ${g.isNegative ? '!=' : '=='} '${this.ucodeTypeToString(g.testedType)}'`
        ).join(' || ');

        const representativeType = effectiveGuards.find(g => !g.isNegative)?.testedType || effectiveGuards[0]?.testedType;
        if (!representativeType) {
          return null;
        }

        return {
          variableName,
          guard: {
            type: 'type-check',
            expression: guardExprs,
            testedType: representativeType
          },
          positiveNarrowing: positiveNarrowing.narrowedType,
          negativeNarrowing: negativeNarrowing.narrowedType
        };
      }

      // If not enough guards collected, return null
      return null;
    }

    // Handle null checks: variable != null
    if ((expr.operator === '!=' || expr.operator === '!==') && this.isNullLiteral(expr.right)) {
      const variableName = this.getVariableName(expr.left);
      if (variableName) {
        const originalType = this.getOriginalVariableType(variableName, position);


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

    // Handle reversed null checks: null != variable
    if ((expr.operator === '!=' || expr.operator === '!==') && this.isNullLiteral(expr.left)) {
      const variableName = this.getVariableName(expr.right);
      if (variableName) {
        const originalType = this.getOriginalVariableType(variableName, position);
        if (originalType) {
          const narrowingResult = this.narrowingEngine.removeNullFromType(originalType);
          return {
            variableName,
            guard: {
              type: 'null-check',
              expression: `${variableName} != null`
            },
            positiveNarrowing: narrowingResult.narrowedType,
            negativeNarrowing: originalType
          };
        }
      }
    }

    // Handle equality null checks: variable == null
    if ((expr.operator === '==' || expr.operator === '===') && this.isNullLiteral(expr.right)) {
      const variableName = this.getVariableName(expr.left);
      if (variableName) {
        const originalType = this.getOriginalVariableType(variableName, position);
        if (originalType) {
          const positiveNarrowing = this.narrowingEngine.keepOnlyTypes(originalType, [UcodeType.NULL]);
          const negativeNarrowing = this.narrowingEngine.removeNullFromType(originalType);
          return {
            variableName,
            guard: {
              type: 'null-check',
              expression: `${variableName} == null`
            },
            positiveNarrowing: positiveNarrowing.narrowedType,
            negativeNarrowing: negativeNarrowing.narrowedType
          };
        }
      }
    }

    // Handle reversed equality null checks: null == variable
    if ((expr.operator === '==' || expr.operator === '===') && this.isNullLiteral(expr.left)) {
      const variableName = this.getVariableName(expr.right);
      if (variableName) {
        const originalType = this.getOriginalVariableType(variableName, position);
        if (originalType) {
          const positiveNarrowing = this.narrowingEngine.keepOnlyTypes(originalType, [UcodeType.NULL]);
          const negativeNarrowing = this.narrowingEngine.removeNullFromType(originalType);
          return {
            variableName,
            guard: {
              type: 'null-check',
              expression: `${variableName} == null`
            },
            positiveNarrowing: positiveNarrowing.narrowedType,
            negativeNarrowing: negativeNarrowing.narrowedType
          };
        }
      }
    }

    // Handle type checks: type(variable) == 'array', etc.
    if ((expr.operator === '==' || expr.operator === '===') && this.isTypeCall(expr.left) && this.isStringLiteral(expr.right)) {
      const typeCall = expr.left as any;
      if (typeCall.arguments && typeCall.arguments.length > 0) {
        const variableName = this.getVariableName(typeCall.arguments[0]);
        const testedTypeStr = (expr.right as any).value;
        const testedType = this.stringToUcodeType(testedTypeStr);

        if (variableName && testedType) {
          const originalType = this.getOriginalVariableType(variableName, position);
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

  private getOriginalVariableType(variableName: string, position: number): UcodeDataType | null {
    const symbol = this.symbolTable.lookup(variableName);
    if (symbol) {
      // First check for guard context from type checker (for nested guards)
      if (this.getActiveGuardCallback) {
        const guardType = this.getActiveGuardCallback(variableName, position);
        if (guardType) {
          return guardType;
        }
      }

      // Then check flow-sensitive narrowing
      const effectiveType = this.getEffectiveType(variableName, position);
      return effectiveType || symbol.dataType;
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

  private ucodeTypeToString(type: UcodeType): string {
    switch (type) {
      case UcodeType.ARRAY: return 'array';
      case UcodeType.OBJECT: return 'object';
      case UcodeType.STRING: return 'string';
      case UcodeType.INTEGER: return 'int';
      case UcodeType.DOUBLE: return 'double';
      case UcodeType.BOOLEAN: return 'bool';
      case UcodeType.NULL: return 'null';
      case UcodeType.FUNCTION: return 'function';
      case UcodeType.REGEX: return 'regex';
      default: return 'unknown';
    }
  }

  /**
   * Debug method to show current flow type information
   */
  debugFlowTypes(): void {
    console.log('Flow Type Stack:', this.flowTypeStack);
  }
}
