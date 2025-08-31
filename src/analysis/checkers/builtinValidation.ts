/**
 * Built-in function validation for ucode semantic analysis
 */

import { CallExpressionNode, LiteralNode } from '../../ast/nodes';
import { UcodeType } from '../symbolTable';
import { TypeError } from '../types';

const VALID_SIGNAL_NAMES = new Set([
  'INT', 'ILL', 'ABRT', 'FPE', 'SEGV', 'TERM', 'HUP', 'QUIT', 'TRAP', 
  'KILL', 'PIPE', 'ALRM', 'STKFLT', 'PWR', 'BUS', 'SYS', 'URG', 'STOP', 
  'TSTP', 'CONT', 'CHLD', 'TTIN', 'TTOU', 'POLL', 'XFSZ', 'XCPU', 
  'VTALRM', 'PROF', 'USR1', 'USR2'
]);

const UNHANDLABLE_SIGNALS = new Set(['KILL', 'STOP']);

function isNumberLikeString(s: string): boolean {
  const trimmed = s.trim();
  if (trimmed === '') return false;

  // Regular expression to match ucode's number parsing behavior
  // Supports decimal, hex (0x), binary (0b), and octal (0, 0o)
  const numberLikeRegex = /^[+-]?(\d*\.?\d+([eE][+-]?\d+)?|0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO]?[0-7]+)$/;
  return numberLikeRegex.test(trimmed);
}

function isNumericConvertibleType(type: UcodeType): boolean {
  const allowedTypes = [
    UcodeType.NULL, UcodeType.BOOLEAN, UcodeType.INTEGER,
    UcodeType.DOUBLE, UcodeType.STRING, UcodeType.UNKNOWN
  ];
  return allowedTypes.includes(type);
}

export function isStringCastableType(_type: UcodeType): boolean {
  // Based on ucv_to_stringbuf_formatted - all types can be cast to string
  // NULL -> "null"
  // BOOLEAN -> "true"/"false"  
  // INTEGER -> number representation
  // DOUBLE -> number representation (including NaN, Infinity)
  // STRING -> unchanged
  // ARRAY -> JSON-like representation "[...]"
  // OBJECT -> JSON-like representation "{...}"
  // REGEX -> "/pattern/flags"
  // FUNCTION -> "function name(...) { ... }"
  // RESOURCE -> "<resource type pointer>"
  // UNKNOWN -> assumed castable
  return true; // All ucode types are castable to string
}

export class BuiltinValidator {
  private errors: TypeError[] = [];

  constructor() {}

  private checkArgumentCount(node: CallExpressionNode, funcName: string, minArgs: number): boolean {
    if (node.arguments.length < minArgs) {
      this.errors.push({
        message: `Function '${funcName}' expects at least ${minArgs} argument(s), got ${node.arguments.length}`,
        start: node.start,
        end: node.end,
        severity: 'error'
      });
      return false;
    }
    return true;
  }

  private validateNumericArgument(arg: CallExpressionNode['arguments'][0] | undefined, funcName: string, argPosition: number): boolean {
    if (!arg) {
      return true; // No argument, no error
    }

    const argType = this.getNodeType(arg);

    if (!isNumericConvertibleType(argType)) {
      this.errors.push({
        message: `Argument ${argPosition} of ${funcName}() cannot be a ${argType.toLowerCase()}. It must be a value convertible to a number.`,
        start: arg.start,
        end: arg.end,
        severity: 'error'
      });
      return false;
    }

    if (argType === UcodeType.STRING && arg.type === 'Literal') {
      const literal = arg as LiteralNode;
      if (typeof literal.value === 'string' && !isNumberLikeString(literal.value)) {
        this.errors.push({
          message: `String "${literal.value}" cannot be converted to a number for ${funcName}() argument ${argPosition}.`,
          start: arg.start,
          end: arg.end,
          severity: 'error'
        });
        return false;
      }
    }

    return true;
  }

