/**
 * Main Type Checker for ucode semantic analysis
 * Handles type inference and type checking
 */

import {
  AstNode, LiteralNode, IdentifierNode, BinaryExpressionNode, UnaryExpressionNode,
  CallExpressionNode, MemberExpressionNode, AssignmentExpressionNode, ArrayExpressionNode,
  ObjectExpressionNode, ConditionalExpressionNode, ArrowFunctionExpressionNode,
  FunctionExpressionNode, IfStatementNode, ProgramNode, BlockStatementNode,
  ExpressionStatementNode, FunctionDeclarationNode, VariableDeclarationNode,
  VariableDeclaratorNode, ExportDefaultDeclarationNode, ReturnStatementNode,
  PropertyNode, SwitchStatementNode, SwitchCaseNode
} from '../ast/nodes';

/**
 * Represents a type guard that narrows a variable's type
 */
interface TypeGuardInfo {
  variableName: string;
  // The narrowed type. When set to UcodeType.NULL with isNegative true, null is removed.
  // When set to UcodeType.NULL with isNegative false, type is narrowed to just null.
  // For other UcodeType values, isNegative false keeps only that type, true removes it.
  narrowToType: UcodeType | null;
  // Whether this is a negative narrowing (e.g., removing the type in else block)
  isNegative: boolean;
  // Whether this is a combined OR guard (e.g., type(x) === 'array' || type(x) === 'string')
  isCombinedOr?: boolean;
}
import { SymbolTable, SymbolType, UcodeType, UcodeDataType, isUnionType, getUnionTypes, createUnionType, Symbol as UcodeSymbol } from './symbolTable';
import { logicalTypeInference } from './logicalTypeInference';
import { arithmeticTypeInference } from './arithmeticTypeInference';
import { BuiltinValidator, TypeCompatibilityChecker } from './checkers';
import { createExceptionObjectDataType } from './exceptionTypes';
import { allBuiltinFunctions } from '../builtins';
import { fsModuleTypeRegistry } from './fsModuleTypes';
import { rtnlTypeRegistry } from './rtnlTypes';
import { nl80211TypeRegistry } from './nl80211Types';
import { Option } from 'effect';
import { isKnownObjectType, OBJECT_REGISTRIES, type KnownObjectType } from './moduleDispatch';
import { TypeNarrowingEngine } from './typeNarrowing';
import { FlowSensitiveTypeTracker } from './flowSensitiveTyping';
import { CFGQueryEngine } from './cfg/queryEngine';

// Builtins that return null when their key argument is null/wrong-type
const NULL_PROPAGATING_BUILTINS: Record<string, number> = {
  length: 0, keys: 0, values: 0, index: 0, rindex: 0,
  sort: 0, reverse: 0, uniq: 0, pop: 0, shift: 0,
  slice: 0, splice: 0, join: 1, trim: 0, ltrim: 0, rtrim: 0,
  ord: 0, split: 0, substr: 0, b64enc: 0, b64dec: 0, hexdec: 0,
};

export interface FunctionSignature {
  name: string;
  parameters: UcodeType[];
  returnType: UcodeDataType;
  variadic?: boolean;
  minParams?: number;
  maxParams?: number;
}

export interface TypeCheckResult {
  type: UcodeType;
  errors: TypeError[];
  warnings: TypeWarning[];
}

export interface TypeError {
  message: string;
  start: number;
  end: number;
  severity: 'error';
  code?: string; // Diagnostic code for quick fixes
  data?: any;    // Additional data for quick fixes
}

export interface TypeWarning {
  message: string;
  start: number;
  end: number;
  severity: 'warning';
  code?: string;
  data?: any;
}

export class TypeChecker {
  private symbolTable: SymbolTable;
  private cfgQueryEngine: CFGQueryEngine | null = null;
  private builtinFunctions: Map<string, FunctionSignature>;
  private errors: TypeError[] = [];
  private warnings: TypeWarning[] = [];
  private builtinValidator: BuiltinValidator;
  private typeCompatibility: TypeCompatibilityChecker;
  private typeNarrowing: TypeNarrowingEngine;
  private flowSensitiveTracker: FlowSensitiveTypeTracker;
  private guardContextStack: Array<{variableName: string, narrowedType: UcodeDataType, startPos: number, endPos: number}> = [];
  private assignmentTargetDepth = 0;
  private currentAST: ProgramNode | null = null;
  private constantAssignmentProperties = new Map<string, Set<string>>();
  private strictMode = false;

  constructor(symbolTable: SymbolTable, cfgQueryEngine?: CFGQueryEngine) {
    this.cfgQueryEngine = cfgQueryEngine || null;
    this.symbolTable = symbolTable;
    this.builtinFunctions = new Map();
    this.builtinValidator = new BuiltinValidator();
    this.typeCompatibility = new TypeCompatibilityChecker();
    this.typeNarrowing = new TypeNarrowingEngine();
    this.flowSensitiveTracker = new FlowSensitiveTypeTracker(symbolTable);

    // Inject type checker into builtin validator
    // Use a method that returns the full type description including unions
    this.builtinValidator.setTypeChecker(this.getNodeTypeDescription.bind(this));

    // Set up callback so flowSensitiveTracker can access guard contexts from typeChecker
    this.flowSensitiveTracker.setActiveGuardCallback(this.getActiveGuardType.bind(this));

    this.initializeBuiltins();
  }

  /**
   * Set the CFG query engine for flow-sensitive type lookups
   */
  public setCFGQueryEngine(cfgQueryEngine: CFGQueryEngine | null): void {
    this.cfgQueryEngine = cfgQueryEngine;
  }

  /**
   * Get the type narrowing engine for checking type compatibility
   */
  public getTypeNarrowing(): TypeNarrowingEngine {
    return this.typeNarrowing;
  }

  private initializeBuiltins(): void {
    const builtins: FunctionSignature[] = [
      { name: 'print', parameters: [], returnType: UcodeType.INTEGER, variadic: true },
      { name: 'printf', parameters: [UcodeType.STRING], returnType: UcodeType.INTEGER, variadic: true },
      { name: 'sprintf', parameters: [UcodeType.STRING], returnType: UcodeType.STRING, variadic: true },
      { name: 'length', parameters: [UcodeType.UNKNOWN], returnType: UcodeType.INTEGER },
      { name: 'substr', parameters: [UcodeType.STRING, UcodeType.INTEGER], returnType: UcodeType.STRING, minParams: 2, maxParams: 3 },
      { name: 'split', parameters: [UcodeType.STRING, UcodeType.STRING], returnType: createUnionType([UcodeType.ARRAY, UcodeType.NULL]), minParams: 2, maxParams: 3 },
      { name: 'join', parameters: [UcodeType.STRING, UcodeType.ARRAY], returnType: UcodeType.STRING },
      { name: 'trim', parameters: [UcodeType.STRING], returnType: UcodeType.STRING, minParams: 1, maxParams: 2 },
      { name: 'ltrim', parameters: [UcodeType.STRING], returnType: UcodeType.STRING, minParams: 1, maxParams: 2 },
      { name: 'rtrim', parameters: [UcodeType.STRING], returnType: UcodeType.STRING, minParams: 1, maxParams: 2 },
      { name: 'chr', parameters: [UcodeType.INTEGER], returnType: UcodeType.STRING },
      { name: 'ord', parameters: [UcodeType.STRING], returnType: UcodeType.INTEGER },
      { name: 'uc', parameters: [UcodeType.STRING], returnType: UcodeType.STRING },
      { name: 'lc', parameters: [UcodeType.STRING], returnType: UcodeType.STRING },
      { name: 'type', parameters: [UcodeType.UNKNOWN], returnType: UcodeType.STRING },
      { name: 'keys', parameters: [UcodeType.OBJECT], returnType: UcodeType.ARRAY },
      { name: 'values', parameters: [UcodeType.OBJECT], returnType: UcodeType.ARRAY },
      { name: 'push', parameters: [UcodeType.ARRAY], returnType: UcodeType.UNKNOWN, variadic: true },
      { name: 'pop', parameters: [UcodeType.ARRAY], returnType: UcodeType.UNKNOWN },
      { name: 'shift', parameters: [UcodeType.ARRAY], returnType: UcodeType.UNKNOWN },
      { name: 'unshift', parameters: [UcodeType.ARRAY], returnType: UcodeType.UNKNOWN, variadic: true },
      { name: 'filter', parameters: [UcodeType.ARRAY, UcodeType.FUNCTION], returnType: UcodeType.ARRAY },
      { name: 'index', parameters: [UcodeType.UNKNOWN, UcodeType.UNKNOWN], returnType: UcodeType.INTEGER },
      { name: 'rindex', parameters: [UcodeType.STRING, UcodeType.UNKNOWN], returnType: UcodeType.INTEGER },
      { name: 'require', parameters: [UcodeType.STRING], returnType: UcodeType.UNKNOWN },
      { name: 'include', parameters: [UcodeType.STRING], returnType: UcodeType.UNKNOWN },
      { name: 'json', parameters: [UcodeType.UNKNOWN], returnType: UcodeType.UNKNOWN },
      { name: 'match', parameters: [UcodeType.STRING, UcodeType.STRING], returnType: createUnionType([UcodeType.ARRAY, UcodeType.NULL]) },
      { name: 'replace', parameters: [UcodeType.STRING, UcodeType.STRING, UcodeType.STRING], returnType: UcodeType.STRING },
      { name: 'system', parameters: [UcodeType.UNKNOWN], returnType: UcodeType.INTEGER, minParams: 1, maxParams: 2 },
      { name: 'time', parameters: [], returnType: UcodeType.INTEGER },
      { name: 'sleep', parameters: [UcodeType.INTEGER], returnType: UcodeType.BOOLEAN },
      { name: 'localtime', parameters: [], returnType: UcodeType.OBJECT, minParams: 0, maxParams: 1 },
      { name: 'gmtime', parameters: [], returnType: UcodeType.OBJECT, minParams: 0, maxParams: 1 },
      { name: 'timelocal', parameters: [UcodeType.OBJECT], returnType: UcodeType.INTEGER },
      { name: 'timegm', parameters: [UcodeType.OBJECT], returnType: UcodeType.INTEGER },
      { name: 'min', parameters: [], returnType: UcodeType.UNKNOWN, variadic: true },
      { name: 'max', parameters: [], returnType: UcodeType.UNKNOWN, variadic: true },
      { name: 'uniq', parameters: [UcodeType.ARRAY], returnType: UcodeType.ARRAY },
      { name: 'b64enc', parameters: [UcodeType.STRING], returnType: UcodeType.STRING },
      { name: 'b64dec', parameters: [UcodeType.STRING], returnType: UcodeType.STRING },
      { name: 'hexenc', parameters: [UcodeType.STRING], returnType: UcodeType.STRING },
      { name: 'hexdec', parameters: [UcodeType.STRING, UcodeType.STRING], returnType: UcodeType.STRING, minParams: 1, maxParams: 2 },
      { name: 'hex', parameters: [UcodeType.STRING], returnType: UcodeType.INTEGER },
      { name: 'uchr', parameters: [UcodeType.INTEGER], returnType: UcodeType.STRING },
      { name: 'iptoarr', parameters: [UcodeType.STRING], returnType: UcodeType.ARRAY },
      { name: 'arrtoip', parameters: [UcodeType.ARRAY], returnType: UcodeType.STRING },
      { name: 'int', parameters: [UcodeType.UNKNOWN], returnType: UcodeType.INTEGER },
      { name: 'loadstring', parameters: [UcodeType.STRING], returnType: UcodeType.FUNCTION },
      { name: 'loadfile', parameters: [UcodeType.STRING], returnType: UcodeType.FUNCTION },
      { name: 'wildcard', parameters: [UcodeType.STRING, UcodeType.STRING], returnType: UcodeType.BOOLEAN },
      { name: 'regexp', parameters: [UcodeType.STRING], returnType: UcodeType.REGEX, minParams: 1, maxParams: 2 },
      { name: 'assert', parameters: [], returnType: UcodeType.UNKNOWN, variadic: true, minParams: 0 }, // Returns first argument (reflective) - accepts any truish types
      { name: 'call', parameters: [UcodeType.FUNCTION], returnType: UcodeType.UNKNOWN, variadic: true },
      { name: 'signal', parameters: [UcodeType.INTEGER], returnType: UcodeType.UNKNOWN, minParams: 1, maxParams: 2 },
      { name: 'clock', parameters: [UcodeType.BOOLEAN], returnType: UcodeType.ARRAY, minParams: 0, maxParams: 1 },
      
      { name: 'sourcepath', parameters: [UcodeType.INTEGER, UcodeType.BOOLEAN], minParams: 0, maxParams: 2, returnType: UcodeType.STRING },
      { name: 'gc', parameters: [], returnType: UcodeType.NULL },
      { name: 'die', parameters: [], returnType: UcodeType.NULL, minParams: 0, maxParams: 1 },
      { name: 'exists', parameters: [UcodeType.OBJECT, UcodeType.STRING], returnType: UcodeType.BOOLEAN },
      { name: 'exit', parameters: [], returnType: UcodeType.NULL, minParams: 0, maxParams: 1 },
      { name: 'getenv', parameters: [UcodeType.STRING], returnType: UcodeType.STRING },
      { name: 'map', parameters: [UcodeType.ARRAY, UcodeType.FUNCTION], returnType: UcodeType.ARRAY },
      { name: 'reverse', parameters: [UcodeType.UNKNOWN], returnType: UcodeType.UNKNOWN },
      { name: 'sort', parameters: [UcodeType.ARRAY], returnType: UcodeType.ARRAY, minParams: 1, maxParams: 2 },
      { name: 'splice', parameters: [UcodeType.ARRAY, UcodeType.INTEGER], returnType: UcodeType.ARRAY, variadic: true },
      { name: 'slice', parameters: [UcodeType.UNKNOWN, UcodeType.INTEGER], returnType: UcodeType.UNKNOWN, minParams: 2, maxParams: 3 },
      { name: 'warn', parameters: [], returnType: UcodeType.INTEGER, variadic: true },
      { name: 'trace', parameters: [], returnType: UcodeType.NULL, minParams: 0, maxParams: 1 },
      { name: 'proto', parameters: [UcodeType.OBJECT], returnType: UcodeType.OBJECT, minParams: 1, maxParams: 2 },
      { name: 'render', parameters: [UcodeType.STRING], returnType: UcodeType.STRING, minParams: 1, maxParams: 2 },
      
      // NOTE: File System functions (error, open, readfile, etc.) are now fs.* module functions only
      
      // Math builtin functions (from math.c global_fns[])
      { name: 'abs', parameters: [UcodeType.UNKNOWN], returnType: UcodeType.UNKNOWN },
      { name: 'atan2', parameters: [UcodeType.UNKNOWN, UcodeType.UNKNOWN], returnType: UcodeType.DOUBLE },
      { name: 'cos', parameters: [UcodeType.UNKNOWN], returnType: UcodeType.DOUBLE },
      { name: 'exp', parameters: [UcodeType.UNKNOWN], returnType: UcodeType.DOUBLE },
      { name: 'log', parameters: [UcodeType.UNKNOWN], returnType: UcodeType.DOUBLE },
      { name: 'sin', parameters: [UcodeType.UNKNOWN], returnType: UcodeType.DOUBLE },
      { name: 'sqrt', parameters: [UcodeType.UNKNOWN], returnType: UcodeType.DOUBLE },
      { name: 'pow', parameters: [UcodeType.UNKNOWN, UcodeType.UNKNOWN], returnType: UcodeType.DOUBLE },
      { name: 'rand', parameters: [], returnType: UcodeType.DOUBLE, minParams: 0, maxParams: 2 },
      { name: 'srand', parameters: [UcodeType.UNKNOWN], returnType: UcodeType.NULL },
      { name: 'isnan', parameters: [UcodeType.UNKNOWN], returnType: UcodeType.BOOLEAN },
      
      // Module-specific functions have been removed from global builtins
      // They are now only accessible through proper module imports:
      // - digest.* functions via import from 'digest'  
      // - debug.* functions via import from 'debug'
      // - log.* functions via import from 'log'
      // - rtnl.* functions via import from 'rtnl'
      // - nl80211.* functions via import from 'nl80211'
      // - resolv.* functions via import from 'resolv'
      // - socket.* functions via import from 'socket'
      // - ubus.* functions via import from 'ubus'
      // - uci.* functions via import from 'uci'
      // - zlib.* functions via import from 'zlib'
    ];

    for (const builtin of builtins) {
      this.builtinFunctions.set(builtin.name, builtin);
    }
  }

