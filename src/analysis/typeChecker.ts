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
import { SymbolTable, SymbolType, UcodeType, UcodeDataType, isUnionType, getUnionTypes, createUnionType } from './symbolTable';
import { logicalTypeInference } from './logicalTypeInference';
import { arithmeticTypeInference } from './arithmeticTypeInference';
import { BuiltinValidator, TypeCompatibilityChecker } from './checkers';
import { allBuiltinFunctions } from '../builtins';
import { fsTypeRegistry } from './fsTypes';
import { fsModuleTypeRegistry } from './fsModuleTypes';
import { uloopObjectRegistry } from './uloopTypes';
import { rtnlTypeRegistry } from './rtnlTypes';
import { nl80211TypeRegistry } from './nl80211Types';

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
      { name: 'trim', parameters: [UcodeType.STRING, UcodeType.STRING], returnType: UcodeType.STRING, minParams: 1, maxParams: 2 },
      { name: 'ltrim', parameters: [UcodeType.STRING, UcodeType.STRING], returnType: UcodeType.STRING, minParams: 1, maxParams: 2 },
      { name: 'rtrim', parameters: [UcodeType.STRING, UcodeType.STRING], returnType: UcodeType.STRING, minParams: 1, maxParams: 2 },
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
      { name: 'assert', parameters: [UcodeType.UNKNOWN], returnType: UcodeType.UNKNOWN, minParams: 1, maxParams: 2 },
      { name: 'call', parameters: [UcodeType.FUNCTION], returnType: UcodeType.UNKNOWN, variadic: true },
      { name: 'signal', parameters: [UcodeType.INTEGER], returnType: UcodeType.UNKNOWN, minParams: 1, maxParams: 2 },
      { name: 'clock', parameters: [UcodeType.BOOLEAN], returnType: UcodeType.ARRAY, minParams: 0, maxParams: 1 },
      { name: 'sourcepath', parameters: [UcodeType.INTEGER, UcodeType.BOOLEAN], returnType: UcodeType.STRING, minParams: 0, maxParams:2 },
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
      
      // Digest builtin functions (from digest.c global_fns[])
      { name: 'md5', parameters: [UcodeType.STRING], returnType: UcodeType.STRING },
      { name: 'sha1', parameters: [UcodeType.STRING], returnType: UcodeType.STRING },
      { name: 'sha256', parameters: [UcodeType.STRING], returnType: UcodeType.STRING },
      { name: 'md5_file', parameters: [UcodeType.STRING], returnType: UcodeType.STRING },
      { name: 'sha1_file', parameters: [UcodeType.STRING], returnType: UcodeType.STRING },
      { name: 'sha256_file', parameters: [UcodeType.STRING], returnType: UcodeType.STRING },
      
      // Extended digest builtin functions (from digest.c global_fns[])
      { name: 'md2', parameters: [UcodeType.STRING], returnType: UcodeType.STRING },
      { name: 'md4', parameters: [UcodeType.STRING], returnType: UcodeType.STRING },
      { name: 'sha384', parameters: [UcodeType.STRING], returnType: UcodeType.STRING },
      { name: 'sha512', parameters: [UcodeType.STRING], returnType: UcodeType.STRING },
      { name: 'md2_file', parameters: [UcodeType.STRING], returnType: UcodeType.STRING },
      { name: 'md4_file', parameters: [UcodeType.STRING], returnType: UcodeType.STRING },
      { name: 'sha384_file', parameters: [UcodeType.STRING], returnType: UcodeType.STRING },
      { name: 'sha512_file', parameters: [UcodeType.STRING], returnType: UcodeType.STRING },
      
      // Debug builtin functions (from debug.c global_fns[])
      { name: 'memdump', parameters: [UcodeType.UNKNOWN], returnType: UcodeType.BOOLEAN },
      { name: 'traceback', parameters: [UcodeType.INTEGER], returnType: UcodeType.ARRAY, minParams: 0, maxParams: 1 },
      { name: 'sourcepos', parameters: [], returnType: UcodeType.OBJECT },
      { name: 'getinfo', parameters: [UcodeType.UNKNOWN], returnType: UcodeType.OBJECT },
      { name: 'getlocal', parameters: [UcodeType.INTEGER, UcodeType.UNKNOWN], returnType: UcodeType.OBJECT, minParams: 1, maxParams: 2 },
      { name: 'setlocal', parameters: [UcodeType.INTEGER, UcodeType.UNKNOWN, UcodeType.UNKNOWN], returnType: UcodeType.OBJECT, minParams: 2, maxParams: 3 },
      { name: 'getupval', parameters: [UcodeType.UNKNOWN, UcodeType.UNKNOWN], returnType: UcodeType.OBJECT },
      { name: 'setupval', parameters: [UcodeType.UNKNOWN, UcodeType.UNKNOWN, UcodeType.UNKNOWN], returnType: UcodeType.OBJECT },
      
      // Log builtin functions (from log.c global_fns[])
      { name: 'openlog', parameters: [UcodeType.STRING, UcodeType.UNKNOWN, UcodeType.UNKNOWN], returnType: UcodeType.BOOLEAN, minParams: 0, maxParams: 3 },
      { name: 'syslog', parameters: [UcodeType.UNKNOWN, UcodeType.UNKNOWN], returnType: UcodeType.BOOLEAN, variadic: true, minParams: 2 },
      { name: 'closelog', parameters: [], returnType: UcodeType.NULL },
      { name: 'ulog_open', parameters: [UcodeType.UNKNOWN, UcodeType.UNKNOWN, UcodeType.STRING], returnType: UcodeType.BOOLEAN, minParams: 0, maxParams: 3 },
      { name: 'ulog', parameters: [UcodeType.UNKNOWN, UcodeType.UNKNOWN], returnType: UcodeType.BOOLEAN, variadic: true, minParams: 2 },
      { name: 'ulog_close', parameters: [], returnType: UcodeType.NULL },
      { name: 'ulog_threshold', parameters: [UcodeType.UNKNOWN], returnType: UcodeType.BOOLEAN, minParams: 0, maxParams: 1 },
      { name: 'INFO', parameters: [UcodeType.UNKNOWN], returnType: UcodeType.BOOLEAN, variadic: true, minParams: 1 },
      { name: 'NOTE', parameters: [UcodeType.UNKNOWN], returnType: UcodeType.BOOLEAN, variadic: true, minParams: 1 },
      { name: 'WARN', parameters: [UcodeType.UNKNOWN], returnType: UcodeType.BOOLEAN, variadic: true, minParams: 1 },
      { name: 'ERR', parameters: [UcodeType.UNKNOWN], returnType: UcodeType.BOOLEAN, variadic: true, minParams: 1 },
      
      // RTNL builtin functions (from rtnl.c global_fns[])
      { name: 'request', parameters: [UcodeType.INTEGER], returnType: createUnionType([UcodeType.OBJECT, UcodeType.NULL]), minParams: 1, maxParams: 3 },
      { name: 'listener', parameters: [UcodeType.FUNCTION, UcodeType.ARRAY, UcodeType.ARRAY], returnType: UcodeType.OBJECT, minParams: 1, maxParams: 3 },
      { name: 'error', parameters: [], returnType: createUnionType([UcodeType.STRING, UcodeType.NULL]) },
      
      // NL80211 builtin functions (from nl80211.c global_fns[])
      // Note: There may be a name collision with fs error() function
      { name: 'request', parameters: [UcodeType.INTEGER], returnType: UcodeType.OBJECT, minParams: 1, maxParams: 3 },
      { name: 'waitfor', parameters: [UcodeType.ARRAY], returnType: UcodeType.OBJECT, minParams: 1, maxParams: 2 },
      { name: 'listener', parameters: [UcodeType.FUNCTION, UcodeType.ARRAY], returnType: UcodeType.OBJECT },
      
      // Resolv builtin functions (from resolv.c global_fns[])
      { name: 'query', parameters: [UcodeType.STRING, UcodeType.ARRAY, UcodeType.OBJECT], returnType: UcodeType.OBJECT, minParams: 1, maxParams: 2 },
      
      // Socket builtin functions (from socket.c global_fns[])
      { name: 'create', parameters: [], returnType: UcodeType.OBJECT, minParams: 0, maxParams: 3 },
      { name: 'connect', parameters: [UcodeType.UNKNOWN], returnType: UcodeType.OBJECT, minParams: 1, maxParams: 4 },
      { name: 'listen', parameters: [], returnType: UcodeType.OBJECT, minParams: 0, maxParams: 5 },
      { name: 'sockaddr', parameters: [UcodeType.UNKNOWN], returnType: UcodeType.OBJECT },
      { name: 'nameinfo', parameters: [UcodeType.UNKNOWN], returnType: UcodeType.OBJECT, minParams: 1, maxParams: 2 },

      // ubus builtin functions (from ubus.c global_fns[])
      { name: 'error', parameters: [UcodeType.BOOLEAN], returnType: UcodeType.UNKNOWN, minParams: 0, maxParams: 1 },
      { name: 'connect', parameters: [UcodeType.STRING, UcodeType.INTEGER], returnType: UcodeType.OBJECT, minParams: 0, maxParams: 2 },
      { name: 'open_channel', parameters: [UcodeType.INTEGER, UcodeType.FUNCTION, UcodeType.FUNCTION, UcodeType.INTEGER], returnType: UcodeType.OBJECT, minParams: 1, maxParams: 4 },
      { name: 'guard', parameters: [UcodeType.FUNCTION], returnType: UcodeType.UNKNOWN, minParams: 0, maxParams: 1 },

      // UCI builtin functions (from uci.c global_fns[])
      { name: 'error', parameters: [], returnType: UcodeType.UNKNOWN },  // Returns string | null
      { name: 'cursor', parameters: [UcodeType.STRING, UcodeType.STRING, UcodeType.STRING, UcodeType.OBJECT], returnType: UcodeType.OBJECT, minParams: 0, maxParams: 4 },  // Returns uci.cursor | null

      // Zlib builtin functions (from zlib.c global_fns[])
      { name: 'deflate', parameters: [UcodeType.UNKNOWN, UcodeType.BOOLEAN, UcodeType.INTEGER], returnType: UcodeType.STRING, minParams: 1, maxParams: 3 },  // str_or_resource, gzip?, level? -> string | null
      { name: 'inflate', parameters: [UcodeType.UNKNOWN], returnType: UcodeType.STRING, minParams: 1, maxParams: 1 },  // str_or_resource -> string | null
      { name: 'deflater', parameters: [UcodeType.BOOLEAN, UcodeType.INTEGER], returnType: UcodeType.OBJECT, minParams: 0, maxParams: 2 },  // gzip?, level? -> zlib.deflate | null
      { name: 'inflater', parameters: [], returnType: UcodeType.OBJECT, minParams: 0, maxParams: 0 }  // () -> zlib.inflate | null
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
      case 'TemplateLiteral':
        return UcodeType.STRING;
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
        return UcodeType.REGEX; // Regex literals are independent types
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
      const signature = this.builtinFunctions.get(funcName);
      
      if (signature) {
        return this.validateBuiltinCall(node, signature);
      } else {
        // Check if it's a user-defined function, imported function, or variable containing a function
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
            
            // For other imported functions or when fs lookup fails, use default handling
            if (typeof symbol.dataType === 'string') {
              return symbol.dataType as UcodeType;
            } else if (isUnionType(symbol.dataType)) {
              const types = getUnionTypes(symbol.dataType);
              return types[0] || UcodeType.UNKNOWN;
            } else {
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
    // First check special cases
    if (this.validateSpecialBuiltins(node, signature)) {
      return this.dataTypeToUcodeType(signature.returnType);
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
        const propertyName = (node.property as IdentifierNode).name;
        if (!rtnlTypeRegistry.isRtnlConstant(propertyName)) {
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
        const propertyName = (node.property as IdentifierNode).name;
        if (!nl80211TypeRegistry.isNl80211Constant(propertyName)) {
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

  getCommonReturnType(types: UcodeType[]): UcodeDataType {
    return this.typeCompatibility.getCommonType(types);
  }
}