/**
 * Type System for ucode semantic analysis
 * Handles type inference and type checking
 */

import { 
  AstNode, LiteralNode, IdentifierNode, BinaryExpressionNode, UnaryExpressionNode,
  CallExpressionNode, MemberExpressionNode, AssignmentExpressionNode, ArrayExpressionNode,
  ObjectExpressionNode, ConditionalExpressionNode
} from '../ast/nodes';
import { SymbolTable, SymbolType, UcodeType } from './symbolTable';

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

  constructor(symbolTable: SymbolTable) {
    this.symbolTable = symbolTable;
    this.builtinFunctions = new Map();
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
      { name: 'gc', parameters: [], returnType: UcodeType.NULL }
    ];

    for (const builtin of builtins) {
      this.builtinFunctions.set(builtin.name, builtin);
    }
  }

  resetErrors(): void {
    this.errors = [];
    this.warnings = [];
  }

  checkNode(node: AstNode): UcodeType {
    // Don't reset errors here - let them accumulate across calls
    // Use resetErrors() method at the beginning of analysis instead

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
      default:
        return UcodeType.UNKNOWN;
    }
  }

  getResult(): TypeCheckResult {
    return {
      type: UcodeType.UNKNOWN,
      errors: this.errors,
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
      return symbol.dataType;
    } else {
      this.errors.push({
        message: `Undefined variable: ${node.name}`,
        start: node.start,
        end: node.end,
        severity: 'error'
      });
      return UcodeType.UNKNOWN;
    }
  }

  private checkBinaryExpression(node: BinaryExpressionNode): UcodeType {
    const leftType = this.checkNode(node.left);
    const rightType = this.checkNode(node.right);

    // Type checking for binary operators
    switch (node.operator) {
      case '+':
        // Addition: numbers or string concatenation
        if (this.isNumericType(leftType) && this.isNumericType(rightType)) {
          return this.getNumericResultType(leftType, rightType);
        }
        if (leftType === UcodeType.STRING || rightType === UcodeType.STRING) {
          return UcodeType.STRING;
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
        if (!this.isNumericType(leftType) || !this.isNumericType(rightType)) {
          this.errors.push({
            message: `Cannot perform ${node.operator} on ${leftType} and ${rightType}`,
            start: node.start,
            end: node.end,
            severity: 'error'
          });
          return UcodeType.UNKNOWN;
        }
        return this.getNumericResultType(leftType, rightType);

      case '==':
      case '!=':
      case '===':
      case '!==':
      case '<':
      case '>':
      case '<=':
      case '>=':
        return UcodeType.BOOLEAN;

      case '&&':
      case '||':
        return UcodeType.BOOLEAN;

      case '&':
      case '|':
      case '^':
      case '<<':
      case '>>':
        if (!this.isIntegerType(leftType) || !this.isIntegerType(rightType)) {
          this.errors.push({
            message: `Bitwise operations require integers, got ${leftType} and ${rightType}`,
            start: node.start,
            end: node.end,
            severity: 'error'
          });
          return UcodeType.UNKNOWN;
        }
        return UcodeType.INTEGER;

      case 'in':
        if (rightType !== UcodeType.OBJECT && rightType !== UcodeType.ARRAY) {
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

    switch (node.operator) {
      case '+':
      case '-':
        if (!this.isNumericType(argType)) {
          this.errors.push({
            message: `Cannot apply ${node.operator} to ${argType}`,
            start: node.start,
            end: node.end,
            severity: 'error'
          });
          return UcodeType.UNKNOWN;
        }
        return argType;

      case '!':
        return UcodeType.BOOLEAN;

      case '~':
        if (!this.isIntegerType(argType)) {
          this.errors.push({
            message: `Bitwise complement requires integer, got ${argType}`,
            start: node.start,
            end: node.end,
            severity: 'error'
          });
          return UcodeType.UNKNOWN;
        }
        return UcodeType.INTEGER;

      case '++':
      case '--':
        if (!this.isNumericType(argType)) {
          this.errors.push({
            message: `Cannot apply ${node.operator} to ${argType}`,
            start: node.start,
            end: node.end,
            severity: 'error'
          });
          return UcodeType.UNKNOWN;
        }
        return argType;

      default:
        return UcodeType.UNKNOWN;
    }
  }

  private checkCallExpression(node: CallExpressionNode): UcodeType {
    if (node.callee.type === 'Identifier') {
      const funcName = (node.callee as IdentifierNode).name;
      const signature = this.builtinFunctions.get(funcName);
      
      if (signature) {
        return this.validateBuiltinCall(node, signature);
      } else {
        // Check if it's a user-defined function
        const symbol = this.symbolTable.lookup(funcName);
        if (symbol && symbol.type === SymbolType.FUNCTION) {
          return symbol.dataType;
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

    // For member expressions and other callees
    const calleeType = this.checkNode(node.callee);
    if (calleeType !== UcodeType.FUNCTION) {
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
      return signature.returnType;
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
      
      if (expectedType !== UcodeType.UNKNOWN && !this.isTypeCompatible(actualType as UcodeType, expectedType as UcodeType)) {
        this.errors.push({
          message: `Function '${signature.name}' expects ${expectedType} for argument ${i + 1}, got ${actualType}`,
          start: arg.start,
          end: arg.end,
          severity: 'error'
        });
      }
    }

    return signature.returnType;
  }

  private validateSpecialBuiltins(node: CallExpressionNode, signature: FunctionSignature): boolean {
    const funcName = signature.name;
    
    switch (funcName) {
      case 'length':
        return this.validateLengthFunction(node);
      case 'index':
        return this.validateIndexFunction(node);
      case 'rindex':
        return this.validateRindexFunction(node);
      case 'match':
        return this.validateMatchFunction(node);
      default:
        return false;
    }
  }

  private validateLengthFunction(node: CallExpressionNode): boolean {
    if (node.arguments.length !== 1) {
      this.errors.push({
        message: `Function 'length' expects 1 argument, got ${node.arguments.length}`,
        start: node.start,
        end: node.end,
        severity: 'error'
      });
      return true;
    }

    const arg = node.arguments[0];
    if (!arg) return true;

    const actualType = this.checkNode(arg) || UcodeType.UNKNOWN;
    
    if (actualType !== UcodeType.STRING && actualType !== UcodeType.ARRAY && actualType !== UcodeType.OBJECT && actualType !== UcodeType.UNKNOWN) {
      this.errors.push({
        message: `Function 'length' expects string, array, or object, got ${actualType}`,
        start: arg.start,
        end: arg.end,
        severity: 'error'
      });
    }

    return true;
  }

  private validateIndexFunction(node: CallExpressionNode): boolean {
    if (node.arguments.length !== 2) {
      this.errors.push({
        message: `Function 'index' expects 2 arguments, got ${node.arguments.length}`,
        start: node.start,
        end: node.end,
        severity: 'error'
      });
      return true;
    }

    const haystackArg = node.arguments[0];
    const needleArg = node.arguments[1];
    
    if (haystackArg) {
      const haystackType = this.checkNode(haystackArg) || UcodeType.UNKNOWN;
      
      if (haystackType !== UcodeType.STRING && haystackType !== UcodeType.ARRAY && haystackType !== UcodeType.UNKNOWN) {
        this.errors.push({
          message: `Function 'index' expects string or array as first argument, got ${haystackType}`,
          start: haystackArg.start,
          end: haystackArg.end,
          severity: 'error'
        });
      }
    }

    if (needleArg) {
      // Second argument (needle) can be any type
      this.checkNode(needleArg);
    }

    return true;
  }

  private validateRindexFunction(node: CallExpressionNode): boolean {
    if (node.arguments.length !== 2) {
      this.errors.push({
        message: `Function 'rindex' expects 2 arguments, got ${node.arguments.length}`,
        start: node.start,
        end: node.end,
        severity: 'error'
      });
      return true;
    }

    const haystackArg = node.arguments[0];
    const needleArg = node.arguments[1];
    
    if (haystackArg) {
      const haystackType = this.checkNode(haystackArg) || UcodeType.UNKNOWN;
      
      if (haystackType !== UcodeType.STRING && haystackType !== UcodeType.UNKNOWN) {
        this.errors.push({
          message: `Function 'rindex' expects string as first argument, got ${haystackType}`,
          start: haystackArg.start,
          end: haystackArg.end,
          severity: 'error'
        });
      }
    }

    if (needleArg) {
      // Second argument (needle) can be any type
      this.checkNode(needleArg);
    }

    return true;
  }

  private validateMatchFunction(node: CallExpressionNode): boolean {
    if (node.arguments.length !== 2) {
      this.errors.push({
        message: `Function 'match' expects 2 arguments, got ${node.arguments.length}`,
        start: node.start,
        end: node.end,
        severity: 'error'
      });
      return true;
    }

    const textArg = node.arguments[0];
    const patternArg = node.arguments[1];
    
    if (textArg) {
      const textType = this.checkNode(textArg) || UcodeType.UNKNOWN;
      
      if (textType !== UcodeType.STRING && textType !== UcodeType.UNKNOWN) {
        this.errors.push({
          message: `Function 'match' expects string as first argument, got ${textType}`,
          start: textArg.start,
          end: textArg.end,
          severity: 'error'
        });
      }
    }

    if (patternArg) {
      const patternType = this.checkNode(patternArg) || UcodeType.UNKNOWN;
      
      // In ucode, match() can accept string or regex pattern
      if (patternType !== UcodeType.STRING && patternType !== UcodeType.OBJECT && patternType !== UcodeType.UNKNOWN) {
        this.errors.push({
          message: `Function 'match' expects string or regex pattern as second argument, got ${patternType}`,
          start: patternArg.start,
          end: patternArg.end,
          severity: 'error'
        });
      }
    }

    return true;
  }

  private checkMemberExpression(node: MemberExpressionNode): UcodeType {
    const objectType = this.checkNode(node.object);
    
    if (objectType === UcodeType.ARRAY) {
      return UcodeType.UNKNOWN; // Array elements can be any type
    }
    
    if (objectType === UcodeType.OBJECT) {
      return UcodeType.UNKNOWN; // Object properties can be any type
    }

    if (objectType === UcodeType.STRING && !node.computed) {
      // String properties like length
      const propertyName = (node.property as IdentifierNode).name;
      if (propertyName === 'length') {
        return UcodeType.INTEGER;
      }
    }

    return UcodeType.UNKNOWN;
  }

  private checkAssignmentExpression(node: AssignmentExpressionNode): UcodeType {
    const leftType = this.checkNode(node.left);
    const rightType = this.checkNode(node.right);
    
    // Basic type compatibility check
    if (node.operator === '=' && leftType !== UcodeType.UNKNOWN && rightType !== UcodeType.UNKNOWN) {
      if (!this.isTypeCompatible(rightType, leftType)) {
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

    // Return the more specific type if possible
    if (consequentType === alternateType) {
      return consequentType;
    }

    return UcodeType.UNKNOWN;
  }

  private isNumericType(type: UcodeType): boolean {
    return type === UcodeType.INTEGER || type === UcodeType.DOUBLE;
  }

  private isIntegerType(type: UcodeType): boolean {
    return type === UcodeType.INTEGER;
  }

  private getNumericResultType(left: UcodeType, right: UcodeType): UcodeType {
    if (left === UcodeType.DOUBLE || right === UcodeType.DOUBLE) {
      return UcodeType.DOUBLE;
    }
    return UcodeType.INTEGER;
  }

  private isTypeCompatible(actual: UcodeType, expected: UcodeType): boolean {
    if (actual === expected) return true;
    if (expected === UcodeType.UNKNOWN) return true;
    if (actual === UcodeType.UNKNOWN) return true;
    
    // Allow integer to double conversion
    if (actual === UcodeType.INTEGER && expected === UcodeType.DOUBLE) return true;
    
    return false;
  }
}