  resetErrors(): void {
    this.errors = [];
    this.warnings = [];
    this.builtinValidator.resetErrors();
  }

  /**
   * Get current errors for post-processing
   */
  getErrors(): TypeError[] {
    return this.errors;
  }

  /**
   * Set errors after post-processing/filtering
   */
  setErrors(errors: TypeError[]): void {
    this.errors = errors;
  }

  withAssignmentTarget<T>(fn: () => T): T {
    this.assignmentTargetDepth++;
    try {
      return fn();
    } finally {
      this.assignmentTargetDepth--;
    }
  }

  private isAssignmentTargetContext(): boolean {
    return this.assignmentTargetDepth > 0;
  }

  private getStaticPropertyName(node: AstNode): string | null {
    if (node.type === 'Identifier') {
      return (node as IdentifierNode).name;
    }
    if (node.type === 'Literal') {
      const literal = node as LiteralNode;
      if (literal.value !== undefined && literal.value !== null) {
        return String(literal.value);
      }
    }
    return null;
  }

  private recordConstantAssignment(objectName: string, propertyName: string): void {
    let properties = this.constantAssignmentProperties.get(objectName);
    if (!properties) {
      properties = new Set<string>();
      this.constantAssignmentProperties.set(objectName, properties);
    }
    properties.add(propertyName);
  }

  private hasConstantAssignment(objectName: string, propertyName: string): boolean {
    const properties = this.constantAssignmentProperties.get(objectName);
    return properties ? properties.has(propertyName) : false;
  }

  private ensureSymbolHasIntegerProperty(objectName: string, propertyName: string): void {
    const symbol = this.symbolTable.lookup(objectName);
    if (!symbol) {
      return;
    }
    if (!symbol.propertyTypes) {
      symbol.propertyTypes = new Map<string, UcodeDataType>();
    }
    if (!symbol.propertyTypes.has(propertyName)) {
      symbol.propertyTypes.set(propertyName, UcodeType.INTEGER);
    }
  }

  checkNode(node: AstNode): UcodeType {
    if (!node) return UcodeType.UNKNOWN;


    switch (node.type) {
      case 'Literal':
        return this.checkLiteral(node as LiteralNode);
      case 'Identifier':
        return this.checkIdentifier(node as IdentifierNode);
      case 'BinaryExpression':
        return this.checkBinaryExpression(node as BinaryExpressionNode);
      case 'UnaryExpression':
        return this.checkUnaryExpression(node as UnaryExpressionNode);
      case 'CallExpression':
        return this.checkCallExpression(node as CallExpressionNode);
      case 'MemberExpression':
        return this.checkMemberExpression(node as MemberExpressionNode);
      case 'AssignmentExpression':
        return this.checkAssignmentExpression(node as AssignmentExpressionNode);
      case 'ArrayExpression':
        return this.checkArrayExpression(node as ArrayExpressionNode);
      case 'ObjectExpression':
        return this.checkObjectExpression(node as ObjectExpressionNode);
      case 'LogicalExpression':
        return this.checkBinaryExpression(node as BinaryExpressionNode);
      case 'ConditionalExpression':
        return this.checkConditionalExpression(node as ConditionalExpressionNode);
      case 'ArrowFunctionExpression':
        return this.checkArrowFunctionExpression(node as any);
      case 'FunctionExpression':
        return this.checkFunctionExpression(node as any);
      case 'TemplateLiteral':
        return UcodeType.STRING;
      case 'IfStatement':
        return this.checkIfStatement(node as any);
      case 'ExpressionStatement':
        return this.checkExpressionStatement(node as ExpressionStatementNode);
      case 'VariableDeclaration':
        return this.checkVariableDeclaration(node as VariableDeclarationNode);
      case 'BlockStatement':
        return this.checkBlockStatement(node as BlockStatementNode);
      case 'ReturnStatement':
        return this.checkReturnStatement(node as any);
      case 'BreakStatement':
      case 'ContinueStatement':
        return UcodeType.UNKNOWN;
      case 'SwitchStatement':
        return this.checkSwitchStatement(node as SwitchStatementNode);
      case 'TryStatement':
        return this.checkTryStatement(node as any);
      case 'CatchClause':
        return this.checkCatchClause(node as any);
      default:
        return UcodeType.UNKNOWN;
    }
  }

  getResult(): TypeCheckResult {
    // Collect errors from builtin validator
    const builtinErrors = this.builtinValidator.getErrors();
    const builtinWarnings = this.builtinValidator.getWarnings();
    
    return {
      type: UcodeType.UNKNOWN,
      errors: [...this.errors, ...builtinErrors],
      warnings: [...this.warnings, ...builtinWarnings],
    };
  }

  private checkLiteral(node: LiteralNode): UcodeType {
    switch (node.literalType) {
      case 'number':
        return typeof node.value === 'number' && node.value % 1 === 0 ? 
               UcodeType.INTEGER : UcodeType.DOUBLE;
      case 'double':
        return UcodeType.DOUBLE;
      case 'string':
        return UcodeType.STRING;
      case 'boolean':
        return UcodeType.BOOLEAN;
      case 'null':
        return UcodeType.NULL;
      case 'regexp':
        return UcodeType.REGEX; // Regex literals are independent types
      default:
        return UcodeType.UNKNOWN;
    }
  }

  private checkIdentifier(node: IdentifierNode): UcodeType {
    const symbol = this.symbolTable.lookup(node.name);
    if (symbol) {
      this.symbolTable.markUsed(node.name, node.start);
      
      // Check for active guard contexts first
      const guardType = this.getActiveGuardType(node.name, node.start);
      let dataType: UcodeDataType;
      
      if (guardType) {
        // Use the narrowed type from guard context
        dataType = guardType;
      } else {
        // Check for flow-sensitive type narrowing
        const flowSensitiveType = this.flowSensitiveTracker.getEffectiveType(node.name, node.start);
        dataType = flowSensitiveType || this.getEffectiveSymbolDataType(symbol, node.start);
      }
      
      // Store the full type information in the node for later use by type narrowing
      const existingFullType = (node as any)._fullType as UcodeDataType | undefined;
      if (!existingFullType || this.shouldUpdateFullType(existingFullType, dataType)) {
        (node as any)._fullType = dataType;
      }
      
      // Convert UcodeDataType to UcodeType for backwards compatibility
      if (typeof dataType === 'string') {
        return dataType as UcodeType;
      } else if (isUnionType(dataType)) {
        // For union types, return UNKNOWN to indicate it's a complex type
        // The actual union type is preserved in _fullType for narrowing purposes
        return UcodeType.UNKNOWN;
      } else {
        // For other complex types like ModuleType, return OBJECT
        return UcodeType.OBJECT;
      }
    } else {
      // Check if it's a builtin function
      const isBuiltin = allBuiltinFunctions.has(node.name);
      // Return FUNCTION type for builtin functions, UNKNOWN for truly undefined variables
      // Note: The SemanticAnalyzer will handle "Undefined variable" diagnostics
      return isBuiltin ? UcodeType.FUNCTION : UcodeType.UNKNOWN;
    }
  }

  private getEffectiveSymbolDataType(symbol: UcodeSymbol, position: number): UcodeDataType {
    if (symbol.currentType && symbol.currentTypeEffectiveFrom !== undefined && position >= symbol.currentTypeEffectiveFrom) {
      return symbol.currentType;
    }

    return symbol.dataType;
  }

  private shouldUpdateFullType(existingType: UcodeDataType, candidateType: UcodeDataType): boolean {
    // If either type is a module/object reference, prefer the latest information
    if (this.isModuleLikeType(candidateType) || this.isModuleLikeType(existingType)) {
      return true;
    }

    const existingTypes = getUnionTypes(existingType);
    const candidateTypes = getUnionTypes(candidateType);

    const candidateSubsetOfExisting = candidateTypes.every(type => existingTypes.includes(type));
    const existingSubsetOfCandidate = existingTypes.every(type => candidateTypes.includes(type));

    if (candidateSubsetOfExisting && !existingSubsetOfCandidate) {
      // Candidate removes options -> narrower
      return true;
    }

    if (candidateSubsetOfExisting && existingSubsetOfCandidate) {
      // Types identical -> allow refresh
      return true;
    }

    if (!candidateSubsetOfExisting && existingSubsetOfCandidate) {
      // Candidate introduces new possibilities -> keep existing narrow type
      return false;
    }

    // Fallback: accept update when sets are incomparable
    return true;
  }

  private isModuleLikeType(type: UcodeDataType): boolean {
    return typeof type === 'object' && !isUnionType(type) && 'moduleName' in (type as any);
  }

  private checkBinaryExpression(node: BinaryExpressionNode): UcodeType {
    const leftType = this.checkNode(node.left);
    const rightType = this.checkNode(node.right);

    // Type checking for binary operators
    switch (node.operator) {
      case '+':
        // Use enhanced addition type inference
        return arithmeticTypeInference.inferAdditionType(leftType, rightType);

      case '-':
      case '*':
      case '/':
      case '%':
        // Use enhanced arithmetic type inference (no errors - ucode is permissive)
        return arithmeticTypeInference.inferArithmeticType(leftType, rightType, node.operator);

      case '==':
      case '!=':
      case '===':
      case '!==':
      case '<':
      case '>':
      case '<=':
      case '>=':
        return this.typeCompatibility.getComparisonResultType();

      case '??':
        // Nullish coalescing: returns left if non-null, otherwise right
        if (leftType === UcodeType.NULL) {
          return rightType;
        }
        // Definitely non-null types: right is never reached
        if (leftType === UcodeType.ARRAY || leftType === UcodeType.OBJECT ||
            leftType === UcodeType.FUNCTION || leftType === UcodeType.REGEX) {
          return leftType;
        }
        // Could be null at runtime in a union context, return left (best approximation)
        // since checkBinaryExpression works with UcodeType not UcodeDataType
        return leftType;

      case '&&':
      case '||': {
        // Use union-aware inference when _fullType is available on left operand
        const leftFullType: UcodeDataType = (node.left as any)._fullType || leftType;
        const rightFullType: UcodeDataType = (node.right as any)._fullType || rightType;
        let logicalResultType: UcodeDataType;

        if (node.operator === '||') {
          logicalResultType = logicalTypeInference.inferLogicalOrFullType(leftFullType, rightFullType);
        } else {
          logicalResultType = logicalTypeInference.inferLogicalAndFullType(leftFullType, rightFullType);
        }

        // Store the full result type on this node for consumers
        (node as any)._fullType = logicalResultType;

        // Convert union type back to UcodeType for backward compatibility
        if (isUnionType(logicalResultType)) {
          return UcodeType.UNKNOWN;
        }

        return logicalResultType as UcodeType;
      }

      case '&':
      case '|':
      case '^':
      case '<<':
      case '>>':
        // Add warning for unexpected types (but still allow the operation)
        const isLeftExpected = leftType === UcodeType.BOOLEAN || leftType === UcodeType.INTEGER || leftType === UcodeType.UNKNOWN;
        const isRightExpected = rightType === UcodeType.BOOLEAN || rightType === UcodeType.INTEGER || rightType === UcodeType.UNKNOWN;
        
        if (!isLeftExpected || !isRightExpected) {
          this.warnings.push({
            message: `Bitwise operation on unexpected types: ${leftType} ${node.operator} ${rightType}. Consider using boolean or integer types for clarity.`,
            start: node.start,
            end: node.end,
            severity: 'warning'
          });
        }
        
        return this.typeCompatibility.getBitwiseResultType();

      case 'in':
        return this.checkInOperator(node, leftType, rightType);

      default:
        return UcodeType.UNKNOWN;
    }
  }

