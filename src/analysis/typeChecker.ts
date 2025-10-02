/**
 * Main Type Checker for ucode semantic analysis
 * Handles type inference and type checking
 */

import {
  AstNode, LiteralNode, IdentifierNode, BinaryExpressionNode, UnaryExpressionNode,
  CallExpressionNode, MemberExpressionNode, AssignmentExpressionNode, ArrayExpressionNode,
  ObjectExpressionNode, ConditionalExpressionNode, ArrowFunctionExpressionNode,
  FunctionExpressionNode, IfStatementNode, ProgramNode, BlockStatementNode,
  ExpressionStatementNode, FunctionDeclarationNode, VariableDeclarationNode
} from '../ast/nodes';

/**
 * Represents a type guard that narrows a variable's type
 */
interface TypeGuardInfo {
  variableName: string;
  // The narrowed type - if null, means "remove null from type"
  // If specified, means "narrow to exactly this type"
  narrowToType: UcodeType | null;
  // Whether this is a negative narrowing (e.g., in else block)
  isNegative: boolean;
}
import { SymbolTable, SymbolType, UcodeType, UcodeDataType, isUnionType, getUnionTypes, createUnionType, Symbol as UcodeSymbol } from './symbolTable';
import { logicalTypeInference } from './logicalTypeInference';
import { arithmeticTypeInference } from './arithmeticTypeInference';
import { BuiltinValidator, TypeCompatibilityChecker } from './checkers';
import { allBuiltinFunctions } from '../builtins';
import { fsTypeRegistry } from './fsTypes';
import { fsModuleTypeRegistry } from './fsModuleTypes';
import { uloopObjectRegistry } from './uloopTypes';
import { rtnlTypeRegistry } from './rtnlTypes';
import { nl80211TypeRegistry } from './nl80211Types';
import { TypeNarrowingEngine } from './typeNarrowing';
import { FlowSensitiveTypeTracker } from './flowSensitiveTyping';

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
}

export class TypeChecker {
  private symbolTable: SymbolTable;
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

  constructor(symbolTable: SymbolTable) {
    this.symbolTable = symbolTable;
    this.builtinFunctions = new Map();
    this.builtinValidator = new BuiltinValidator();
    this.typeCompatibility = new TypeCompatibilityChecker();
    this.typeNarrowing = new TypeNarrowingEngine();
    this.flowSensitiveTracker = new FlowSensitiveTypeTracker(symbolTable);

    // Inject type checker into builtin validator
    // Use a method that returns the full type description including unions
    this.builtinValidator.setTypeChecker(this.getNodeTypeDescription.bind(this));

    this.initializeBuiltins();
  }

