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

export class BuiltinValidator {
  private errors: TypeError[] = [];

  constructor() {}

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

  validateLengthFunction(node: CallExpressionNode): boolean {
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

    const actualType = this.getNodeType(arg);
    
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

  validateIndexFunction(node: CallExpressionNode): boolean {
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
      const haystackType = this.getNodeType(haystackArg);
      
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
      this.getNodeType(needleArg);
    }

    return true;
  }

  validateRindexFunction(node: CallExpressionNode): boolean {
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
      const haystackType = this.getNodeType(haystackArg);
      
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
      this.getNodeType(needleArg);
    }

    return true;
  }

  validateMatchFunction(node: CallExpressionNode): boolean {
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
      const textType = this.getNodeType(textArg);
      
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
      const patternType = this.getNodeType(patternArg);
      
      // In ucode, match() can accept string or regex pattern
      if (patternType !== UcodeType.REGEX && patternType !== UcodeType.UNKNOWN) {
        this.errors.push({
          message: `Function 'match' expects regex pattern as second argument, got ${patternType}`,
          start: patternArg.start,
          end: patternArg.end,
          severity: 'error'
        });
      }
    }

    return true;
  }

  validateSplitFunction(node: CallExpressionNode): boolean {
    if (node.arguments.length < 2 || node.arguments.length > 3) {
      this.errors.push({
        message: `Function 'split' expects 2-3 arguments, got ${node.arguments.length}`,
        start: node.start,
        end: node.end,
        severity: 'error'
      });
      return true;
    }

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
    if (node.arguments.length !== 3) {
      this.errors.push({
        message: `Function 'replace' expects 3 arguments, got ${node.arguments.length}`,
        start: node.start,
        end: node.end,
        severity: 'error'
      });
      return true;
    }

    const textArg = node.arguments[0];
    const searchArg = node.arguments[1];
    const replacementArg = node.arguments[2];
    
    if (textArg) {
      const textType = this.getNodeType(textArg);
      
      if (textType !== UcodeType.STRING && textType !== UcodeType.UNKNOWN) {
        this.errors.push({
          message: `Function 'replace' expects string as first argument, got ${textType}`,
          start: textArg.start,
          end: textArg.end,
          severity: 'error'
        });
      }
    }

    if (searchArg) {
      const searchType = this.getNodeType(searchArg);
      
      // In ucode, replace() can accept string or regex pattern as search parameter
      if (searchType !== UcodeType.STRING && searchType !== UcodeType.REGEX && searchType !== UcodeType.UNKNOWN) {
        this.errors.push({
          message: `Function 'replace' expects string or regex pattern as second argument, got ${searchType}`,
          start: searchArg.start,
          end: searchArg.end,
          severity: 'error'
        });
      }
    }

    if (replacementArg) {
      const replacementType = this.getNodeType(replacementArg);
      
      // Third argument should be string or function
      if (replacementType !== UcodeType.STRING && replacementType !== UcodeType.FUNCTION && replacementType !== UcodeType.UNKNOWN) {
        this.errors.push({
          message: `Function 'replace' expects string or function as third argument, got ${replacementType}`,
          start: replacementArg.start,
          end: replacementArg.end,
          severity: 'error'
        });
      }
    }

    return true;
  }

  validateLocaltimeFunction(node: CallExpressionNode): boolean {
    if (node.arguments.length > 1) {
      this.errors.push({
        message: `Function 'localtime' expects 0 or 1 argument, got ${node.arguments.length}`,
        start: node.start,
        end: node.end,
        severity: 'error'
      });
      return true;
    }

    if (node.arguments.length === 1) {
      const timestampArg = node.arguments[0];
      if (timestampArg) {
        const timestampType = this.getNodeType(timestampArg);
        
        if (timestampType !== UcodeType.INTEGER && timestampType !== UcodeType.DOUBLE && timestampType !== UcodeType.UNKNOWN) {
          this.errors.push({
            message: `Function 'localtime' expects Unix epoch (number) as argument, got ${timestampType}`,
            start: timestampArg.start,
            end: timestampArg.end,
            severity: 'error'
          });
        }
      }
    }

    return true;
  }

  validateGmtimeFunction(node: CallExpressionNode): boolean {
    if (node.arguments.length > 1) {
      this.errors.push({
        message: `Function 'gmtime' expects 0 or 1 argument, got ${node.arguments.length}`,
        start: node.start,
        end: node.end,
        severity: 'error'
      });
      return true;
    }

    if (node.arguments.length === 1) {
      const timestampArg = node.arguments[0];
      if (timestampArg) {
        const timestampType = this.getNodeType(timestampArg);
        
        if (timestampType !== UcodeType.INTEGER && timestampType !== UcodeType.DOUBLE && timestampType !== UcodeType.UNKNOWN) {
          this.errors.push({
            message: `Function 'gmtime' expects Unix epoch (number) as argument, got ${timestampType}`,
            start: timestampArg.start,
            end: timestampArg.end,
            severity: 'error'
          });
        }
      }
    }

    return true;
  }

  validateTimelocalFunction(node: CallExpressionNode): boolean {
    if (node.arguments.length !== 1) {
      this.errors.push({
        message: `Function 'timelocal' expects 1 argument, got ${node.arguments.length}`,
        start: node.start,
        end: node.end,
        severity: 'error'
      });
      return true;
    }

    const arrayArg = node.arguments[0];
    if (arrayArg) {
      const arrayType = this.getNodeType(arrayArg);
      
      if (arrayType !== UcodeType.ARRAY && arrayType !== UcodeType.UNKNOWN) {
        this.errors.push({
          message: `Function 'timelocal' expects an array of time components as argument, got ${arrayType}`,
          start: arrayArg.start,
          end: arrayArg.end,
          severity: 'error'
        });
      }
    }

    return true;
  }

  validateTimegmFunction(node: CallExpressionNode): boolean {
    if (node.arguments.length !== 1) {
      this.errors.push({
        message: `Function 'timegm' expects 1 argument, got ${node.arguments.length}`,
        start: node.start,
        end: node.end,
        severity: 'error'
      });
      return true;
    }

    const arrayArg = node.arguments[0];
    if (arrayArg) {
      const arrayType = this.getNodeType(arrayArg);
      
      if (arrayType !== UcodeType.ARRAY && arrayType !== UcodeType.UNKNOWN) {
        this.errors.push({
          message: `Function 'timegm' expects an array of time components as argument, got ${arrayType}`,
          start: arrayArg.start,
          end: arrayArg.end,
          severity: 'error'
        });
      }
    }

    return true;
  }

  validateJsonFunction(node: CallExpressionNode): boolean {
    if (node.arguments.length !== 1) {
      this.errors.push({
        message: `Function 'json' expects 1 argument, got ${node.arguments.length}`,
        start: node.start,
        end: node.end,
        severity: 'error'
      });
      return true;
    }

    const arg = node.arguments[0];
    if (arg) {
      const argType = this.getNodeType(arg);
      
      if (argType !== UcodeType.STRING && argType !== UcodeType.OBJECT && argType !== UcodeType.UNKNOWN) {
        this.errors.push({
          message: `Function 'json' expects string or object as argument, got ${argType.toLowerCase()}`,
          start: arg.start,
          end: arg.end,
          severity: 'error'
        });
      }
    }

    return true;
  }

  validateCallFunction(node: CallExpressionNode): boolean {
    if (node.arguments.length < 1) {
      this.errors.push({
        message: `Function 'call' expects at least 1 argument, got ${node.arguments.length}`,
        start: node.start,
        end: node.end,
        severity: 'error'
      });
      return true;
    }

    const functionArg = node.arguments[0];
    if (functionArg) {
      const functionType = this.getNodeType(functionArg);
      
      if (functionType !== UcodeType.FUNCTION && functionType !== UcodeType.UNKNOWN) {
        this.errors.push({
          message: `call() first parameter should be a function, not a ${functionType.toLowerCase()}`,
          start: functionArg.start,
          end: functionArg.end,
          severity: 'error'
        });
      }
    }

    if (node.arguments.length >= 3) {
      const scopeArg = node.arguments[2];
      if (scopeArg) {
        const scopeType = this.getNodeType(scopeArg);

        if (scopeType !== UcodeType.OBJECT && scopeType !== UcodeType.NULL && scopeType !== UcodeType.UNKNOWN) {
          this.errors.push({
            message: `call() third parameter (scope) should be an object, not a ${scopeType.toLowerCase()}`,
            start: scopeArg.start,
            end: scopeArg.end,
            severity: 'error'
          });
        }
      }
    }

    return true;
  }

  validateSignalFunction(node: CallExpressionNode): boolean {
    if (node.arguments.length < 1 || node.arguments.length > 2) {
      this.errors.push({
        message: `Function 'signal' expects 1-2 arguments, got ${node.arguments.length}`,
        start: node.start,
        end: node.end,
        severity: 'error'
      });
      return true;
    }

    const signalArg = node.arguments[0];
    let signalValue: string | number | null = null;

    if (signalArg) {
      const signalType = this.getNodeType(signalArg);
      
      if (signalArg.type === 'Literal') {
        const literal = signalArg as LiteralNode;
        
        if (literal.value === null) return true; // Cannot validate null literals further

        signalValue = literal.value as string | number;

        if (signalType === UcodeType.INTEGER) {
          if (typeof literal.value === 'number' && (literal.value < 1 || literal.value > 31)) {
            this.errors.push({
              message: `Signal number must be between 1 and 31, got ${literal.value}`,
              start: signalArg.start,
              end: signalArg.end,
              severity: 'error'
            });
          }
        } else if (signalType === UcodeType.STRING) {
          if (typeof literal.value === 'string') {
            let sigStr = literal.value.toUpperCase();
            if (sigStr.substring(0, 3) === 'SIG') {
              sigStr = sigStr.substring(3);
            }
            if (!VALID_SIGNAL_NAMES.has(sigStr) && !UNHANDLABLE_SIGNALS.has(sigStr)) {
              this.errors.push({
                message: `Invalid signal name "${literal.value}"`,
                start: signalArg.start,
                end: signalArg.end,
                severity: 'error'
              });
            }
          }
        } else if (signalType === UcodeType.DOUBLE) {
            this.errors.push({
                message: `signal() first parameter cannot be a double, use an integer for signal numbers`,
                start: signalArg.start,
                end: signalArg.end,
                severity: 'error'
            });
        } else if (signalType !== UcodeType.UNKNOWN) {
          this.errors.push({
            message: `signal() first parameter should be a signal number or name (string), not a ${signalType.toLowerCase()}`,
            start: signalArg.start,
            end: signalArg.end,
            severity: 'error'
          });
        }
      } else { // It's a variable or expression
        if (signalType !== UcodeType.INTEGER && signalType !== UcodeType.STRING && signalType !== UcodeType.UNKNOWN) {
          this.errors.push({
            message: `signal() first parameter should be a signal number or name (string), not a ${signalType.toLowerCase()}`,
            start: signalArg.start,
            end: signalArg.end,
            severity: 'error'
          });
        }
      }
    }

    if (node.arguments.length === 2) {
      const handlerArg = node.arguments[1];
      if (handlerArg) {
        const handlerType = this.getNodeType(handlerArg);
        
        if (handlerType === UcodeType.STRING && handlerArg.type === 'Literal') {
          const literal = handlerArg as LiteralNode;
          if (typeof literal.value === 'string' && literal.value !== 'ignore' && literal.value !== 'default') {
            this.errors.push({
              message: `Invalid signal handler string "${literal.value}". Did you mean 'ignore' or 'default'?`,
              start: handlerArg.start,
              end: handlerArg.end,
              severity: 'warning'
            });
          }
        } else if (handlerType !== UcodeType.FUNCTION && handlerType !== UcodeType.STRING && handlerType !== UcodeType.UNKNOWN) {
          this.errors.push({
            message: `signal() second parameter should be a handler function or string ('ignore' or 'default'), not a ${handlerType.toLowerCase()}`,
            start: handlerArg.start,
            end: handlerArg.end,
            severity: 'error'
          });
        }

        if (signalValue && signalArg) {
            let sigStr = String(signalValue).toUpperCase();
            if (sigStr.substring(0, 3) === 'SIG') {
              sigStr = sigStr.substring(3);
            }
            if (UNHANDLABLE_SIGNALS.has(sigStr)) {
                this.errors.push({
                    message: `Signal '${signalValue}' cannot be caught or ignored.`,
                    start: signalArg.start, // error on the signal, not the handler
                    end: signalArg.end,
                    severity: 'warning'
                });
            }
        }
      }
    }

    return true;
  }

  validateSystemFunction(node: CallExpressionNode): boolean {
    if (node.arguments.length < 1) {
      this.errors.push({
        message: `Function 'system' expects at least 1 argument, got ${node.arguments.length}`,
        start: node.start,
        end: node.end,
        severity: 'error'
      });
      return true;
    }

    // Validate command argument (string or array)
    const commandArg = node.arguments[0];
    if (commandArg) {
      const commandType = this.getNodeType(commandArg);
      if (commandType !== UcodeType.STRING && commandType !== UcodeType.ARRAY && commandType !== UcodeType.UNKNOWN) {
        this.errors.push({
          message: `system() first argument must be a string or an array, but got ${commandType.toLowerCase()}`,
          start: commandArg.start,
          end: commandArg.end,
          severity: 'error'
        });
      }
    }

    // Validate timeout argument (number)
    if (node.arguments.length === 2) {
      const timeoutArg = node.arguments[1];
      if (timeoutArg) {
        const timeoutType = this.getNodeType(timeoutArg);
        if (timeoutType !== UcodeType.INTEGER && timeoutType !== UcodeType.DOUBLE && timeoutType !== UcodeType.UNKNOWN) {
          this.errors.push({
            message: `system() timeout must be a number, but got ${timeoutType.toLowerCase()}`,
            start: timeoutArg.start,
            end: timeoutArg.end,
            severity: 'error'
          });
        }
      }
    }

    return true;
  }

  validateSleepFunction(node: CallExpressionNode): boolean {
    if (node.arguments.length < 1) {
      this.errors.push({
        message: `Function 'sleep' expects at least 1 argument, got ${node.arguments.length}`,
        start: node.start,
        end: node.end,
        severity: 'error'
      });
      return true;
    }

    this.validateNumericArgument(node.arguments[0], 'sleep', 1);
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