  private checkUnaryExpression(node: UnaryExpressionNode): UcodeType {
    const argType = this.checkNode(node.argument);
    const resultType = this.typeCompatibility.getUnaryResultType(argType, node.operator);
    
    // Only throw error if we get UNKNOWN result from a known non-compatible type
    // Don't throw error if operand is UNKNOWN (parameters, variables) - allow dynamic typing
    if (resultType === UcodeType.UNKNOWN && argType !== UcodeType.UNKNOWN) {
      // Only error on definitely invalid operations (e.g., applying ~ to string)
      const isDefinitelyInvalid = this.isDefinitelyInvalidUnaryOperation(argType, node.operator);
      if (isDefinitelyInvalid) {
        this.errors.push({
          message: `Cannot apply ${node.operator} to ${argType}`,
          start: node.start,
          end: node.end,
          severity: 'error'
        });
      }
    }
    
    return resultType;
  }

  private isDefinitelyInvalidUnaryOperation(operandType: UcodeType, operator: string): boolean {
    switch (operator) {
      case '+':
      case '-':
        // Unary +/- perform numeric conversion on strings (e.g., +"42" → 42)
        // This is valid in ucode, same as JavaScript behavior
        return operandType === UcodeType.ARRAY || operandType === UcodeType.OBJECT;
      case '++':
      case '--':
        // These require numeric types or booleans (which coerce to integers)
        return operandType === UcodeType.STRING ||
               operandType === UcodeType.ARRAY || operandType === UcodeType.OBJECT;
      case '~':
        // Bitwise complement requires integer type or booleans (which coerce to integers)
        return operandType === UcodeType.STRING ||
               operandType === UcodeType.ARRAY || operandType === UcodeType.OBJECT ||
               operandType === UcodeType.DOUBLE; // doubles can't be used with bitwise ops
      case '!':
        // Logical NOT can be applied to any type (truthy/falsy)
        return false;
      default:
        return false;
    }
  }

  private checkInOperator(node: BinaryExpressionNode, _leftType: UcodeType, rightType: UcodeType): UcodeType {
    // Get the full type data for the right operand
    let rightTypeData = this.getFullTypeFromNode(node.right) || this.getTypeAsDataType(rightType);

    // Check for flow-sensitive narrowing using direct AST analysis
    if (node.right.type === 'Identifier') {
      const variableName = (node.right as IdentifierNode).name;

      // Incorporate guard contexts first (e.g., from equality null checks)
      const guardContextType = this.getActiveGuardType(variableName, node.right.start);
      if (guardContextType) {
        rightTypeData = guardContextType;
      } else {
        const flowType = this.flowSensitiveTracker.getEffectiveType(variableName, node.right.start);
        if (flowType) {
          rightTypeData = flowType;
        }
      }

      // Check if we're inside any type guard for this variable
      // Use the position of the variable itself (node.right.start), not the start of the 'in' expression
      const guardChain = this.getGuardsForPosition(this.currentAST, variableName, node.right.start);
      if (guardChain.length > 0) {
        let narrowedType = rightTypeData;
        for (const guardInfo of guardChain) {
          narrowedType = this.applyTypeGuard(narrowedType, guardInfo);
        }

        if (this.typeNarrowing.isSubtype(narrowedType, UcodeType.OBJECT) ||
            this.typeNarrowing.isSubtype(narrowedType, UcodeType.ARRAY)) {
          return UcodeType.BOOLEAN;
        }

        rightTypeData = narrowedType;
      }
    }
    
    // Check basic compatibility - right side must be object or array
    if (!this.typeNarrowing.isSubtype(rightTypeData, UcodeType.OBJECT) && 
        !this.typeNarrowing.isSubtype(rightTypeData, UcodeType.ARRAY)) {
      // If it's a union type with some compatible types, provide more specific error
      const incompatibleTypes = this.typeNarrowing.getIncompatibleTypes(rightTypeData, UcodeType.OBJECT);
      const compatibleWithArray = this.typeNarrowing.isSubtype(rightTypeData, UcodeType.ARRAY);
      
      if (incompatibleTypes.length > 0 && (compatibleWithArray || this.typeNarrowing.containsType(rightTypeData, UcodeType.OBJECT))) {
        // Some parts of the union are compatible, some aren't
        const incompatibilityDesc = this.typeNarrowing.getIncompatibilityDescription(rightTypeData, UcodeType.OBJECT);
        this.warnings.push({
          message: `'in' operator: ${incompatibilityDesc}. Use a guard or assertion.`,
          start: node.right.start,
          end: node.right.end,
          severity: 'warning'
        });
      } else {
        // Completely incompatible
        this.errors.push({
          message: `'in' operator requires object or array on right side, got ${this.getTypeDescription(rightTypeData)}`,
          start: node.right.start,
          end: node.right.end,
          severity: 'error'
        });
      }
      return UcodeType.BOOLEAN;
    }

    // Check for null safety in union types
    if (this.typeNarrowing.requiresNullCheck(rightTypeData, 'in')) {
      this.errors.push({
        message: `Object is possibly 'null'. Use a guard or the optional-in operator.`,
        start: node.right.start,
        end: node.right.end,
        severity: 'error',
        code: 'nullable-in-operator',
        data: {
          variableName: this.getVariableName(node.right),
          operatorType: 'in'
        }
      });
    }

    return UcodeType.BOOLEAN;
  }


  private getTypeAsDataType(type: UcodeType): UcodeDataType {
    return type as UcodeDataType;
  }

  private getFullTypeFromNode(node: AstNode): UcodeDataType | null {
    // For Identifiers, check CFG for flow-sensitive narrowed types
    if (node.type === 'Identifier' && this.cfgQueryEngine) {
      const varName = (node as IdentifierNode).name;
      const cfgType = this.cfgQueryEngine.getTypeAtPosition(varName, node.start);

      if (cfgType) {
        // Check if active guard narrows further
        const guardType = this.getActiveGuardType(varName, node.start);
        if (guardType) {
          return guardType;
        }
        // CFG has a narrowed type for this variable at this position
        return cfgType;
      }
    }

    // Extract full type information stored during identifier checking
    return (node as any)._fullType || null;
  }

  private getTypeDescription(type: UcodeDataType): string {
    if (isUnionType(type)) {
      const types = getUnionTypes(type);
      // Recursively convert each type to string to handle nested unions
      return types.map(t => this.getTypeDescription(t)).join(' | ');
    }
    return type as string;
  }

  private getVariableName(node: AstNode): string | null {
    if (node.type === 'Identifier') {
      return (node as IdentifierNode).name;
    }
    // For complex expressions, return null
    return null;
  }

  private getNodeTypeDescription(node: AstNode): UcodeType {
    // For identifiers, check if there's a narrowed type in the current context
    if (node.type === 'Identifier') {
      const identifierNode = node as IdentifierNode;
      const variableName = identifierNode.name;

      // First check for active guard from outer scope (guardContextStack)
      let baseType = this.getFullTypeFromNode(node);
      if (!baseType) {
        return UcodeType.UNKNOWN;
      }

      const activeGuardType = this.getActiveGuardType(variableName, node.start);
      if (activeGuardType) {
        baseType = activeGuardType;
      }

      // Then check for flow-sensitive narrowing from current if statement
      const guards = this.getGuardsForPosition(this.currentAST, variableName, node.start);
      if (guards.length > 0) {
        let narrowedType = baseType;
        for (const guardInfo of guards) {
          narrowedType = this.applyTypeGuard(narrowedType, guardInfo);
        }
        return this.getTypeDescription(narrowedType) as UcodeType;
      }

      // Return the base type (possibly narrowed by outer guard)
      return this.getTypeDescription(baseType) as UcodeType;
    }

    // Get the full type data (which includes unions)
    const fullType = this.getFullTypeFromNode(node);
    if (fullType) {
      // Convert to string description (e.g., "null | object | array")
      return this.getTypeDescription(fullType) as UcodeType;
    }

    // For CallExpressions, get the return type from the function
    if (node.type === 'CallExpression') {
      const callNode = node as CallExpressionNode;
      if (callNode.callee.type === 'Identifier') {
        const funcName = (callNode.callee as IdentifierNode).name;
        const symbol = this.symbolTable.lookup(funcName);
        if (symbol && symbol.returnType) {
          // Return the full type description of the return type
          return this.getTypeDescription(symbol.returnType) as UcodeType;
        }
      }
    }

    // Fallback to simple type check
    return this.checkNode(node);
  }

  private parseReturnType(returnTypeStr: string): UcodeDataType {
    // Handle union types like "boolean | null"
    if (returnTypeStr.includes(' | ')) {
      const typeStrings = returnTypeStr.split(' | ').map(s => s.trim());
      const types: UcodeType[] = [];
      
      for (const typeStr of typeStrings) {
        switch (typeStr) {
          case 'boolean':
            types.push(UcodeType.BOOLEAN);
            break;
          case 'string':
            types.push(UcodeType.STRING);
            break;
          case 'number':
          case 'integer':
            types.push(UcodeType.INTEGER);
            break;
          case 'double':
            types.push(UcodeType.DOUBLE);
            break;
          case 'object':
            types.push(UcodeType.OBJECT);
            break;
          case 'array':
          case 'string[]':
            types.push(UcodeType.ARRAY);
            break;
          case 'null':
            types.push(UcodeType.NULL);
            break;
          case 'function':
            types.push(UcodeType.FUNCTION);
            break;
          default:
            types.push(UcodeType.UNKNOWN);
            break;
        }
      }
      
      return createUnionType(types);
    }
    
    // Handle single types
    switch (returnTypeStr) {
      case 'boolean':
        return UcodeType.BOOLEAN;
      case 'string':
        return UcodeType.STRING;
      case 'number':
      case 'integer':
        return UcodeType.INTEGER;
      case 'double':
        return UcodeType.DOUBLE;
      case 'object':
        return UcodeType.OBJECT;
      case 'array':
        return UcodeType.ARRAY;
      case 'null':
        return UcodeType.NULL;
      case 'function':
        return UcodeType.FUNCTION;
      default:
        return UcodeType.UNKNOWN;
    }
  }