  private validateArgumentType(
    arg: CallExpressionNode['arguments'][0] | undefined,
    funcName: string,
    argPosition: number,
    allowedTypes: UcodeType[],
    customErrorMessage?: string
  ): boolean {
    if (!arg) {
      return true; // Argument presence should be checked before this call
    }

    const argType = this.getNodeType(arg);
    const checkTypes = [...allowedTypes, UcodeType.UNKNOWN];

    if (!checkTypes.includes(argType)) {
      const message = customErrorMessage ||
        `Function '${funcName}' expects ${allowedTypes.join(' or ')} for argument ${argPosition}, but got ${argType.toLowerCase()}`;

      this.errors.push({
        message: message,
        start: arg.start,
        end: arg.end,
        severity: 'error'
      });
      return false;
    }

    return true;
  }

  validateLengthFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'length', 1)) return true;
    this.validateArgumentType(node.arguments[0], 'length', 1, [UcodeType.STRING, UcodeType.ARRAY, UcodeType.OBJECT]);
    return true;
  }

  validateIndexFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'index', 2)) return true;
    this.validateArgumentType(node.arguments[0], 'index', 1, [UcodeType.STRING, UcodeType.ARRAY]);
    return true;
  }

  validateRindexFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'rindex', 2)) return true;
    // First argument is converted to a string, so no type check is needed.
    this.validateArgumentType(node.arguments[0], 'rindex', 1, [UcodeType.STRING, UcodeType.ARRAY]);
    return true;
  }

  validateMatchFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'match', 2)) return true;
    // First argument is converted to a string, so no type check is needed.
    this.validateArgumentType(node.arguments[1], 'match', 2, [UcodeType.REGEX]);
    return true;
  }

  validateSplitFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'split', 2)) return true;
    const textArg = node.arguments[0];
    const separatorArg = node.arguments[1];
    
    if (textArg) {
      const textType = this.getNodeType(textArg);
      
      if (textType !== UcodeType.STRING && textType !== UcodeType.UNKNOWN) {
        this.errors.push({
          message: `Function 'split' expects string as first argument, got ${textType}`,
          start: textArg.start,
          end: textArg.end,
          severity: 'error'
        });
      }
    }

    if (separatorArg) {
      const separatorType = this.getNodeType(separatorArg);
      
      // In ucode, split() can accept string or regex pattern as separator
      if (separatorType !== UcodeType.STRING && separatorType !== UcodeType.REGEX && separatorType !== UcodeType.UNKNOWN) {
        this.errors.push({
          message: `Function 'split' expects string or regex pattern as second argument, got ${separatorType}`,
          start: separatorArg.start,
          end: separatorArg.end,
          severity: 'error'
        });
      }
    }

    // Optional third argument (limit) should be a number
    if (node.arguments.length === 3) {
      const limitArg = node.arguments[2];
      if (limitArg) {
        const limitType = this.getNodeType(limitArg);
        
        if (limitType !== UcodeType.INTEGER && limitType !== UcodeType.UNKNOWN) {
          this.errors.push({
            message: `Function 'split' expects integer as third argument, got ${limitType}`,
            start: limitArg.start,
            end: limitArg.end,
            severity: 'error'
          });
        }
      }
    }

    return true;
  }

  validateReplaceFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'replace', 3)) return true;
    // First argument is converted to string, so no type check is needed.
    // Second argument can be string or regex.
    this.validateArgumentType(node.arguments[1], 'replace', 2, [UcodeType.STRING, UcodeType.REGEX]);
    this.validateArgumentType(node.arguments[2], 'replace', 3, [UcodeType.STRING, UcodeType.FUNCTION]);
    return true;
  }

  validateDieFunction(_node: CallExpressionNode): boolean {
    // First argument is converted to a string, so no type check is needed.
    return true;
  }

  validateLcFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'lc', 1)) return true;
    // First argument is converted to string - all types are valid
    return true;
  }

  validateUcFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'uc', 1)) return true;
    // First argument is converted to string - all types are valid
    return true;
  }

  validateLoadstringFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'loadstring', 1)) return true;
    // First argument is converted to string - all types are valid
    return true;
  }

  validateHexencFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'hexenc', 1)) return true;
    // First argument is converted to string - all types are valid
    return true;
  }

  validateJoinFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'join', 2)) return true;
    // First argument (separator) is converted to string - all types are valid
    this.validateArgumentType(node.arguments[1], 'join', 2, [UcodeType.ARRAY]);
    return true;
  }

  validatePrintFunction(_node: CallExpressionNode): boolean {
    // All arguments are converted to strings - no type validation needed
    return true;
  }

  validateExistsFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'exists', 2)) return true;
    this.validateArgumentType(node.arguments[0], 'exists', 1, [UcodeType.OBJECT]);
    // Second argument is converted to a string, so no type check is needed.
    return true;
  }

  validateAssertFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'assert', 1)) return true;
    // First argument is any type, second is converted to string. No checks needed.
    return true;
  }

  validateRegexpFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'regexp', 1)) return true;
    // First and second (optional) arguments are converted to string. No checks needed.
    return true;
  }

  validateWildcardFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'wildcard', 2)) return true;
    // First and second arguments are converted to string. No checks needed.
    return true;
  }


  validateLocaltimeFunction(node: CallExpressionNode): boolean {
    // 0 or 1 arguments, no check needed
    this.validateArgumentType(node.arguments[0], 'localtime', 1, [UcodeType.INTEGER, UcodeType.DOUBLE]);
    return true;
  }

  validateGmtimeFunction(node: CallExpressionNode): boolean {
    // 0 or 1 arguments, no check needed
    this.validateArgumentType(node.arguments[0], 'gmtime', 1, [UcodeType.INTEGER, UcodeType.DOUBLE]);
    return true;
  }

  validateTimelocalFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'timelocal', 1)) return true;
    this.validateArgumentType(node.arguments[0], 'timelocal', 1, [UcodeType.ARRAY]);
    return true;
  }

  validateTimegmFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'timegm', 1)) return true;
    this.validateArgumentType(node.arguments[0], 'timegm', 1, [UcodeType.ARRAY]);
    return true;
  }

  validateJsonFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'json', 1)) return true;
    this.validateArgumentType(
      node.arguments[0],
      'json',
      1,
      [UcodeType.STRING, UcodeType.OBJECT],
      `Function 'json' expects string or object as argument`
    );
    return true;
  }

  validateCallFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'call', 1)) return true;
    this.validateArgumentType(node.arguments[0], 'call', 1, [UcodeType.FUNCTION]);
    if (node.arguments.length >= 3) {
      this.validateArgumentType(node.arguments[2], 'call', 3, [UcodeType.OBJECT, UcodeType.NULL]);
    }
    return true;
  }

  validateSignalFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'signal', 1)) return true;

    const signalArg = node.arguments[0];
    let signalValue: string | number | null = null;

    if (signalArg) {
      const signalType = this.getNodeType(signalArg);
      
      if (signalArg.type === 'Literal') {
        const literal = signalArg as LiteralNode;
        if (literal.value !== null) {
            signalValue = literal.value as string | number;
            if (signalType === UcodeType.INTEGER) {
                if (typeof literal.value === 'number' && (literal.value < 1 || literal.value > 31)) {
                    this.errors.push({ message: `Signal number must be between 1 and 31, got ${literal.value}`, start: signalArg.start, end: signalArg.end, severity: 'error' });
                }
            } else if (signalType === UcodeType.STRING) {
                if (typeof literal.value === 'string') {
                    let sigStr = literal.value.toUpperCase().replace(/^SIG/, '');
                    if (!VALID_SIGNAL_NAMES.has(sigStr) && !UNHANDLABLE_SIGNALS.has(sigStr)) {
                        this.errors.push({ message: `Invalid signal name "${literal.value}"`, start: signalArg.start, end: signalArg.end, severity: 'error' });
                    }
                }
            } else if (signalType === UcodeType.DOUBLE) {
                this.errors.push({ message: `signal() first parameter cannot be a double`, start: signalArg.start, end: signalArg.end, severity: 'error' });
            } else {
                this.validateArgumentType(signalArg, 'signal', 1, [UcodeType.INTEGER, UcodeType.STRING]);
            }
        }
      } else { // It's a variable or expression
        this.validateArgumentType(signalArg, 'signal', 1, [UcodeType.INTEGER, UcodeType.STRING]);
      }
    }

    if (node.arguments.length === 2) {
      const handlerArg = node.arguments[1];
      if (handlerArg) {
        const handlerType = this.getNodeType(handlerArg);
        if (handlerType === UcodeType.STRING && handlerArg.type === 'Literal') {
          const literal = handlerArg as LiteralNode;
          if (typeof literal.value === 'string' && literal.value !== 'ignore' && literal.value !== 'default') {
            this.errors.push({ message: `Invalid signal handler string "${literal.value}". Did you mean 'ignore' or 'default'?`, start: handlerArg.start, end: handlerArg.end, severity: 'warning' });
          }
        } else {
            this.validateArgumentType(handlerArg, 'signal', 2, [UcodeType.FUNCTION, UcodeType.STRING]);
        }

        if (signalValue && signalArg) {
            let sigStr = String(signalValue).toUpperCase().replace(/^SIG/, '');
            if (UNHANDLABLE_SIGNALS.has(sigStr)) {
                this.errors.push({ message: `Signal '${sigStr}' cannot be caught or ignored.`, start: signalArg.start, end: signalArg.end, severity: 'warning' });
            }
        }
      }
    }

    return true;
  }

  validateSystemFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'system', 1)) return true;
    // First argument can be string or array. If array, all elements are converted to strings.
    this.validateArgumentType(node.arguments[0], 'system', 1, [UcodeType.STRING, UcodeType.ARRAY]);
    if (node.arguments.length > 1) {
        this.validateArgumentType(node.arguments[1], 'system', 2, [UcodeType.INTEGER, UcodeType.DOUBLE]);
    }
    return true;
  }

  validateSleepFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'sleep', 1)) return true;
    this.validateNumericArgument(node.arguments[0], 'sleep', 1);
    return true;
  }

  validateMinFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'min', 1)) return true;
    // min() accepts all types and compares using ucode's comparison rules
    // Examples: min(5, 2.1, "abc", 0.3) -> 0.3, min("def", "abc") -> "abc"
    return true;
  }

  validateMaxFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'max', 1)) return true;
    // max() accepts all types and compares using ucode's comparison rules
    // Examples: max(5, 2.1, "abc", 0.3) -> 5, max("def", "abc", "ghi") -> "ghi"
    return true;
  }

  validateUniqFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'uniq', 1)) return true;
    this.validateArgumentType(node.arguments[0], 'uniq', 1, [UcodeType.ARRAY]);
    return true;
  }

  validatePrintfFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'printf', 1)) return true;
    // First argument should be a format string, but string conversion is allowed
    this.validateArgumentType(node.arguments[0], 'printf', 1, [UcodeType.STRING]);
    return true;
  }

  validateSprintfFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'sprintf', 1)) return true;
    // First argument should be a format string, but string conversion is allowed
    this.validateArgumentType(node.arguments[0], 'sprintf', 1, [UcodeType.STRING]);
    return true;
  }

  getErrors(): TypeError[] {
    return this.errors;
  }

  resetErrors(): void {
    this.errors = [];
  }

  // This method should be implemented by the type checker that uses this validator
  private getNodeType(_node: any): UcodeType {
    // This will be injected by the main type checker
    return UcodeType.UNKNOWN;
  }

  // Method to inject the type checker
  setTypeChecker(typeChecker: (node: any) => UcodeType): void {
    this.getNodeType = typeChecker;
  }
}