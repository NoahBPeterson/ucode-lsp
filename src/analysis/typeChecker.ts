/**
 * Main Type Checker for ucode semantic analysis
 * Handles type inference and type checking
 */

import { 
  AstNode, LiteralNode, IdentifierNode, BinaryExpressionNode, UnaryExpressionNode,
  CallExpressionNode, MemberExpressionNode, AssignmentExpressionNode, ArrayExpressionNode,
  ObjectExpressionNode, ConditionalExpressionNode, ArrowFunctionExpressionNode, 
  FunctionExpressionNode
} from '../ast/nodes';
import { SymbolTable, SymbolType, UcodeType, UcodeDataType, isUnionType, getUnionTypes } from './symbolTable';
import { BuiltinValidator, TypeCompatibilityChecker } from './checkers';
import { allBuiltinFunctions } from '../builtins';
import { fsTypeRegistry } from './fsTypes';

export interface FunctionSignature {
  name: string;
  parameters: UcodeType[];
  returnType: UcodeType;
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

  constructor(symbolTable: SymbolTable) {
    this.symbolTable = symbolTable;
    this.builtinFunctions = new Map();
    this.builtinValidator = new BuiltinValidator();
    this.typeCompatibility = new TypeCompatibilityChecker();
    
    // Inject type checker into builtin validator
    this.builtinValidator.setTypeChecker(this.checkNode.bind(this));
    
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
      { name: 'trim', parameters: [UcodeType.STRING], returnType: UcodeType.STRING },
      { name: 'ltrim', parameters: [UcodeType.STRING], returnType: UcodeType.STRING },
      { name: 'rtrim', parameters: [UcodeType.STRING], returnType: UcodeType.STRING },
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
      { name: 'index', parameters: [UcodeType.UNKNOWN, UcodeType.UNKNOWN], returnType: UcodeType.INTEGER },
      { name: 'rindex', parameters: [UcodeType.STRING, UcodeType.UNKNOWN], returnType: UcodeType.INTEGER },
      { name: 'require', parameters: [UcodeType.STRING], returnType: UcodeType.UNKNOWN },
      { name: 'include', parameters: [UcodeType.STRING], returnType: UcodeType.UNKNOWN },
      { name: 'json', parameters: [UcodeType.UNKNOWN], returnType: UcodeType.UNKNOWN },
      { name: 'match', parameters: [UcodeType.STRING, UcodeType.STRING], returnType: UcodeType.ARRAY },
      { name: 'replace', parameters: [UcodeType.STRING, UcodeType.STRING, UcodeType.STRING], returnType: UcodeType.STRING },
      { name: 'system', parameters: [UcodeType.STRING], returnType: UcodeType.INTEGER },
      { name: 'time', parameters: [], returnType: UcodeType.INTEGER },
      { name: 'sleep', parameters: [UcodeType.INTEGER], returnType: UcodeType.NULL },
      { name: 'localtime', parameters: [], returnType: UcodeType.ARRAY, minParams: 0, maxParams: 1 },
      { name: 'gmtime', parameters: [], returnType: UcodeType.ARRAY, minParams: 0, maxParams: 1 },
      { name: 'timelocal', parameters: [UcodeType.ARRAY], returnType: UcodeType.INTEGER },
      { name: 'timegm', parameters: [UcodeType.ARRAY], returnType: UcodeType.INTEGER },
      { name: 'min', parameters: [], returnType: UcodeType.INTEGER, variadic: true },
      { name: 'max', parameters: [], returnType: UcodeType.INTEGER, variadic: true },
      { name: 'uniq', parameters: [UcodeType.ARRAY], returnType: UcodeType.ARRAY },
      { name: 'b64enc', parameters: [UcodeType.STRING], returnType: UcodeType.STRING },
      { name: 'b64dec', parameters: [UcodeType.STRING], returnType: UcodeType.STRING },
      { name: 'hexenc', parameters: [UcodeType.STRING], returnType: UcodeType.STRING },
      { name: 'hexdec', parameters: [UcodeType.STRING], returnType: UcodeType.STRING },
      { name: 'hex', parameters: [UcodeType.INTEGER], returnType: UcodeType.STRING },
      { name: 'uchr', parameters: [UcodeType.INTEGER], returnType: UcodeType.STRING },
      { name: 'iptoarr', parameters: [UcodeType.STRING], returnType: UcodeType.ARRAY },
      { name: 'arrtoip', parameters: [UcodeType.ARRAY], returnType: UcodeType.STRING },
      { name: 'int', parameters: [UcodeType.UNKNOWN], returnType: UcodeType.INTEGER },
      { name: 'loadstring', parameters: [UcodeType.STRING], returnType: UcodeType.FUNCTION },
      { name: 'loadfile', parameters: [UcodeType.STRING], returnType: UcodeType.FUNCTION },
      { name: 'wildcard', parameters: [UcodeType.STRING, UcodeType.STRING], returnType: UcodeType.BOOLEAN },
      { name: 'regexp', parameters: [UcodeType.STRING], returnType: UcodeType.OBJECT, minParams: 1, maxParams: 2 },
      { name: 'assert', parameters: [UcodeType.UNKNOWN], returnType: UcodeType.UNKNOWN, minParams: 1, maxParams: 2 },
      { name: 'call', parameters: [UcodeType.FUNCTION], returnType: UcodeType.UNKNOWN, variadic: true },
      { name: 'signal', parameters: [UcodeType.INTEGER], returnType: UcodeType.UNKNOWN, minParams: 1, maxParams: 2 },
      { name: 'clock', parameters: [], returnType: UcodeType.DOUBLE },
      { name: 'sourcepath', parameters: [], returnType: UcodeType.STRING },
      { name: 'gc', parameters: [], returnType: UcodeType.NULL },
      
      // File System builtin functions (from fs.c global_fns[])
      { name: 'error', parameters: [], returnType: UcodeType.STRING },
      { name: 'open', parameters: [UcodeType.STRING, UcodeType.STRING], returnType: UcodeType.OBJECT, minParams: 2, maxParams: 3 },
      { name: 'fdopen', parameters: [UcodeType.INTEGER, UcodeType.STRING], returnType: UcodeType.OBJECT },
      { name: 'opendir', parameters: [UcodeType.STRING], returnType: UcodeType.OBJECT },
      { name: 'popen', parameters: [UcodeType.STRING, UcodeType.STRING], returnType: UcodeType.OBJECT },
      { name: 'readlink', parameters: [UcodeType.STRING], returnType: UcodeType.STRING },
      { name: 'stat', parameters: [UcodeType.STRING], returnType: UcodeType.OBJECT },
      { name: 'lstat', parameters: [UcodeType.STRING], returnType: UcodeType.OBJECT },
      { name: 'mkdir', parameters: [UcodeType.STRING], returnType: UcodeType.BOOLEAN, minParams: 1, maxParams: 2 },
      { name: 'rmdir', parameters: [UcodeType.STRING], returnType: UcodeType.BOOLEAN },
      { name: 'symlink', parameters: [UcodeType.STRING, UcodeType.STRING], returnType: UcodeType.BOOLEAN },
      { name: 'unlink', parameters: [UcodeType.STRING], returnType: UcodeType.BOOLEAN },
      { name: 'getcwd', parameters: [], returnType: UcodeType.STRING },
      { name: 'chdir', parameters: [UcodeType.STRING], returnType: UcodeType.BOOLEAN },
      { name: 'chmod', parameters: [UcodeType.STRING, UcodeType.INTEGER], returnType: UcodeType.BOOLEAN },
      { name: 'chown', parameters: [UcodeType.STRING, UcodeType.INTEGER, UcodeType.INTEGER], returnType: UcodeType.BOOLEAN },
      { name: 'rename', parameters: [UcodeType.STRING, UcodeType.STRING], returnType: UcodeType.BOOLEAN },
      { name: 'glob', parameters: [UcodeType.STRING], returnType: UcodeType.ARRAY },
      { name: 'dirname', parameters: [UcodeType.STRING], returnType: UcodeType.STRING },
      { name: 'basename', parameters: [UcodeType.STRING], returnType: UcodeType.STRING },
      { name: 'lsdir', parameters: [UcodeType.STRING], returnType: UcodeType.ARRAY },
      { name: 'mkstemp', parameters: [UcodeType.STRING], returnType: UcodeType.OBJECT },
      { name: 'access', parameters: [UcodeType.STRING, UcodeType.STRING], returnType: UcodeType.BOOLEAN },
      { name: 'readfile', parameters: [UcodeType.STRING], returnType: UcodeType.STRING },
      { name: 'writefile', parameters: [UcodeType.STRING, UcodeType.STRING], returnType: UcodeType.INTEGER },
      { name: 'realpath', parameters: [UcodeType.STRING], returnType: UcodeType.STRING },
      { name: 'pipe', parameters: [], returnType: UcodeType.ARRAY }
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
      default:
        return UcodeType.UNKNOWN;
    }
  }

  getResult(): TypeCheckResult {
    // Collect errors from builtin validator
    const builtinErrors = this.builtinValidator.getErrors();
    
    return {
      type: UcodeType.UNKNOWN,
      errors: [...this.errors, ...builtinErrors],
      warnings: this.warnings
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
        return UcodeType.OBJECT; // Regex literals are objects in ucode
      default:
        return UcodeType.UNKNOWN;
    }
  }

  private checkIdentifier(node: IdentifierNode): UcodeType {
    const symbol = this.symbolTable.lookup(node.name);
    if (symbol) {
      this.symbolTable.markUsed(node.name, node.start);
      // Convert UcodeDataType to UcodeType for backwards compatibility
      if (typeof symbol.dataType === 'string') {
        return symbol.dataType as UcodeType;
      } else if (isUnionType(symbol.dataType)) {
        // For union types, return the first type or UNKNOWN
        const types = getUnionTypes(symbol.dataType);
        return types[0] || UcodeType.UNKNOWN;
      } else {
        // For other complex types like ModuleType, return OBJECT
        return UcodeType.OBJECT;
      }
    } else {
      // Check if it's a builtin function before reporting as undefined
      const isBuiltin = allBuiltinFunctions.has(node.name);
      if (!isBuiltin) {
        this.errors.push({
          message: `Undefined variable: ${node.name}`,
          start: node.start,
          end: node.end,
          severity: 'error'
        });
      }
      // Return FUNCTION type for builtin functions, UNKNOWN for truly undefined variables
      return isBuiltin ? UcodeType.FUNCTION : UcodeType.UNKNOWN;
    }
  }

  private checkBinaryExpression(node: BinaryExpressionNode): UcodeType {
    const leftType = this.checkNode(node.left);
    const rightType = this.checkNode(node.right);

    // Type checking for binary operators
    switch (node.operator) {
      case '+':
        if (this.typeCompatibility.canAddTypes(leftType, rightType)) {
          return this.typeCompatibility.getArithmeticResultType(leftType, rightType, '+');
        }
        this.errors.push({
          message: `Cannot add ${leftType} and ${rightType}`,
          start: node.start,
          end: node.end,
          severity: 'error'
        });
        return UcodeType.UNKNOWN;

      case '-':
      case '*':
      case '/':
      case '%':
        if (!this.typeCompatibility.canPerformArithmetic(leftType, rightType)) {
          this.errors.push({
            message: `Cannot perform ${node.operator} on ${leftType} and ${rightType}`,
            start: node.start,
            end: node.end,
            severity: 'error'
          });
          return UcodeType.UNKNOWN;
        }
        return this.typeCompatibility.getArithmeticResultType(leftType, rightType, node.operator);

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
        return this.typeCompatibility.getLogicalResultType();

      case '&':
      case '|':
      case '^':
      case '<<':
      case '>>':
        if (!this.typeCompatibility.canPerformBitwiseOp(leftType, rightType)) {
          this.errors.push({
            message: `Bitwise operations require integers, got ${leftType} and ${rightType}`,
            start: node.start,
            end: node.end,
            severity: 'error'
          });
          return UcodeType.UNKNOWN;
        }
        return this.typeCompatibility.getBitwiseResultType();

      case 'in':
        if (!this.typeCompatibility.canUseInOperator(leftType, rightType)) {
          this.errors.push({
            message: `'in' operator requires object or array on right side, got ${rightType}`,
            start: node.start,
            end: node.end,
            severity: 'error'
          });
        }
        return UcodeType.BOOLEAN;

      default:
        return UcodeType.UNKNOWN;
    }
  }

  private checkUnaryExpression(node: UnaryExpressionNode): UcodeType {
    const argType = this.checkNode(node.argument);
    const resultType = this.typeCompatibility.getUnaryResultType(argType, node.operator);
    
    if (resultType === UcodeType.UNKNOWN) {
      this.errors.push({
        message: `Cannot apply ${node.operator} to ${argType}`,
        start: node.start,
        end: node.end,
        severity: 'error'
      });
    }
    
    return resultType;
  }

  private checkCallExpression(node: CallExpressionNode): UcodeType {
    if (node.callee.type === 'Identifier') {
      const funcName = (node.callee as IdentifierNode).name;
      const signature = this.builtinFunctions.get(funcName);
      
      if (signature) {
        return this.validateBuiltinCall(node, signature);
      } else {
        // Check if it's a user-defined function, imported function, or variable containing a function
        const symbol = this.symbolTable.lookup(funcName);
        if (symbol) {
          // Check for functions and imported functions
          if (symbol.type === SymbolType.FUNCTION || symbol.type === SymbolType.IMPORTED) {
            // Convert UcodeDataType to UcodeType for backwards compatibility
            if (typeof symbol.dataType === 'string') {
              return symbol.dataType as UcodeType;
            } else if (isUnionType(symbol.dataType)) {
              // For union types, return the first type or UNKNOWN
              const types = getUnionTypes(symbol.dataType);
              return types[0] || UcodeType.UNKNOWN;
            } else {
              // For other complex types like ModuleType, return UNKNOWN
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
        
        this.errors.push({
          message: `Undefined function: ${funcName}`,
          start: node.start,
          end: node.end,
          severity: 'error'
        });
        return UcodeType.UNKNOWN;
      }
    }

    // Handle member expression calls (e.g., fs.open, obj.method)
    if (node.callee.type === 'MemberExpression') {
      // Member expression calls are handled like regular calls
      const calleeType = this.checkNode(node.callee);
      if (calleeType !== UcodeType.UNKNOWN) {
        return calleeType;
      }
    }

    // For other callees
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

    return UcodeType.UNKNOWN;
  }

  private validateBuiltinCall(node: CallExpressionNode, signature: FunctionSignature): UcodeType {
    // First check special cases
    if (this.validateSpecialBuiltins(node, signature)) {
      return this.getReturnTypeForFsFunction(signature.name);
    }

    const argCount = node.arguments.length;
    const minParams = signature.minParams || signature.parameters.length;
    const maxParams = signature.maxParams || (signature.variadic ? Infinity : signature.parameters.length);

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

    // Check argument types
    for (let i = 0; i < Math.min(argCount, signature.parameters.length); i++) {
      const expectedType = signature.parameters[i];
      const arg = node.arguments[i];
      if (!arg) continue;
      
      const actualType = this.checkNode(arg) || UcodeType.UNKNOWN;
      
      if (expectedType !== UcodeType.UNKNOWN && !this.typeCompatibility.isTypeCompatible(actualType as UcodeType, expectedType as UcodeType)) {
        this.errors.push({
          message: `Function '${signature.name}' expects ${expectedType} for argument ${i + 1}, got ${actualType}`,
          start: arg.start,
          end: arg.end,
          severity: 'error'
        });
      }
    }

    return this.getReturnTypeForFsFunction(signature.name);
  }

  private getReturnTypeForFsFunction(functionName: string): UcodeType {
    // Return specific fs object types for fs functions
    switch (functionName) {
      case 'open':
      case 'fdopen':
      case 'mkstemp':
        return UcodeType.OBJECT; // Will be treated as fs.file by symbol table
      case 'opendir':
        return UcodeType.OBJECT; // Will be treated as fs.dir by symbol table
      case 'popen':
        return UcodeType.OBJECT; // Will be treated as fs.proc by symbol table
      case 'pipe':
        return UcodeType.ARRAY; // Array of fs.file objects
      default:
        const signature = this.builtinFunctions.get(functionName);
        return signature?.returnType || UcodeType.UNKNOWN;
    }
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
    }
    
    const objectType = this.checkNode(node.object);
    
    if (objectType === UcodeType.ARRAY) {
      return this.typeCompatibility.getArrayElementType(objectType);
    }
    
    if (objectType === UcodeType.OBJECT) {
      return this.typeCompatibility.getObjectPropertyType(objectType);
    }

    if (objectType === UcodeType.STRING && !node.computed) {
      // String properties like length
      const propertyName = (node.property as IdentifierNode).name;
      return this.typeCompatibility.getStringPropertyType(propertyName);
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

    return this.typeCompatibility.getTernaryResultType(consequentType, alternateType);
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

  getCommonReturnType(types: UcodeType[]): UcodeDataType {
    return this.typeCompatibility.getCommonType(types);
  }
}