  private checkCallExpression(node: CallExpressionNode): UcodeType {
    if (node.callee.type === 'Identifier') {
      const funcName = (node.callee as IdentifierNode).name;

      // First check if it's a user-defined function, imported function, or variable containing a function
      // Use lookupAtPosition to properly handle local variables in nested scopes
      let symbol = this.symbolTable.lookupAtPosition(funcName, node.start);

      // Try CFG-based lookup if symbol table fails
      if (!symbol && this.cfgQueryEngine) {
        const cfgType = this.cfgQueryEngine.getTypeAtPosition(funcName, node.start);
        if (cfgType) {
          // Create a temporary symbol with CFG-inferred type
          symbol = {
            name: funcName,
            type: SymbolType.VARIABLE,
            dataType: cfgType,
            scope: 0,
            declared: true,
            used: true,
            node: {} as any,
            declaredAt: node.start,
            usedAt: [node.start]
          } as UcodeSymbol;
        }
      }

      if (symbol) {
        // Check for functions and imported functions
        if (symbol.type === SymbolType.FUNCTION || symbol.type === SymbolType.IMPORTED) {
          // Special handling for imported fs functions
          if (symbol.type === SymbolType.IMPORTED && symbol.importedFrom === 'fs') {
            const fsFunction = fsModuleTypeRegistry.getFunction(funcName);
            if (fsFunction) {
              const returnTypeData = this.parseReturnType(fsFunction.returnType);
              // Convert UcodeDataType back to UcodeType for compatibility
              if (typeof returnTypeData === 'string') {
                return returnTypeData as UcodeType;
              } else if (isUnionType(returnTypeData)) {
                // For union types, we need to return a union type, but the interface expects UcodeType
                // For now, return the first type - this needs to be improved in the future
                const types = getUnionTypes(returnTypeData);
                return types[0] || UcodeType.UNKNOWN;
              } else {
                return UcodeType.UNKNOWN;
              }
            }
          }
          
          // For user-defined functions and other imported functions, return their return type
          if (symbol.returnType) {
            return this.dataTypeToUcodeType(symbol.returnType);
          } else {
            // Fallback for functions without explicit return type
            return UcodeType.UNKNOWN;
          }
        }
        // Check for variables that might contain functions (e.g., arrow functions)
        else if (symbol.type === SymbolType.VARIABLE) {
          // Check if the variable's data type is function or if it could be callable
          if (typeof symbol.dataType === 'string') {
            if (symbol.dataType === UcodeType.FUNCTION) {
              return UcodeType.UNKNOWN; // Function calls return unknown by default
            } else if (symbol.dataType === UcodeType.UNKNOWN) {
              // For variables with unknown type (like arrow functions or dynamically assigned functions),
              // assume they might be callable to prevent false positives
              return UcodeType.UNKNOWN;
            }
          }
        }
        // Check for parameters that might be callback functions (e.g., cb(), uci_getter())
        else if (symbol.type === SymbolType.PARAMETER) {
          // Parameters with unknown or function type could be callable
          if (typeof symbol.dataType === 'string') {
            if (symbol.dataType === UcodeType.FUNCTION || symbol.dataType === UcodeType.UNKNOWN) {
              return UcodeType.UNKNOWN;
            }
          }
        }
      }
      
      // Check global builtin functions (only truly global functions remain)
      const signature = this.builtinFunctions.get(funcName);
      if (signature) {
        return this.validateBuiltinCall(node, signature);
      }
      
      this.errors.push({
        message: `Undefined function: ${funcName}`,
        start: node.start,
        end: node.end,
        severity: 'error'
      });
      return UcodeType.UNKNOWN;
    }

    // Handle member expression calls (e.g., fs.open, obj.method)
    if (node.callee.type === 'MemberExpression') {
      const memberCallee = node.callee as MemberExpressionNode;
      // Check propertyFunctionReturnTypes for factory-returned method calls
      if (memberCallee.object.type === 'Identifier' && memberCallee.property.type === 'Identifier') {
        const objName = (memberCallee.object as IdentifierNode).name;
        const methodName = (memberCallee.property as IdentifierNode).name;
        const objSym = this.symbolTable.lookup(objName);
        if (objSym?.propertyFunctionReturnTypes?.has(methodName)) {
          const returnHint = objSym.propertyFunctionReturnTypes.get(methodName)!;
          // Map simple type strings to UcodeType
          switch (returnHint) {
            case 'string': return UcodeType.STRING;
            case 'integer': return UcodeType.INTEGER;
            case 'double': return UcodeType.DOUBLE;
            case 'boolean': return UcodeType.BOOLEAN;
            case 'array': return UcodeType.ARRAY;
            case 'object': return UcodeType.OBJECT;
            case 'function': return UcodeType.FUNCTION;
            case 'null': return UcodeType.NULL;
          }
          // For complex types (uci.cursor, etc.), fall through
        }
      }
      // Member expression calls — check callee type to resolve return type
      const calleeType = this.checkNode(node.callee);
      // Propagate _fullType from callee (MemberExpression) to this CallExpression
      const calleeFullType = (node.callee as any)._fullType;
      if (calleeFullType) {
        (node as any)._fullType = calleeFullType;
        // If the callee has a union _fullType, return UNKNOWN (union can't be a single UcodeType)
        if (isUnionType(calleeFullType)) {
          return UcodeType.UNKNOWN;
        }
      }
      // If the callee is a function, calling it returns unknown (not "function").
      // Only return calleeType if it represents an actual resolved return type
      // (e.g., from known module methods that return specific types).
      if (calleeType !== UcodeType.UNKNOWN && calleeType !== UcodeType.FUNCTION) {
        return calleeType;
      }
    }

    // For other callees (but not Identifiers, which we already handled above)
    if (node.callee.type !== 'Identifier') {
      const calleeType = this.checkNode(node.callee);
      if (!this.typeCompatibility.isValidCallTarget(calleeType)) {
        this.errors.push({
          message: `Cannot call ${calleeType} as function`,
          start: node.start,
          end: node.end,
          severity: 'error'
        });
        return UcodeType.UNKNOWN;
      }
    }

    return UcodeType.UNKNOWN;
  }

  private validateBuiltinCall(node: CallExpressionNode, signature: FunctionSignature): UcodeType {
    // Ensure all arguments are checked first to populate _fullType
    for (const arg of node.arguments) {
      if (arg) {
        this.checkNode(arg);
      }
    }

    // First check special cases
    if (this.validateSpecialBuiltins(node, signature)) {
      const narrowed = this.builtinValidator.narrowedReturnType;
      this.builtinValidator.narrowedReturnType = null;
      if (narrowed !== null) {
        return narrowed;
      }
      return this.dataTypeToUcodeType(signature.returnType);
    }

    const argCount = node.arguments.length;
    const minParams = signature.minParams ?? signature.parameters.length;
    const maxParams = signature.maxParams ?? (signature.variadic ? Infinity : signature.parameters.length);

    // Check argument count
    if (argCount < minParams) {
      this.errors.push({
        message: `Function '${signature.name}' expects at least ${minParams} arguments, got ${argCount}`,
        start: node.start,
        end: node.end,
        severity: 'error'
      });
    } else if (argCount > maxParams) {
      this.errors.push({
        message: `Function '${signature.name}' expects at most ${maxParams} arguments, got ${argCount}`,
        start: node.start,
        end: node.end,
        severity: 'error'
      });
    }

    // Check argument types with enhanced union type support
    for (let i = 0; i < Math.min(argCount, signature.parameters.length); i++) {
      const expectedType = signature.parameters[i];
      const arg = node.arguments[i];
      if (!arg || !expectedType) continue;
      
      const actualType = this.checkNode(arg) || UcodeType.UNKNOWN;
      let actualTypeData = this.getFullTypeFromNode(arg) || this.getTypeAsDataType(actualType);

      // Apply AST-based guard narrowing for identifier arguments
      if (arg.type === 'Identifier' && isUnionType(actualTypeData)) {
        const varName = (arg as IdentifierNode).name;
        const guards = this.getGuardsForPosition(this.currentAST, varName, arg.start);
        if (guards.length > 0) {
          let narrowed: UcodeDataType = actualTypeData;
          for (const g of guards) {
            narrowed = this.applyTypeGuard(narrowed, g);
          }
          actualTypeData = narrowed;
        }
      }

      if (expectedType !== UcodeType.UNKNOWN && !this.typeNarrowing.isSubtype(actualTypeData, expectedType)) {
        const incompatibleTypes = this.typeNarrowing.getIncompatibleTypes(actualTypeData, expectedType);
        const actualTypes = getUnionTypes(actualTypeData);
        const hasCompatibleType = actualTypes.some(t => t === UcodeType.UNKNOWN || incompatibleTypes.indexOf(t) === -1);
        const isPartiallyCompatible = hasCompatibleType && incompatibleTypes.length > 0;

        const incompatibilityDesc = this.typeNarrowing.getIncompatibilityDescription(actualTypeData, expectedType);
        const message = incompatibilityDesc
          ? `Function '${signature.name}': ${incompatibilityDesc}. Use a guard or assertion.`
          : `Function '${signature.name}' expects ${expectedType} for argument ${i + 1}, got ${this.getTypeDescription(actualTypeData)}`;
        const diagData = {
          functionName: signature.name,
          argumentIndex: i,
          expectedType: expectedType as string,
          actualType: actualTypeData,
          variableName: this.getVariableName(arg)
        };

        if (isPartiallyCompatible && !this.strictMode) {
          // Possibly wrong (union/unknown with some valid types) — warning
          this.warnings.push({
            message, start: arg.start, end: arg.end,
            severity: 'warning', code: 'incompatible-function-argument', data: diagData
          });
        } else {
          // Definitely wrong, or strict mode — error
          this.errors.push({
            message, start: arg.start, end: arg.end,
            severity: 'error', code: 'incompatible-function-argument', data: diagData
          });
        }
      }
    }

    return this.dataTypeToUcodeType(signature.returnType);
  }


  /**
   * Detect if a data type represents a known object type from the dispatch layer.
   */
  private detectObjectType(dataType: UcodeDataType): KnownObjectType | null {
    if (typeof dataType === 'string') return null;
    if (typeof dataType === 'object' && 'moduleName' in dataType) {
      const name = (dataType as any).moduleName as string;
      if (isKnownObjectType(name)) return name;
    }
    return null;
  }

  private returnTypeStringToUcodeType(returnType: string | UcodeType): UcodeType {
    if (Object.values(UcodeType).includes(returnType as UcodeType)) {
      return returnType as UcodeType;
    }
    // For union types, use parseReturnType and store _fullType on the caller's node.
    // This method only handles simple (non-union) type strings.
    switch (returnType) {
      case 'integer':
      case 'number':
        return UcodeType.INTEGER;
      case 'string':
        return UcodeType.STRING;
      case 'boolean':
        return UcodeType.BOOLEAN;
      case 'null':
        return UcodeType.NULL;
      case 'array':
      case 'string[]':
        return UcodeType.ARRAY;
      case 'object':
      case 'io.handle':
        return UcodeType.OBJECT;
      default:
        return UcodeType.UNKNOWN;
    }
  }

  private dataTypeToUcodeType(dataType: UcodeDataType): UcodeType {
    // Handle string type (UcodeType)
    if (typeof dataType === 'string') {
      return dataType as UcodeType;
    }
    
    // Handle complex types (UnionType, ModuleType)
    const complexType = dataType as any;
    if (complexType.type === UcodeType.UNION) {
      // For union types, return UNKNOWN for now to maintain compatibility
      // This could be enhanced later to return a more specific type
      return UcodeType.UNKNOWN;
    }
    if (complexType.type === UcodeType.OBJECT && 'moduleName' in complexType) {
      return UcodeType.OBJECT;
    }
    if (complexType.type) {
      return complexType.type;
    }
    
    return UcodeType.UNKNOWN;
  }

  private validateSpecialBuiltins(node: CallExpressionNode, signature: FunctionSignature): boolean {
    const funcName = signature.name;
    
    switch (funcName) {
      case 'length':
        return this.builtinValidator.validateLengthFunction(node);
      case 'index':
        return this.builtinValidator.validateIndexFunction(node);
      case 'rindex':
        return this.builtinValidator.validateRindexFunction(node);
      case 'match':
        return this.builtinValidator.validateMatchFunction(node);
      case 'split':
        return this.builtinValidator.validateSplitFunction(node);
      case 'replace':
        return this.builtinValidator.validateReplaceFunction(node);
      case 'localtime':
        return this.builtinValidator.validateLocaltimeFunction(node);
      case 'gmtime':
        return this.builtinValidator.validateGmtimeFunction(node);
      case 'timelocal':
        return this.builtinValidator.validateTimelocalFunction(node);
      case 'timegm':
        return this.builtinValidator.validateTimegmFunction(node);
      case 'json':
        return this.builtinValidator.validateJsonFunction(node);
      case 'call':
        return this.builtinValidator.validateCallFunction(node);
      case 'signal':
        return this.builtinValidator.validateSignalFunction(node);
      case 'system':
        return this.builtinValidator.validateSystemFunction(node);
      case 'sleep':
        return this.builtinValidator.validateSleepFunction(node);
      case 'min':
        return this.builtinValidator.validateMinFunction(node);
      case 'max':
        return this.builtinValidator.validateMaxFunction(node);
      case 'uniq':
        return this.builtinValidator.validateUniqFunction(node);
      case 'printf':
        return this.builtinValidator.validatePrintfFunction(node);
      case 'sprintf':
        return this.builtinValidator.validateSprintfFunction(node);
      case 'iptoarr':
        return this.builtinValidator.validateIptoarrFunction(node);
      case 'arrtoip':
        return this.builtinValidator.validateArrtoipFunction(node);
      case 'int':
        return this.builtinValidator.validateIntFunction(node);
      case 'hex':
        return this.builtinValidator.validateHexFunction(node);
      case 'chr':
        return this.builtinValidator.validateChrFunction(node);
      case 'ord':
        return this.builtinValidator.validateOrdFunction(node);
      case 'uchr':
        return this.builtinValidator.validateUchrFunction(node);
      case 'require':
        return this.builtinValidator.validateRequireFunction(node);
      case 'include':
        return this.builtinValidator.validateIncludeFunction(node);
      case 'hexdec':
        return this.builtinValidator.validateHexdecFunction(node);
      case 'b64enc':
        return this.builtinValidator.validateB64encFunction(node);
      case 'b64dec':
        return this.builtinValidator.validateB64decFunction(node);
      case 'loadfile':
        return this.builtinValidator.validateLoadfileFunction(node);
      case 'loadstring':
        return this.builtinValidator.validateLoadstringFunction(node);
      case 'sourcepath':
        return this.builtinValidator.validateSourcepathFunction(node);
      case 'regexp':
        return this.builtinValidator.validateRegexpFunction(node);
      case 'wildcard':
        return this.builtinValidator.validateWildcardFunction(node);
      case 'assert':
        return this.builtinValidator.validateAssertFunction(node);
      case 'type':
        return this.builtinValidator.validateTypelocalFunction(node);
      case 'clock':
        return this.builtinValidator.validateClockFunction(node);
      case 'gc':
        return this.builtinValidator.validateGcFunction(node);
      case 'push':
        return this.builtinValidator.validatePushFunction(node);
      case 'pop':
        return this.builtinValidator.validatePopFunction(node);
      case 'shift':
        return this.builtinValidator.validateShiftFunction(node);
      case 'unshift':
        return this.builtinValidator.validateUnshiftFunction(node);
      case 'slice':
        return this.builtinValidator.validateSliceFunction(node);
      case 'splice':
        return this.builtinValidator.validateSpliceFunction(node);
      case 'sort':
        return this.builtinValidator.validateSortFunction(node);
      case 'reverse':
        return this.builtinValidator.validateReverseFunction(node);
      case 'filter':
        return this.builtinValidator.validateFilterFunction(node);
      case 'map':
        return this.builtinValidator.validateMapFunction(node);
      case 'keys':
        return this.builtinValidator.validateKeysFunction(node);
      case 'values':
        return this.builtinValidator.validateValuesFunction(node);
      case 'exists':
        return this.builtinValidator.validateExistsFunction(node);
      case 'trim':
        return this.builtinValidator.validateTrimFunction(node);
      case 'ltrim':
        return this.builtinValidator.validateLtrimFunction(node);
      case 'rtrim':
        return this.builtinValidator.validateRtrimFunction(node);
      case 'substr':
        return this.builtinValidator.validateSubstrFunction(node);
      default:
        return false;
    }
  }