  private initializeBuiltins(): void {
    const builtins: FunctionSignature[] = [
      { name: 'print', parameters: [], returnType: UcodeType.INTEGER, variadic: true },
      { name: 'printf', parameters: [UcodeType.STRING], returnType: UcodeType.INTEGER, variadic: true },
      { name: 'sprintf', parameters: [UcodeType.STRING], returnType: UcodeType.STRING, variadic: true },
      { name: 'length', parameters: [UcodeType.UNKNOWN], returnType: UcodeType.INTEGER },
      { name: 'substr', parameters: [UcodeType.STRING, UcodeType.INTEGER], returnType: UcodeType.STRING, minParams: 2, maxParams: 3 },
      { name: 'split', parameters: [UcodeType.STRING, UcodeType.STRING], returnType: UcodeType.ARRAY, minParams: 2, maxParams: 3 },
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
      { name: 'push', parameters: [UcodeType.ARRAY], returnType: UcodeType.INTEGER, variadic: true },
      { name: 'pop', parameters: [UcodeType.ARRAY], returnType: UcodeType.UNKNOWN },
      { name: 'shift', parameters: [UcodeType.ARRAY], returnType: UcodeType.UNKNOWN },
      { name: 'unshift', parameters: [UcodeType.ARRAY], returnType: UcodeType.INTEGER, variadic: true },
      { name: 'filter', parameters: [UcodeType.ARRAY, UcodeType.FUNCTION], returnType: UcodeType.ARRAY },
      { name: 'index', parameters: [UcodeType.UNKNOWN, UcodeType.UNKNOWN], returnType: UcodeType.INTEGER },
      { name: 'rindex', parameters: [UcodeType.STRING, UcodeType.UNKNOWN], returnType: UcodeType.INTEGER },
      { name: 'require', parameters: [UcodeType.STRING], returnType: UcodeType.UNKNOWN },
      { name: 'include', parameters: [UcodeType.STRING], returnType: UcodeType.UNKNOWN },
      { name: 'json', parameters: [UcodeType.UNKNOWN], returnType: UcodeType.UNKNOWN },
      { name: 'match', parameters: [UcodeType.STRING, UcodeType.STRING], returnType: UcodeType.ARRAY },
      { name: 'replace', parameters: [UcodeType.STRING, UcodeType.STRING, UcodeType.STRING], returnType: UcodeType.STRING },
      { name: 'system', parameters: [UcodeType.UNKNOWN], returnType: UcodeType.INTEGER, minParams: 1, maxParams: 2 },
      { name: 'time', parameters: [], returnType: UcodeType.INTEGER },
      { name: 'sleep', parameters: [UcodeType.INTEGER], returnType: UcodeType.NULL },
      { name: 'localtime', parameters: [], returnType: UcodeType.OBJECT, minParams: 0, maxParams: 1 },
      { name: 'gmtime', parameters: [], returnType: UcodeType.OBJECT, minParams: 0, maxParams: 1 },
      { name: 'timelocal', parameters: [UcodeType.OBJECT], returnType: UcodeType.INTEGER },
      { name: 'timegm', parameters: [UcodeType.OBJECT], returnType: UcodeType.INTEGER },
      { name: 'min', parameters: [], returnType: UcodeType.INTEGER, variadic: true },
      { name: 'max', parameters: [], returnType: UcodeType.INTEGER, variadic: true },
      { name: 'uniq', parameters: [UcodeType.ARRAY], returnType: UcodeType.ARRAY },
      { name: 'b64enc', parameters: [UcodeType.STRING], returnType: UcodeType.STRING },
      { name: 'b64dec', parameters: [UcodeType.STRING], returnType: UcodeType.STRING },
      { name: 'hexenc', parameters: [UcodeType.STRING], returnType: UcodeType.STRING },
      { name: 'hexdec', parameters: [UcodeType.STRING, UcodeType.STRING], returnType: UcodeType.STRING, minParams: 1, maxParams: 2 },
      { name: 'hex', parameters: [UcodeType.INTEGER], returnType: UcodeType.STRING },
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
      { name: 'warn', parameters: [], returnType: UcodeType.NULL, variadic: true },
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
      { name: 'rand', parameters: [], returnType: UcodeType.INTEGER },
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
      (node as any)._fullType = dataType;
      
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

      case '&&':
      case '||':
        // Use accurate logical operator type inference based on runtime behavior
        let logicalResultType: UcodeDataType;
        
        if (node.operator === '||') {
          logicalResultType = logicalTypeInference.inferLogicalOrType(leftType, rightType);
        } else {
          logicalResultType = logicalTypeInference.inferLogicalAndType(leftType, rightType);
        }
        
        // Convert union type back to UcodeType for backward compatibility
        // The actual union type information is preserved in symbol table operations
        if (isUnionType(logicalResultType)) {
          return UcodeType.UNKNOWN;
        }
        
        return logicalResultType as UcodeType;

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
    const rightTypeData = this.getFullTypeFromNode(node.right) || this.getTypeAsDataType(rightType);

    // Check for flow-sensitive narrowing using direct AST analysis
    if (node.right.type === 'Identifier') {
      const variableName = (node.right as IdentifierNode).name;

      // Check if we're inside any type guard for this variable
      // Use the position of the variable itself (node.right.start), not the start of the 'in' expression
      const guardInfo = this.findContainingGuard(this.currentAST, variableName, node.right.start);
      if (guardInfo) {
        // Apply the guard to get the narrowed type
        const narrowedType = this.applyTypeGuard(rightTypeData, guardInfo);

        // Re-check compatibility with narrowed type
        if (this.typeNarrowing.isSubtype(narrowedType, UcodeType.OBJECT) ||
            this.typeNarrowing.isSubtype(narrowedType, UcodeType.ARRAY)) {
          // The narrowed type is compatible, no error needed
          return UcodeType.BOOLEAN;
        }
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
    // Extract full type information stored during identifier checking
    return (node as any)._fullType || null;
  }

  private getTypeDescription(type: UcodeDataType): string {
    if (isUnionType(type)) {
      const types = getUnionTypes(type);
      return types.join(' | ');
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

      // Check for flow-sensitive narrowing using findContainingGuard
      const guardInfo = this.findContainingGuard(this.currentAST, variableName, node.start);
      if (guardInfo) {
        // Get the base type and apply the guard
        const fullType = this.getFullTypeFromNode(node);
        if (fullType) {
          const narrowedType = this.applyTypeGuard(fullType, guardInfo);
          return this.getTypeDescription(narrowedType) as UcodeType;
        }
      }
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
      const symbol = this.symbolTable.lookup(funcName);
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
              // For variables with unknown type (like arrow functions), assume they might be callable
              // This prevents false positives for arrow functions assigned to variables
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
      // Member expression calls are handled like regular calls
      const calleeType = this.checkNode(node.callee);
      if (calleeType !== UcodeType.UNKNOWN) {
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
      const actualTypeData = this.getFullTypeFromNode(arg) || this.getTypeAsDataType(actualType);
      
      if (expectedType !== UcodeType.UNKNOWN && !this.typeNarrowing.isSubtype(actualTypeData, expectedType)) {
        const incompatibilityDesc = this.typeNarrowing.getIncompatibilityDescription(actualTypeData, expectedType);
        if (incompatibilityDesc) {
          this.errors.push({
            message: `Function '${signature.name}': ${incompatibilityDesc}. Use a guard or assertion.`,
            start: arg.start,
            end: arg.end,
            severity: 'error',
            code: 'incompatible-function-argument',
            data: {
              functionName: signature.name,
              argumentIndex: i,
              expectedType: expectedType as string,
              actualType: actualTypeData,
              variableName: this.getVariableName(arg)
            }
          });
        } else {
          // Fallback to original error for edge cases
          this.errors.push({
            message: `Function '${signature.name}' expects ${expectedType} for argument ${i + 1}, got ${this.getTypeDescription(actualTypeData)}`,
            start: arg.start,
            end: arg.end,
            severity: 'error'
          });
        }
      }
    }

    return this.dataTypeToUcodeType(signature.returnType);
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

      // Check if this is an fs object with a specific type
      const fsType = fsTypeRegistry.isVariableOfFsType(symbol.dataType);
      if (fsType && !node.computed) {
        const methodName = (node.property as IdentifierNode).name;
        const method = fsTypeRegistry.getFsMethod(fsType, methodName);
        if (method) {
          return method.returnType;
        }
        // Method not found on fs type
        this.errors.push({
          message: `Method '${methodName}' does not exist on ${fsType}`,
          start: node.start,
          end: node.end,
          severity: 'error'
        });
        return UcodeType.UNKNOWN;
      }

      // Check if this is a uloop object with a specific type
      const uloopType = uloopObjectRegistry.isVariableOfUloopType(symbol.dataType);
      if (uloopType && !node.computed) {
        const methodName = (node.property as IdentifierNode).name;
        const method = uloopObjectRegistry.getUloopMethod(uloopType, methodName);
        if (method) {
          // Convert return type string to UcodeType
          switch (method.returnType) {
            case 'integer':
              return UcodeType.INTEGER;
            case 'string | null':
            case 'string':
              return UcodeType.STRING;
            case 'boolean | null':
            case 'boolean':
              return UcodeType.BOOLEAN;
            case 'null':
              return UcodeType.NULL;
            case 'fs.file | fs.proc | socket.socket':
              return UcodeType.OBJECT;
            default:
              return UcodeType.UNKNOWN;
          }
        }
        // Method not found on uloop type
        this.errors.push({
          message: `Method '${methodName}' does not exist on ${uloopType}`,
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
    
    // Basic type compatibility check
    if (node.operator === '=' && leftType !== UcodeType.UNKNOWN && rightType !== UcodeType.UNKNOWN) {
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
    
    return resultType as UcodeType;
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
  }

  /**
   * Public method to get the narrowed type for a variable at a specific position
   * Used by hover functionality to show flow-sensitive types
   */
  getNarrowedTypeAtPosition(variableName: string, position: number): UcodeDataType | null {
    // Get the base type from the symbol table
    const symbol = this.symbolTable.lookup(variableName);
    if (!symbol) {
      return null;
    }

    const baseType = symbol.dataType;

    // Check if this position is inside a type guard
    const guardInfo = this.findContainingGuard(this.currentAST, variableName, position);
    if (guardInfo) {
      return this.applyTypeGuard(baseType, guardInfo);
    }

    return null; // No narrowing applies
  }

  /**
   * Apply a type guard to narrow a type
   */
  private applyTypeGuard(baseType: UcodeDataType, guard: TypeGuardInfo): UcodeDataType {
    if (guard.narrowToType === null) {
      // Null guard - remove null from type
      if (guard.isNegative) {
        // In else block of (a == null), variable is non-null
        const narrowingResult = this.typeNarrowing.removeNullFromType(baseType);
        return narrowingResult.narrowedType;
      } else {
        // In then block of (a != null), variable is non-null
        const narrowingResult = this.typeNarrowing.removeNullFromType(baseType);
        return narrowingResult.narrowedType;
      }
    } else {
      // Type guard - narrow to specific type
      return guard.narrowToType;
    }
  }

  /**
   * Find the type guard that applies to this position
   */
  private findContainingGuard(ast: AstNode | null, variableName: string, position: number): TypeGuardInfo | null {
    if (!ast) {
      return null;
    }

    return this.findGuardInNode(ast, variableName, position);
  }


  /**
   * Recursively search for if statements and logical AND expressions that narrow types
   */
  private findGuardInNode(node: AstNode, variableName: string, position: number): TypeGuardInfo | null {
    // First check if this node itself provides narrowing for the position

    // Check if this is a logical AND expression (guard && ...)
    // Do this FIRST before recursing, so we can catch the pattern before diving into children
    if (node.type === 'BinaryExpression') {
      const binaryNode = node as BinaryExpressionNode;

      if (binaryNode.operator === '&&') {
        // Check if the position is in the right side of the AND
        if (position >= binaryNode.right.start && position <= binaryNode.right.end) {
          // Check if the left side (or any part of it) contains a guard for our variable
          const guardInfo = this.findGuardInCondition(binaryNode.left, variableName);
          if (guardInfo) {
            return guardInfo;
          }
        }
      }
    }

    // Check if this is an if statement
    if (node.type === 'IfStatement') {
      const ifNode = node as IfStatementNode;

      // Check if the position is within the consequent (then block) - positive narrowing
      if (ifNode.consequent &&
          position >= ifNode.consequent.start &&
          position <= ifNode.consequent.end) {

        // Extract guard from the condition
        const guardInfo = this.extractTypeGuard(ifNode.test, variableName);
        if (guardInfo) {
          return guardInfo;
        }
      }

      // Check if the position is within the alternate (else block) - negative narrowing
      if (ifNode.alternate &&
          position >= ifNode.alternate.start &&
          position <= ifNode.alternate.end) {

        // Extract guard from the condition and invert it
        const guardInfo = this.extractTypeGuard(ifNode.test, variableName);
        if (guardInfo) {
          // Invert the guard for else block
          return {
            ...guardInfo,
            isNegative: !guardInfo.isNegative
          };
        }
      }
    }

    // Recursively check child nodes
    const children = this.getChildNodes(node);
    for (const child of children) {
      if (position >= child.start && position <= child.end) {
        const guardInfo = this.findGuardInNode(child, variableName, position);
        if (guardInfo) {
          return guardInfo;
        }
      }
    }

    return null;
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
  private extractTypeGuard(condition: AstNode, variableName: string): TypeGuardInfo | null {
    // Check for type() == 'typename' pattern
    const typeGuardType = this.extractTypeCallGuard(condition, variableName);
    if (typeGuardType) {
      return {
        variableName,
        narrowToType: typeGuardType,
        isNegative: false
      };
    }

    // Check for a != null or null != a
    if (this.isNullGuardCondition(condition, variableName)) {
      return {
        variableName,
        narrowToType: null, // null means "remove null"
        isNegative: false
      };
    }

    // Check for a == null or null == a (for negative narrowing)
    if (this.isNullCheckCondition(condition, variableName)) {
      return {
        variableName,
        narrowToType: null,
        isNegative: true // In else block, this narrows to non-null
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
      case 'IfStatement':
        const ifNode = node as IfStatementNode;
        children.push(ifNode.test);
        children.push(ifNode.consequent);
        if (ifNode.alternate) children.push(ifNode.alternate);
        break;
      case 'ExpressionStatement':
        children.push((node as ExpressionStatementNode).expression);
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
          if (prop.value) {
            children.push(prop.value);
          }
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