  private checkMemberExpression(node: MemberExpressionNode): UcodeType {
    // Check if the object is a module
    if (node.object.type === 'Identifier') {
      const symbol = this.symbolTable.lookup((node.object as IdentifierNode).name);
      
      // If symbol doesn't exist, let the semantic analyzer handle the "Undefined variable" error
      // Don't duplicate the error here by calling checkNode(node.object)
      if (!symbol) {
        return UcodeType.UNKNOWN;
      }

      if (!node.computed &&
          (node.property.type === 'Identifier' || node.property.type === 'Literal') &&
          node.object.type === 'Identifier') {
        let propertyName: string | null = null;
        if (node.property.type === 'Identifier') {
          propertyName = (node.property as IdentifierNode).name;
        } else {
          const literalProperty = node.property as LiteralNode;
          if (literalProperty.value !== undefined && literalProperty.value !== null) {
            propertyName = String(literalProperty.value);
          }
        }

        if (propertyName && symbol.propertyTypes && symbol.propertyTypes.has(propertyName)) {
          const propertyType = symbol.propertyTypes.get(propertyName)!;
          return this.dataTypeToUcodeType(propertyType);
        }
      }

      // Check if this is a known object type (fs.file/dir/proc, io.handle, uloop.*, uci.cursor, nl80211.listener)
      const detectedObjectType = this.detectObjectType(symbol.dataType);
      if (detectedObjectType && !node.computed) {
        const methodName = (node.property as IdentifierNode).name;
        const method = OBJECT_REGISTRIES[detectedObjectType].getMethod(methodName);
        if (Option.isSome(method)) {
          // Parse the full return type (preserves unions) and store on node
          const fullReturnType = this.parseReturnType(method.value.returnType);
          (node as any)._fullType = fullReturnType;
          if (isUnionType(fullReturnType)) {
            return UcodeType.UNKNOWN;
          }
          return this.returnTypeStringToUcodeType(method.value.returnType);
        }
        this.errors.push({
          message: `Method '${methodName}' does not exist on ${detectedObjectType}`,
          start: node.start,
          end: node.end,
          severity: 'error'
        });
        return UcodeType.UNKNOWN;
      }

      // Check if this is an rtnl constants object with a specific property
      if (symbol.dataType && typeof symbol.dataType === 'object' &&
          'moduleName' in symbol.dataType && symbol.dataType.moduleName === 'rtnl-const' && !node.computed) {
        const propertyName = this.getStaticPropertyName(node.property);
        if (!propertyName) {
          return UcodeType.UNKNOWN;
        }
        if (!rtnlTypeRegistry.isRtnlConstant(propertyName)) {
          const objectName = node.object.type === 'Identifier'
            ? (node.object as IdentifierNode).name
            : null;
          if (objectName && this.isAssignmentTargetContext()) {
            this.recordConstantAssignment(objectName, propertyName);
            this.ensureSymbolHasIntegerProperty(objectName, propertyName);
            return UcodeType.INTEGER;
          }
          if (objectName && this.hasConstantAssignment(objectName, propertyName)) {
            return UcodeType.INTEGER;
          }
          this.errors.push({
            message: `Property '${propertyName}' does not exist on rtnl constants object. Available constants: ${rtnlTypeRegistry.getConstantNames().join(', ')}`,
            start: node.property.start,
            end: node.property.end,
            severity: 'error'
          });
          return UcodeType.UNKNOWN;
        }
        return UcodeType.INTEGER; // RTNL constants are integers
      }
      
      // Check if this is an nl80211 constants object with a specific property
      if (symbol.dataType && typeof symbol.dataType === 'object' && 
          'moduleName' in symbol.dataType && symbol.dataType.moduleName === 'nl80211-const' && !node.computed) {
        const propertyName = this.getStaticPropertyName(node.property);
        if (!propertyName) {
          return UcodeType.UNKNOWN;
        }
        if (!nl80211TypeRegistry.isNl80211Constant(propertyName)) {
          const objectName = node.object.type === 'Identifier'
            ? (node.object as IdentifierNode).name
            : null;
          if (objectName && this.isAssignmentTargetContext()) {
            this.recordConstantAssignment(objectName, propertyName);
            this.ensureSymbolHasIntegerProperty(objectName, propertyName);
            return UcodeType.INTEGER;
          }
          if (objectName && this.hasConstantAssignment(objectName, propertyName)) {
            return UcodeType.INTEGER;
          }
          this.errors.push({
            message: `Property '${propertyName}' does not exist on nl80211 constants object. Available constants: ${nl80211TypeRegistry.getConstantNames().join(', ')}`,
            start: node.property.start,
            end: node.property.end,
            severity: 'error'
          });
          return UcodeType.UNKNOWN;
        }
        return UcodeType.INTEGER; // NL80211 constants are integers
      }
    }

    // For computed property access on arrays (e.g., uuid[0]), check if we have type info
    if (node.object.type === 'Identifier' && node.computed) {
      const symbol = this.symbolTable.lookup((node.object as IdentifierNode).name);
      if (symbol && symbol.dataType === UcodeType.ARRAY && node.property.type === 'Literal') {
        const indexKey = String((node.property as LiteralNode).value);
        if (symbol.propertyTypes && symbol.propertyTypes.has(indexKey)) {
          const elementType = symbol.propertyTypes.get(indexKey)!;
          return this.dataTypeToUcodeType(elementType);
        }
      }
    }

    const objectType = this.checkNode(node.object);

    // Check for array type (with TypeScript workaround)
    if ((objectType as any) === UcodeType.ARRAY && !node.computed) {
      // Arrays in ucode have no properties or methods at all
      const propertyName = (node.property as IdentifierNode).name;
      
      // Invalid property/method access on array
      this.errors.push({
        message: `Property '${propertyName}' does not exist on array type. Arrays in ucode have no properties or methods. Use builtin functions instead (e.g., length(array), filter(array, callback)).`,
        start: node.property.start,
        end: node.property.end,
        severity: 'error'
      });
      return UcodeType.UNKNOWN;
    }
    
    if (objectType === UcodeType.OBJECT) {
      return this.typeCompatibility.getObjectPropertyType(objectType);
    }

    if (objectType === UcodeType.STRING && !node.computed) {
      // String has no properties.
      const propertyName = (node.property as IdentifierNode).name;
      this.errors.push({
        message: `Property '${propertyName}' does not exist on string type. Strings in ucode have no member variables or functions.`,
        start: node.property.start,
        end: node.property.end,
        severity: 'error'
      });
      
      return UcodeType.UNKNOWN;
    }

    if (objectType === UcodeType.REGEX && !node.computed) {
      // Regex objects have no properties or methods at all
      const propertyName = (node.property as IdentifierNode).name;
      
      // Invalid property/method access on regex
      this.errors.push({
        message: `Property '${propertyName}' does not exist on regex type. Regular expressions in ucode have no properties or methods. Use builtin functions instead (e.g., match(string, regex), replace(string, regex, replacement)).`,
        start: node.property.start,
        end: node.property.end,
        severity: 'error'
      });
      return UcodeType.UNKNOWN;
    }

    return UcodeType.UNKNOWN;
  }


  private checkAssignmentExpression(node: AssignmentExpressionNode): UcodeType {
    const leftType = this.checkNode(node.left);
    const rightType = this.checkNode(node.right);

    // Track array element types
    if (node.operator === '=' && node.left.type === 'MemberExpression') {
      const memberExpr = node.left as MemberExpressionNode;
      if (memberExpr.object.type === 'Identifier' && memberExpr.computed) {
        const arrayName = (memberExpr.object as IdentifierNode).name;
        const symbol = this.symbolTable.lookup(arrayName);

        // If this is an array variable, track the element type
        if (symbol && symbol.dataType === UcodeType.ARRAY) {
          // Get the index if it's a literal
          let indexKey: string | null = null;
          if (memberExpr.property.type === 'Literal') {
            const literalProp = memberExpr.property as LiteralNode;
            indexKey = String(literalProp.value);
          }

          if (indexKey !== null) {
            // Initialize propertyTypes map if it doesn't exist
            if (!symbol.propertyTypes) {
              symbol.propertyTypes = new Map<string, UcodeDataType>();
            }

            // Store the type of this array element
            const rightDataType = this.ucodeTypeToDataType(rightType);
            symbol.propertyTypes.set(indexKey, rightDataType);
          }
        }
      }
    }

    // Type compatibility check - but NOT for simple identifier assignments
    // Variables can change type, so we only check property/array element assignments
    if (node.operator === '=' &&
        node.left.type !== 'Identifier' && // Allow variables to change type
        leftType !== UcodeType.UNKNOWN &&
        rightType !== UcodeType.UNKNOWN) {
      if (!this.typeCompatibility.canAssign(leftType, rightType)) {
        this.warnings.push({
          message: `Type mismatch: assigning ${rightType} to ${leftType}`,
          start: node.start,
          end: node.end,
          severity: 'warning'
        });
      }
    }

    return rightType;
  }

  private ucodeTypeToDataType(type: UcodeType): UcodeDataType {
    // Simple conversion - for more complex types we'd need to handle unions
    return type as UcodeDataType;
  }

  private checkArrayExpression(node: ArrayExpressionNode): UcodeType {
    // Check all elements for type consistency
    for (const element of node.elements) {
      if (element) {
        this.checkNode(element);
      }
    }
    return UcodeType.ARRAY;
  }

  private checkObjectExpression(node: ObjectExpressionNode): UcodeType {
    // Check all properties
    for (const property of node.properties) {
      this.checkNode(property.key);
      this.checkNode(property.value);
    }
    return UcodeType.OBJECT;
  }

  private checkConditionalExpression(node: ConditionalExpressionNode): UcodeType {
    this.checkNode(node.test);
    const consequentType = this.checkNode(node.consequent);
    const alternateType = this.checkNode(node.alternate);

    const resultType = this.typeCompatibility.getTernaryResultType(consequentType, alternateType);

    return this.getTypeDescription(resultType) as UcodeType;
  }

  private checkArrowFunctionExpression(_node: ArrowFunctionExpressionNode): UcodeType {
    // Arrow functions are callable, so they have function type
    // For now, we don't analyze parameter types or return type inference
    // This is sufficient to prevent "Undefined function" errors for arrow functions
    return UcodeType.FUNCTION;
  }

  private checkFunctionExpression(_node: FunctionExpressionNode): UcodeType {
    // Function expressions are also callable
    return UcodeType.FUNCTION;
  }

  private checkIfStatement(node: IfStatementNode): UcodeType {
    // Type check the condition
    this.checkNode(node.test);

    // Analyze type guards and get the guard info
    const guards = this.flowSensitiveTracker.analyzeIfStatement(node);


    // Process the consequent (then block) with positive narrowing
    if (node.consequent) {
      for (const guard of guards) {
        this.pushGuardContext(
          guard.variableName,
          guard.positiveNarrowing,
          node.consequent.start,
          node.consequent.end
        );
      }

      this.checkNode(node.consequent);
      
      // Clean up guard contexts
      for (let i = 0; i < guards.length; i++) {
        this.popGuardContext();
      }
    }
    
    // Process the alternate (else block) with negative narrowing  
    if (node.alternate) {
      for (const guard of guards) {
        this.pushGuardContext(
          guard.variableName,
          guard.negativeNarrowing,
          node.alternate.start,
          node.alternate.end
        );
      }
      
      this.checkNode(node.alternate);
      
      // Clean up guard contexts
      for (let i = 0; i < guards.length; i++) {
        this.popGuardContext();
      }
    }
    
    return UcodeType.UNKNOWN; // If statements don't return values
  }

  private checkExpressionStatement(node: ExpressionStatementNode): UcodeType {
    return this.checkNode(node.expression);
  }

  private checkVariableDeclaration(node: VariableDeclarationNode): UcodeType {
    for (const declarator of node.declarations) {
      if (declarator.init) {
        this.checkNode(declarator.init);
      }
    }
    return UcodeType.UNKNOWN;
  }

  private checkBlockStatement(node: BlockStatementNode): UcodeType {
    for (let i = 0; i < node.body.length; i++) {
      const statement = node.body[i]!;

      // Detect early-exit if and push negative narrowing for remaining statements
      if (statement.type === 'IfStatement') {
        const ifStmt = statement as IfStatementNode;
        if (ifStmt.consequent && this.blockAlwaysTerminates(ifStmt.consequent)) {
          const guards = this.flowSensitiveTracker.analyzeIfStatement(ifStmt);
          if (guards.length > 0) {
            this.checkNode(statement);
            // Push negative narrowing for the rest of the block
            for (const guard of guards) {
              this.pushGuardContext(
                guard.variableName,
                guard.negativeNarrowing,
                statement.end,
                node.end
              );
            }
            // Check remaining statements
            for (let j = i + 1; j < node.body.length; j++) {
              this.checkNode(node.body[j]!);
            }
            for (let j = 0; j < guards.length; j++) {
              this.popGuardContext();
            }
            return UcodeType.UNKNOWN;
          }
        }
      }

      this.checkNode(statement);
    }
    return UcodeType.UNKNOWN;
  }

  private blockAlwaysTerminates(block: AstNode): boolean {
    let statements: AstNode[];
    if (block.type === 'BlockStatement') {
      statements = (block as BlockStatementNode).body;
    } else {
      statements = [block];
    }
    if (statements.length === 0) return false;
    const last = statements[statements.length - 1]!;

    if (last.type === 'ReturnStatement') return true;
    if (last.type === 'BreakStatement') return true;
    if (last.type === 'ContinueStatement') return true;

    // die(), exit(), or user-defined neverReturns function call
    if (last.type === 'ExpressionStatement') {
      const expr = (last as ExpressionStatementNode).expression;
      if (expr.type === 'CallExpression') {
        const call = expr as CallExpressionNode;
        if (call.callee.type === 'Identifier') {
          const name = (call.callee as IdentifierNode).name;
          if (name === 'die' || name === 'exit') return true;
          const sym = this.symbolTable.lookup(name);
          if (sym?.neverReturns) return true;
        }
      }
    }
    return false;
  }

  private checkReturnStatement(node: any): UcodeType {
    if (node.argument) {
      return this.checkNode(node.argument);
    }
    return UcodeType.UNKNOWN;
  }

  private checkSwitchStatement(node: SwitchStatementNode): UcodeType {
    this.checkNode(node.discriminant);

    const switchInfo = this.getTypeSwitchVariable(node.discriminant);
    const handledTypes: UcodeType[] = [];

    for (const caseNode of node.cases) {
      let pushedGuard = false;

      if (switchInfo && caseNode.consequent.length > 0) {
        const { start, end } = this.getCaseRange(caseNode);
        const baseType = this.getBaseTypeForPosition(switchInfo.variableName, start);
        let narrowedType: UcodeDataType | null = null;

        if (caseNode.test && caseNode.test.type === 'Literal') {
          const caseLiteral = caseNode.test as LiteralNode;
          if (typeof caseLiteral.value === 'string') {
            const testedType = this.stringLiteralToUcodeType(caseLiteral.value);
            if (testedType) {
              if (!handledTypes.includes(testedType)) {
                handledTypes.push(testedType);
              }
              narrowedType = this.typeNarrowing.keepOnlyTypes(baseType, [testedType]).narrowedType;
            }
          }
        } else if (!caseNode.test && handledTypes.length > 0) {
          narrowedType = this.typeNarrowing.removeTypesFromUnion(baseType, handledTypes).narrowedType;
        } else if (!caseNode.test) {
          narrowedType = baseType;
        }

        if (narrowedType) {
          this.pushGuardContext(switchInfo.variableName, narrowedType, start, end);
          pushedGuard = true;
        }
      }

      for (const statement of caseNode.consequent) {
        this.checkNode(statement);
      }

      if (switchInfo && pushedGuard) {
        this.popGuardContext();
      }
    }

    return UcodeType.UNKNOWN;
  }

  private getTypeSwitchVariable(discriminant: AstNode): { variableName: string } | null {
    if (discriminant.type !== 'CallExpression') {
      return null;
    }

    const callExpr = discriminant as CallExpressionNode;
    if (callExpr.callee.type !== 'Identifier' ||
        (callExpr.callee as IdentifierNode).name !== 'type') {
      return null;
    }

    if (!callExpr.arguments.length || !callExpr.arguments[0] || callExpr.arguments[0].type !== 'Identifier') {
      return null;
    }

    const variableName = (callExpr.arguments[0] as IdentifierNode).name;
    return { variableName };
  }

  private getCaseRange(caseNode: SwitchCaseNode): { start: number; end: number } {
    if (caseNode.consequent.length > 0) {
      const first = caseNode.consequent[0]!;
      const last = caseNode.consequent[caseNode.consequent.length - 1]!;
      return {
        start: first.start,
        end: last.end
      };
    }

    return { start: caseNode.start, end: caseNode.end };
  }

  private stringLiteralToUcodeType(value: string): UcodeType | null {
    switch (value) {
      case 'array':
        return UcodeType.ARRAY;
      case 'object':
        return UcodeType.OBJECT;
      case 'string':
        return UcodeType.STRING;
      case 'int':
        return UcodeType.INTEGER;
      case 'double':
        return UcodeType.DOUBLE;
      case 'bool':
        return UcodeType.BOOLEAN;
      case 'function':
        return UcodeType.FUNCTION;
      case 'null':
        return UcodeType.NULL;
      default:
        return null;
    }
  }

  private checkTryStatement(node: any): UcodeType {
    // Check the try block
    if (node.block) {
      this.checkNode(node.block);
    }

    // Check catch handler (let checkCatchClause handle the details)
    if (node.handler) {
      this.checkNode(node.handler);
    }

    // Check finally block
    if (node.finalizer) {
      this.checkNode(node.finalizer);
    }

    return UcodeType.UNKNOWN;
  }

  private checkCatchClause(node: any): UcodeType {
    // Enter catch scope
    this.symbolTable.enterScope();

    // Declare catch parameter (the exception variable)
    if (node.param) {
      const exceptionType = createExceptionObjectDataType();
      this.symbolTable.declare(
        node.param.name,
        SymbolType.PARAMETER,
        exceptionType,
        node.param
      );
    }

    // Check catch body
    if (node.body) {
      this.checkNode(node.body);
    }

    // Exit catch scope
    this.symbolTable.exitScope();

    return UcodeType.UNKNOWN;
  }

  private getBaseTypeForPosition(variableName: string, position: number): UcodeDataType {
    const guardType = this.getActiveGuardType(variableName, position);
    if (guardType) {
      return guardType;
    }

    const flowType = this.flowSensitiveTracker.getEffectiveType(variableName, position);
    if (flowType) {
      return flowType;
    }

    const symbol = this.symbolTable.lookup(variableName);
    return symbol ? symbol.dataType : UcodeType.UNKNOWN;
  }

  /**
   * Check if a switch case has a break/return statement
   */
  private caseHasBreak(caseNode: SwitchCaseNode): boolean {
    for (const statement of caseNode.consequent) {
      if (statement.type === 'BreakStatement' || statement.type === 'ReturnStatement') {
        return true;
      }
      // Check inside block statements
      if (statement.type === 'BlockStatement') {
        const blockNode = statement as any;
        if (blockNode.body && Array.isArray(blockNode.body)) {
          for (const innerStmt of blockNode.body) {
            if (innerStmt.type === 'BreakStatement' || innerStmt.type === 'ReturnStatement') {
              return true;
            }
          }
        }
      }
    }
    return false;
  }

  getCommonReturnType(types: UcodeType[]): UcodeDataType {
    return this.typeCompatibility.getCommonType(types);
  }

  get flowTracker(): FlowSensitiveTypeTracker {
    return this.flowSensitiveTracker;
  }

  /**
   * Set the current AST root for AST analysis
   */
  setAST(ast: ProgramNode): void {
    this.currentAST = ast;
    this.strictMode = this.detectStrictMode(ast);
    this.builtinValidator.setStrictMode(this.strictMode);
  }

  private detectStrictMode(ast: ProgramNode): boolean {
    if (!ast.body || ast.body.length === 0) return false;
    // Check first statement for 'use strict'; directive
    const first = ast.body[0];
    if (first?.type === 'ExpressionStatement') {
      const expr = (first as any).expression;
      if (expr?.type === 'Literal' && expr.value === 'use strict') {
        return true;
      }
    }
    return false;
  }

  /**
   * Public method to get the narrowed type for a variable at a specific position
   * Used by hover functionality to show flow-sensitive types
   */
  getNarrowedTypeAtPosition(variableName: string, position: number): UcodeDataType | null {
    // First check guard context stack (used for if statements with type guards)
    const guardType = this.getActiveGuardType(variableName, position);
    if (guardType) {
      return guardType;
    }

    const guards = this.getGuardsForPosition(this.currentAST, variableName, position);

    // Get the base type from the symbol table if available
    // Try both lookup (current scope) and lookupAtPosition (exited scopes like callbacks)
    let symbol = this.symbolTable.lookup(variableName);
    if (!symbol) {
      symbol = this.symbolTable.lookupAtPosition(variableName, position);
    }
    if (!symbol) {
      // If the variable isn't in the symbol table (e.g., callback parameter),
      // try to infer its narrowed type purely from guard information.
      if (guards.length > 0) {
        const narrowedFromGuards = this.inferTypeFromGuardsWithoutBase(guards);
        if (narrowedFromGuards) {
          return narrowedFromGuards;
        }
      }
      return null;
    }

    const baseType = symbol.dataType;

    // Check if this position is inside a type guard
    if (guards.length > 0) {
      const positiveGuards = guards.filter(g => !g.isNegative && g.narrowToType !== null);

      if (positiveGuards.length > 1) {
        // Multiple positive guards - combine into union (fall-through case without default)
        const types = positiveGuards.map(g => g.narrowToType!);
        const narrowingResult = this.typeNarrowing.keepOnlyTypes(baseType, types);
        return narrowingResult.narrowedType;
      }

      // Single guard or all negative - apply sequentially
      let narrowedType = baseType;
      for (const guardInfo of guards) {
        narrowedType = this.applyTypeGuard(narrowedType, guardInfo);
      }
      return narrowedType;
    }

    return null; // No narrowing applies
  }

  private inferTypeFromGuardsWithoutBase(guards: TypeGuardInfo[]): UcodeDataType | null {
    if (guards.length === 0) {
      return null;
    }

    const positiveTypes = guards
      .filter(guard => !guard.isNegative && guard.narrowToType !== null)
      .map(guard => guard.narrowToType as UcodeType);

    if (positiveTypes.length === 0) {
      return null;
    }

    const uniqueTypes = Array.from(new Set(positiveTypes));
    if (uniqueTypes.length === 1) {
      return uniqueTypes[0] as UcodeDataType;
    }

    return createUnionType(uniqueTypes);
  }

  /**
   * Apply a type guard to narrow a type
   */
  private applyTypeGuard(baseType: UcodeDataType, guard: TypeGuardInfo): UcodeDataType {
    if (guard.narrowToType === null) {
      return baseType;
    }

    // Normalize string union types (e.g., "null | array") to structured UnionType objects
    // This can happen when types come from CFG or symbol table as strings
    if (typeof baseType === 'string' && baseType.includes(' | ')) {
      const parts = baseType.split(' | ').map(s => s.trim()) as UcodeType[];
      baseType = createUnionType(parts);
    }

    // Handle combined OR guards (e.g., type(x) === 'array' || type(x) === 'string')
    if ((guard as any).isCombinedOr) {
      // The narrowToType is already the narrowed union type (e.g., 'array' from 'array | object')
      return guard.narrowToType as UcodeDataType;
    }

    if (guard.narrowToType === UcodeType.NULL) {
      if (guard.isNegative) {
        // Remove null from the union (non-null branch)
        const narrowingResult = this.typeNarrowing.removeNullFromType(baseType);
        return narrowingResult.narrowedType;
      }

      // Keep only null in the positive equality branch
      const narrowingResult = this.typeNarrowing.keepOnlyTypes(baseType, [UcodeType.NULL]);
      return narrowingResult.narrowedType;
    }

    if (guard.isNegative) {
      // Remove the specified type in negative branch
      const narrowingResult = this.typeNarrowing.removeTypesFromUnion(baseType, [guard.narrowToType]);
      return narrowingResult.narrowedType;
    }

    // Positive branch keeps only the specified type
    const narrowingResult = this.typeNarrowing.keepOnlyTypes(baseType, [guard.narrowToType]);
    return narrowingResult.narrowedType;
  }

  /**
   * Collect all guards that apply to the variable at the specified position
   */
  private getGuardsForPosition(ast: AstNode | null, variableName: string, position: number): TypeGuardInfo[] {
    if (!ast) {
      return [];
    }

    const guards: TypeGuardInfo[] = [];
    this.collectGuards(ast, variableName, position, guards);
    return guards;
  }

  private collectGuards(node: AstNode | null, variableName: string, position: number, guards: TypeGuardInfo[]): void {
    if (!node) {
      return;
    }

    if (node.type === 'BinaryExpression') {
      const binaryNode = node as BinaryExpressionNode;

      if (binaryNode.operator === '&&' &&
          position >= binaryNode.right.start && position <= binaryNode.right.end) {
        const guardInfo = this.findGuardInCondition(binaryNode.left, variableName);
        if (guardInfo) {
          guards.push(guardInfo);
        }
        this.collectGuards(binaryNode.right, variableName, position, guards);
        return;
      }
    }

    if (node.type === 'IfStatement') {
      const ifNode = node as IfStatementNode;

      if (ifNode.consequent &&
          position >= ifNode.consequent.start &&
          position <= ifNode.consequent.end) {
        const guardInfo = this.extractTypeGuard(ifNode.test, variableName);
        if (guardInfo) {
          guards.push(guardInfo);
        }
        // Bare identifier truthiness: if (x) { ... } → x is non-null in consequent
        if (ifNode.test.type === 'Identifier' &&
            (ifNode.test as IdentifierNode).name === variableName) {
          guards.push({
            variableName,
            narrowToType: UcodeType.NULL,
            isNegative: true // Remove null
          });
        }
        // && left identifier truthiness: if (x && expr) { ... } → x is non-null in consequent
        if (ifNode.test.type === 'BinaryExpression') {
          const testBin = ifNode.test as BinaryExpressionNode;
          if (testBin.operator === '&&' && testBin.left.type === 'Identifier' &&
              (testBin.left as IdentifierNode).name === variableName) {
            guards.push({
              variableName,
              narrowToType: UcodeType.NULL,
              isNegative: true // Remove null
            });
          }
        }
        // Truthiness of null-propagating call: if (length(x)) { ... }
        if (ifNode.test.type === 'CallExpression') {
          const np = this.getNullPropagatingArg(ifNode.test);
          if (np) {
            const argName = this.getArgVariableName(np.arg);
            if (argName === variableName) {
              guards.push({ variableName, narrowToType: UcodeType.NULL, isNegative: true });
            }
          }
        }
        // Negated identifier: if (!x) { ... } → x is null/falsy in consequent (no narrowing benefit)
        this.collectGuards(ifNode.consequent, variableName, position, guards);
        return;
      }

      if (ifNode.alternate &&
          position >= ifNode.alternate.start &&
          position <= ifNode.alternate.end) {
        const guardInfo = this.extractTypeGuard(ifNode.test, variableName);
        if (guardInfo) {
          guards.push({ ...guardInfo, isNegative: !guardInfo.isNegative });
        }
        // Negated identifier: if (!x) { ... } else { ... } → x is non-null in else
        if (ifNode.test.type === 'UnaryExpression') {
          const unary = ifNode.test as any;
          if (unary.operator === '!' && unary.argument?.type === 'Identifier' &&
              unary.argument.name === variableName) {
            guards.push({
              variableName,
              narrowToType: UcodeType.NULL,
              isNegative: true // Remove null in else branch
            });
          }
        }
        // Bare identifier: if (x) { ... } else { ... } → x could be null in else (no removal)
        this.collectGuards(ifNode.alternate, variableName, position, guards);
        return;
      }
    }

    if (node.type === 'SwitchStatement') {
      const switchNode = node as SwitchStatementNode;
      const switchInfo = this.getTypeSwitchVariable(switchNode.discriminant);

      if (switchInfo && switchInfo.variableName === variableName) {
        const handledTypes: UcodeType[] = [];

        // First pass: collect all handled types and detect breaks
        const caseInfo: Array<{caseNode: SwitchCaseNode, type: UcodeType | null, hasBreak: boolean}> = [];
        for (const caseNode of switchNode.cases) {
          let testedType: UcodeType | null = null;
          if (caseNode.test && caseNode.test.type === 'Literal') {
            const caseLiteral = caseNode.test as LiteralNode;
            if (typeof caseLiteral.value === 'string') {
              testedType = this.stringLiteralToUcodeType(caseLiteral.value);
              if (testedType && !handledTypes.includes(testedType)) {
                handledTypes.push(testedType);
              }
            }
          }

          // Check if this case has a break statement
          const hasBreak = this.caseHasBreak(caseNode);
          caseInfo.push({caseNode, type: testedType, hasBreak});
        }

        // Second pass: find which case contains the position and apply guards with fall-through
        for (let i = 0; i < caseInfo.length; i++) {
          const info = caseInfo[i];
          if (!info || info.caseNode.consequent.length === 0) continue;

          const { start, end } = this.getCaseRange(info.caseNode);
          if (position >= start && position <= end) {
            // Collect all types that can reach this position (including fall-through from above)
            const reachableTypes: UcodeType[] = [];

            // Look backwards to find all cases that can fall through to here
            for (let j = 0; j <= i; j++) {
              const prevInfo = caseInfo[j];
              if (!prevInfo) continue;

              if (prevInfo.type) {
                reachableTypes.push(prevInfo.type);
              }
              // If we hit a break before reaching our case, stop looking back
              if (j < i && prevInfo.hasBreak && prevInfo.caseNode.consequent.length > 0) {
                // This case has a break and has code, so it can't fall through
                // Clear previous types
                reachableTypes.length = 0;
              }
            }

            // Handle default case specially - it can have both fall-through types AND unhandled types
            const isDefaultCase = !info.caseNode.test;

            if (isDefaultCase) {
              // Default case: can be reached by fall-through from previous cases OR directly
              // The type should be: (base type) MINUS (handled types that didn't fall through)

              // Remove types that were handled but didn't reach here via fall-through
              const handledTypesNotReachable = handledTypes.filter(t => !reachableTypes.includes(t));

              if (handledTypesNotReachable.length > 0) {
                // There are some handled types that didn't fall through - remove them
                for (const handledType of handledTypesNotReachable) {
                  guards.push({
                    variableName,
                    narrowToType: handledType,
                    isNegative: true
                  });
                }
              }
              // If handledTypesNotReachable is empty, all handled types fell through,
              // so we don't narrow at all - keep the base type (which includes unhandled types like null)
            } else if (reachableTypes.length === 1 && reachableTypes[0] !== undefined) {
              // Single type - normal case (not default)
              guards.push({
                variableName,
                narrowToType: reachableTypes[0],
                isNegative: false
              });
            } else if (reachableTypes.length > 1) {
              // Multiple types due to fall-through in non-default case
              for (const reachableType of reachableTypes) {
                guards.push({
                  variableName,
                  narrowToType: reachableType,
                  isNegative: false
                });
              }
            }

            this.collectGuards(info.caseNode.consequent[0] || info.caseNode, variableName, position, guards);
            return;
          }
        }
      }
    }

    const children = this.getChildNodes(node);
    for (let i = 0; i < children.length; i++) {
      const child = children[i]!;
      if (position >= child.start && position <= child.end) {
        // Scan earlier siblings for early-exit ifs (post-early-exit narrowing)
        for (let j = 0; j < i; j++) {
          const sibling = children[j]!;
          if (sibling.type === 'IfStatement') {
            const sibIf = sibling as IfStatementNode;
            if (sibIf.consequent && this.blockAlwaysTerminates(sibIf.consequent)) {
              // Apply negative narrowing (condition was false for code to be reachable)
              const guardInfo = this.extractTypeGuard(sibIf.test, variableName);
              if (guardInfo) {
                guards.push({ ...guardInfo, isNegative: !guardInfo.isNegative });
              }
              // Handle: if (!x) die() → x is non-null after
              // Only when variable has a known union type containing null
              if (sibIf.test.type === 'UnaryExpression') {
                const unary = sibIf.test as any;
                if (unary.operator === '!' && unary.argument?.type === 'Identifier'
                    && unary.argument.name === variableName) {
                  const sym = this.symbolTable.lookup(variableName);
                  if (sym && isUnionType(sym.dataType) && getUnionTypes(sym.dataType).includes(UcodeType.NULL)) {
                    guards.push({ variableName, narrowToType: UcodeType.NULL, isNegative: true });
                  }
                }
              }
            }
          }
        }
        this.collectGuards(child, variableName, position, guards);
        return;
      }
    }
  }

  /**
   * Find guard in a condition expression (handles nested ANDs)
   */
  private findGuardInCondition(condition: AstNode, variableName: string): TypeGuardInfo | null {
    // Check if this condition itself is a guard
    const guardInfo = this.extractTypeGuard(condition, variableName);
    if (guardInfo) {
      return guardInfo;
    }

    // Check if it's a nested AND
    if (condition.type === 'BinaryExpression') {
      const binaryNode = condition as BinaryExpressionNode;
      if (binaryNode.operator === '&&') {
        // Check both sides
        const leftGuard = this.findGuardInCondition(binaryNode.left, variableName);
        if (leftGuard) {
          return leftGuard;
        }
        const rightGuard = this.findGuardInCondition(binaryNode.right, variableName);
        if (rightGuard) {
          return rightGuard;
        }
      }
    }

    return null;
  }


  /**
   * Check if a condition is a null guard for the given variable (a != null)
   */
  private isNullGuardCondition(condition: AstNode, variableName: string): boolean {
    if (condition.type === 'BinaryExpression') {
      const binaryExpr = condition as BinaryExpressionNode;

      // Check for != null or !== null patterns (a != null)
      if ((binaryExpr.operator === '!=' || binaryExpr.operator === '!==') &&
          binaryExpr.left.type === 'Identifier' &&
          (binaryExpr.left as IdentifierNode).name === variableName &&
          binaryExpr.right.type === 'Literal' &&
          (binaryExpr.right as any).value === null) {
        return true;
      }

      // Check for reversed null checks (null != a)
      if ((binaryExpr.operator === '!=' || binaryExpr.operator === '!==') &&
          binaryExpr.right.type === 'Identifier' &&
          (binaryExpr.right as IdentifierNode).name === variableName &&
          binaryExpr.left.type === 'Literal' &&
          (binaryExpr.left as any).value === null) {
        return true;
      }
    }

    // Check for truthy guard (if (a))
    if (condition.type === 'Identifier' &&
        (condition as IdentifierNode).name === variableName) {
      return true;
    }

    return false;
  }

  /**
   * Check if a condition is a null check for the given variable (a == null)
   * Used for negative narrowing in else blocks
   */
  private isNullCheckCondition(condition: AstNode, variableName: string): boolean {
    if (condition.type === 'BinaryExpression') {
      const binaryExpr = condition as BinaryExpressionNode;

      // Check for == null or === null patterns (a == null)
      if ((binaryExpr.operator === '==' || binaryExpr.operator === '===') &&
          binaryExpr.left.type === 'Identifier' &&
          (binaryExpr.left as IdentifierNode).name === variableName &&
          binaryExpr.right.type === 'Literal' &&
          (binaryExpr.right as any).value === null) {
        return true;
      }

      // Check for reversed null checks (null == a)
      if ((binaryExpr.operator === '==' || binaryExpr.operator === '===') &&
          binaryExpr.right.type === 'Identifier' &&
          (binaryExpr.right as IdentifierNode).name === variableName &&
          binaryExpr.left.type === 'Literal' &&
          (binaryExpr.left as any).value === null) {
        return true;
      }
    }

    return false;
  }

  /**
   * Extract type guard information from a condition
   * Returns null if the condition doesn't guard the variable
   */
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

  private getNullPropagatingArg(node: AstNode): { funcName: string; arg: AstNode } | null {
    if (node.type !== 'CallExpression') return null;
    const call = node as CallExpressionNode;
    if (call.callee.type !== 'Identifier') return null;
    const funcName = (call.callee as IdentifierNode).name;
    const argIndex = NULL_PROPAGATING_BUILTINS[funcName];
    if (argIndex === undefined) return null;
    const arg = call.arguments[argIndex];
    if (!arg) return null;
    return { funcName, arg };
  }

  private comparisonExcludesNull(operator: string, literalValue: any, callOnLeft: boolean): boolean {
    if (callOnLeft) {
      switch (operator) {
        case '>':  return typeof literalValue === 'number' && literalValue >= 0;
        case '>=': return typeof literalValue === 'number' && literalValue > 0;
        case '<':  return typeof literalValue === 'number' && literalValue <= 0;
        case '<=': return typeof literalValue === 'number' && literalValue < 0;
        case '==': return literalValue !== null;
        case '===': return literalValue !== null;
        case '!=': return literalValue === null;
        case '!==': return literalValue === null;
        default: return false;
      }
    } else {
      switch (operator) {
        case '<':  return typeof literalValue === 'number' && literalValue >= 0;
        case '<=': return typeof literalValue === 'number' && literalValue > 0;
        case '>':  return typeof literalValue === 'number' && literalValue <= 0;
        case '>=': return typeof literalValue === 'number' && literalValue < 0;
        case '==': return literalValue !== null;
        case '===': return literalValue !== null;
        case '!=': return literalValue === null;
        case '!==': return literalValue === null;
        default: return false;
      }
    }
  }

  private getArgVariableName(node: AstNode): string | null {
    if (node.type === 'Identifier') return (node as IdentifierNode).name;
    return null;
  }

  private extractTypeGuard(condition: AstNode, variableName: string): TypeGuardInfo | null {
    // Handle OR operator for combining type guards
    if (condition.type === 'BinaryExpression') {
      const binaryExpr = condition as BinaryExpressionNode;

      if (binaryExpr.operator === '||') {
        // Count total branches in the OR chain
        const totalBranches = this.countOrBranches(binaryExpr);

        // Collect all guards in the OR chain
        const allGuards = this.collectOrGuards(condition, variableName);

        // If we have fewer guards than branches, there's a non-guard expression
        // In this case, don't narrow - the non-guard branch could make the whole condition true
        if (allGuards.length < totalBranches) {
          return null;
        }

        if (allGuards.length >= 2) {
          // Get the variable's original type
          const symbol = this.symbolTable.lookup(variableName);
          if (!symbol) {
            return null;
          }

          const originalType = symbol.dataType;
          let originalTypes = getUnionTypes(originalType);

          // For OR guards: a type satisfies the condition if it satisfies ANY guard
          const satisfyingTypes = originalTypes.filter(type => {
            return allGuards.some(guard => {
              if (!guard.narrowToType) {
                return false;
              }

              if (guard.isNegative) {
                // Negative guard: type satisfies if it's NOT the guarded type
                return type !== guard.narrowToType;
              } else {
                // Positive guard: type satisfies if it IS the guarded type
                return type === guard.narrowToType;
              }
            });
          });

          // Check if any guard is a tautology (always true for all types)
          const hasTautology = allGuards.some(guard => {
            if (!guard.narrowToType) {
              return false;
            }
            if (guard.isNegative) {
              // Negative guard is a tautology if the tested type is NOT in the original union
              return !originalTypes.includes(guard.narrowToType);
            }
            return false;
          });

          // If there's a tautology in an OR chain and all types satisfy, no narrowing occurs
          if (hasTautology && satisfyingTypes.length === originalTypes.length) {
            return null;
          }

          // Filter effective guards for expression building
          const effectiveGuards = allGuards.filter(guard => {
            if (!guard.narrowToType) {
              return false;
            }
            return originalTypes.includes(guard.narrowToType);
          });

          if (effectiveGuards.length === 0) {
            return null;
          }

          if (satisfyingTypes.length === 0) {
            return null;
          }

          if (satisfyingTypes.length === originalTypes.length) {
            // No narrowing occurred
            return null;
          }

          const finalType = createUnionType(satisfyingTypes);
          return {
            variableName,
            narrowToType: finalType as UcodeType,
            isNegative: false,
            isCombinedOr: true
          };
        }
      }
    }

    // Check for type() == 'typename' pattern
    const typeGuardType = this.extractTypeCallGuard(condition, variableName);
    if (typeGuardType) {
      return {
        variableName,
        narrowToType: typeGuardType,
        isNegative: false
      };
    }

    // Check for type() !== 'typename' pattern (negative guard)
    const negativeTypeGuard = this.extractNegativeTypeCallGuard(condition, variableName);
    if (negativeTypeGuard) {
      return {
        variableName,
        narrowToType: negativeTypeGuard,
        isNegative: true
      };
    }

    // Check for a != null or null != a
    if (this.isNullGuardCondition(condition, variableName)) {
      return {
        variableName,
        narrowToType: UcodeType.NULL,
        isNegative: true // Remove null in positive branch
      };
    }

    // Check for a == null or null == a (positive branch keeps only null)
    if (this.isNullCheckCondition(condition, variableName)) {
      return {
        variableName,
        narrowToType: UcodeType.NULL,
        isNegative: false
      };
    }

    // Pattern: builtinCall(x) <op> literal — narrows x to non-null
    if (condition.type === 'BinaryExpression') {
      const binaryExpr = condition as BinaryExpressionNode;
      const npLeft = this.getNullPropagatingArg(binaryExpr.left);
      if (npLeft && binaryExpr.right.type === 'Literal') {
        const argVarName = this.getArgVariableName(npLeft.arg);
        if (argVarName === variableName) {
          const literalValue = (binaryExpr.right as any).value;
          if (this.comparisonExcludesNull(binaryExpr.operator, literalValue, true)) {
            return { variableName, narrowToType: UcodeType.NULL, isNegative: true };
          }
        }
      }
      // Reversed: literal <op> builtinCall(x)
      const npRight = this.getNullPropagatingArg(binaryExpr.right);
      if (npRight && binaryExpr.left.type === 'Literal') {
        const argVarName = this.getArgVariableName(npRight.arg);
        if (argVarName === variableName) {
          const literalValue = (binaryExpr.left as any).value;
          if (this.comparisonExcludesNull(binaryExpr.operator, literalValue, false)) {
            return { variableName, narrowToType: UcodeType.NULL, isNegative: true };
          }
        }
      }
    }

    return null;
  }

  /**
   * Recursively collect all type guards in an OR chain
   */
  private collectOrGuards(condition: AstNode, variableName: string): TypeGuardInfo[] {
    const guards: TypeGuardInfo[] = [];

    if (condition.type === 'BinaryExpression') {
      const binaryExpr = condition as BinaryExpressionNode;

      if (binaryExpr.operator === '||') {
        // Recursively collect from both sides
        guards.push(...this.collectOrGuards(binaryExpr.left, variableName));
        guards.push(...this.collectOrGuards(binaryExpr.right, variableName));
        return guards;
      }
    }

    // Not an OR - try to extract a single guard
    const guard = this.extractSingleTypeGuard(condition, variableName);
    if (guard) {
      guards.push(guard);
    }

    return guards;
  }

  /**
   * Extract a single type guard (not handling OR)
   */
  private extractSingleTypeGuard(condition: AstNode, variableName: string): TypeGuardInfo | null {
    // Check for type() == 'typename' pattern
    const typeGuardType = this.extractTypeCallGuard(condition, variableName);
    if (typeGuardType) {
      return {
        variableName,
        narrowToType: typeGuardType,
        isNegative: false
      };
    }

    // Check for type() !== 'typename' pattern (negative guard)
    const negativeTypeGuard = this.extractNegativeTypeCallGuard(condition, variableName);
    if (negativeTypeGuard) {
      return {
        variableName,
        narrowToType: negativeTypeGuard,
        isNegative: true
      };
    }

    // Check for a != null or null != a
    if (this.isNullGuardCondition(condition, variableName)) {
      return {
        variableName,
        narrowToType: UcodeType.NULL,
        isNegative: true
      };
    }

    // Check for a == null or null == a
    if (this.isNullCheckCondition(condition, variableName)) {
      return {
        variableName,
        narrowToType: UcodeType.NULL,
        isNegative: false
      };
    }

    return null;
  }

  /**
   * Extract type from type(variable) == 'typename' pattern
   */
  private extractTypeCallGuard(condition: AstNode, variableName: string): UcodeType | null {
    if (condition.type !== 'BinaryExpression') {
      return null;
    }

    const binaryExpr = condition as BinaryExpressionNode;

    // Check for type(a) == 'typename' or 'typename' == type(a)
    if (binaryExpr.operator !== '==' && binaryExpr.operator !== '===') {
      return null;
    }

    let typeCall: CallExpressionNode | null = null;
    let typeLiteral: any = null;

    // Check left side for type() call, right side for string literal
    if (binaryExpr.left.type === 'CallExpression' &&
        binaryExpr.right.type === 'Literal') {
      typeCall = binaryExpr.left as CallExpressionNode;
      typeLiteral = binaryExpr.right;
    }
    // Check right side for type() call, left side for string literal
    else if (binaryExpr.right.type === 'CallExpression' &&
             binaryExpr.left.type === 'Literal') {
      typeCall = binaryExpr.right as CallExpressionNode;
      typeLiteral = binaryExpr.left;
    }

    if (!typeCall || !typeLiteral) {
      return null;
    }

    // Verify it's a call to type() function
    if (typeCall.callee.type !== 'Identifier' ||
        (typeCall.callee as IdentifierNode).name !== 'type') {
      return null;
    }

    // Verify it has one argument and it's our variable
    if (typeCall.arguments.length !== 1 ||
        !typeCall.arguments[0] ||
        typeCall.arguments[0].type !== 'Identifier' ||
        (typeCall.arguments[0] as IdentifierNode).name !== variableName) {
      return null;
    }

    // Map type string to UcodeType
    const typeStr = typeLiteral.value;
    switch (typeStr) {
      case 'object':
        return UcodeType.OBJECT;
      case 'array':
        return UcodeType.ARRAY;
      case 'string':
        return UcodeType.STRING;
      case 'int':
        return UcodeType.INTEGER;
      case 'double':
        return UcodeType.DOUBLE;
      case 'bool':
        return UcodeType.BOOLEAN;
      case 'function':
        return UcodeType.FUNCTION;
      default:
        return null;
    }
  }

  /**
   * Extract type from type(variable) !== 'typename' pattern (negative guard)
   */
  private extractNegativeTypeCallGuard(condition: AstNode, variableName: string): UcodeType | null {
    if (condition.type !== 'BinaryExpression') {
      return null;
    }

    const binaryExpr = condition as BinaryExpressionNode;

    // Check for type(a) !== 'typename' or 'typename' !== type(a)
    if (binaryExpr.operator !== '!=' && binaryExpr.operator !== '!==') {
      return null;
    }

    let typeCall: CallExpressionNode | null = null;
    let typeLiteral: any = null;

    // Check left side for type() call, right side for string literal
    if (binaryExpr.left.type === 'CallExpression' &&
        binaryExpr.right.type === 'Literal') {
      typeCall = binaryExpr.left as CallExpressionNode;
      typeLiteral = binaryExpr.right;
    }
    // Check right side for type() call, left side for string literal
    else if (binaryExpr.right.type === 'CallExpression' &&
             binaryExpr.left.type === 'Literal') {
      typeCall = binaryExpr.right as CallExpressionNode;
      typeLiteral = binaryExpr.left;
    }

    if (!typeCall || !typeLiteral) {
      return null;
    }

    // Verify it's a call to type() function
    if (typeCall.callee.type !== 'Identifier' ||
        (typeCall.callee as IdentifierNode).name !== 'type') {
      return null;
    }

    // Verify it has one argument and it's our variable
    if (typeCall.arguments.length !== 1 ||
        !typeCall.arguments[0] ||
        typeCall.arguments[0].type !== 'Identifier' ||
        (typeCall.arguments[0] as IdentifierNode).name !== variableName) {
      return null;
    }

    // Map type string to UcodeType
    const typeStr = typeLiteral.value;
    switch (typeStr) {
      case 'object':
        return UcodeType.OBJECT;
      case 'array':
        return UcodeType.ARRAY;
      case 'string':
        return UcodeType.STRING;
      case 'int':
        return UcodeType.INTEGER;
      case 'double':
        return UcodeType.DOUBLE;
      case 'bool':
        return UcodeType.BOOLEAN;
      case 'function':
        return UcodeType.FUNCTION;
      default:
        return null;
    }
  }

  /**
   * Get child nodes of an AST node for traversal
   */
  private getChildNodes(node: AstNode): AstNode[] {
    const children: AstNode[] = [];

    switch (node.type) {
      case 'Program':
        children.push(...(node as ProgramNode).body);
        break;
      case 'BlockStatement':
        children.push(...(node as BlockStatementNode).body);
        break;
      case 'ExportDefaultDeclaration':
        const exportNode = node as ExportDefaultDeclarationNode;
        if (exportNode.declaration) {
          children.push(exportNode.declaration);
        }
        break;
      case 'IfStatement':
        const ifNode = node as IfStatementNode;
        children.push(ifNode.test);
        children.push(ifNode.consequent);
        if (ifNode.alternate) children.push(ifNode.alternate);
        break;
      case 'ExpressionStatement':
        children.push((node as ExpressionStatementNode).expression);
        break;
      case 'ReturnStatement':
        const returnNode = node as ReturnStatementNode;
        if (returnNode.argument) {
          children.push(returnNode.argument);
        }
        break;
      case 'BinaryExpression':
        const binaryNode = node as BinaryExpressionNode;
        children.push(binaryNode.left, binaryNode.right);
        break;
      case 'VariableDeclaration':
        const varDeclNode = node as VariableDeclarationNode;
        // Variable declarations contain declarators, each with optional init expressions
        for (const declarator of varDeclNode.declarations) {
          if (declarator.init) {
            children.push(declarator.init);
          }
        }
        break;
      case 'ObjectExpression':
        const objNode = node as ObjectExpressionNode;
        // Object literals contain properties with values
        for (const prop of objNode.properties) {
          children.push(prop);
        }
        break;
      case 'Property':
        const propNode = node as PropertyNode;
        if (propNode.value) {
          children.push(propNode.value);
        }
        break;
      case 'ArrayExpression':
        const arrayNode = node as ArrayExpressionNode;
        // Array literals contain element expressions
        children.push(...arrayNode.elements.filter(el => el != null));
        break;
      case 'FunctionDeclaration':
        const funcNode = node as FunctionDeclarationNode;
        children.push(funcNode.id, ...funcNode.params, funcNode.body);
        break;
      case 'FunctionExpression':
        const funcExpr = node as FunctionExpressionNode;
        if (funcExpr.id) {
          children.push(funcExpr.id);
        }
        children.push(...funcExpr.params);
        children.push(funcExpr.body);
        break;
      case 'WhileStatement':
        const whileNode = node as any;
        children.push(whileNode.test, whileNode.body);
        break;
      case 'ForStatement':
        const forNode = node as any;
        if (forNode.init) children.push(forNode.init);
        if (forNode.test) children.push(forNode.test);
        if (forNode.update) children.push(forNode.update);
        children.push(forNode.body);
        break;
      case 'ArrowFunctionExpression':
        const arrowNode = node as ArrowFunctionExpressionNode;
        children.push(...arrowNode.params);
        if (arrowNode.body && typeof arrowNode.body === 'object') {
          children.push(arrowNode.body as AstNode);
        }
        break;
      case 'VariableDeclarator':
        const declaratorNode = node as VariableDeclaratorNode;
        if (declaratorNode.init) {
          children.push(declaratorNode.init);
        }
        break;
      case 'CallExpression':
        const callNode = node as CallExpressionNode;
        children.push(callNode.callee);
        children.push(...callNode.arguments.filter(arg => arg != null));
        break;
      case 'AssignmentExpression':
        const assignNode = node as any;
        children.push(assignNode.left, assignNode.right);
        break;
      case 'SwitchStatement':
        const switchNode = node as any;
        children.push(switchNode.discriminant);
        if (switchNode.cases) {
          for (const caseNode of switchNode.cases) {
            if (caseNode.test) children.push(caseNode.test);
            children.push(...caseNode.consequent);
          }
        }
        break;
      // Add more node types as needed
    }

    return children.filter(child => child != null);
  }

  private pushGuardContext(variableName: string, narrowedType: UcodeDataType, startPos: number, endPos: number): void {
    this.guardContextStack.push({ variableName, narrowedType, startPos, endPos });
  }

  private popGuardContext(): void {
    this.guardContextStack.pop();
  }

  private getActiveGuardType(variableName: string, position: number): UcodeDataType | null {
    // Look through guard contexts from most recent to oldest
    for (let i = this.guardContextStack.length - 1; i >= 0; i--) {
      const guard = this.guardContextStack[i];
      if (guard && guard.variableName === variableName &&
          position >= guard.startPos &&
          position <= guard.endPos) {
        return guard.narrowedType;
      }
    }
    return null;
  }

}
