/**
 * Built-in function validation for ucode semantic analysis
 */

import { AstNode, CallExpressionNode, LiteralNode } from '../../ast/nodes';
import { UcodeType } from '../symbolTable';
import { TypeError, TypeWarning } from '../types';

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
  private warnings: TypeWarning[] = [];

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

  private isKnownTruish(node: AstNode): boolean {
    if (node.type === 'Literal') {
      const literal = node as any;
      switch (literal.literalType) {
        case 'null':
          // UC_NULL: always false
          return false;
        case 'boolean':
          // UC_BOOLEAN: return the boolean value
          return literal.value === true;
        case 'number':
          // UC_INTEGER: false if 0, true otherwise
          return literal.value !== 0;
        case 'string':
          // UC_STRING: false if empty string, true otherwise
          return literal.value !== '';
        case 'double':
          // UC_DOUBLE: false if 0 or NaN, true otherwise
          return literal.value !== 0 && !isNaN(literal.value);
        default:
          // UC_ARRAY, UC_OBJECT, UC_REGEXP, UC_CFUNCTION, UC_CLOSURE, etc: always true (default case)
          return true;
      }
    }
    // For non-literals, we can't determine truthiness statically, assume truish
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
    if (node.arguments.length !== 1) {
      this.errors.push({
        message: `loadstring() expects 1 argument, got ${node.arguments.length}`,
        start: node.start,
        end: node.end,
        severity: 'error'
      });
      return true;
    }

    const arg = node.arguments[0];
    if (!arg) return true;
    
    const argType = this.getNodeType(arg);

    if (argType !== UcodeType.STRING && argType !== UcodeType.UNKNOWN) {
      this.errors.push({
        message: `loadstring() expects string, got ${argType.toLowerCase()}`,
        start: arg.start,
        end: arg.end,
        severity: 'error'
      });
    }

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
    // Assert accepts any number of arguments (including 0)
    // Empty assert() will just show as failing assertion
    // All argument types are accepted - no validation needed
    
    if (node.arguments.length === 0) {
      this.warnings.push({
        message: `Empty assert() will always fail - consider adding a condition`,
        start: node.start,
        end: node.end,
        severity: 'warning'
      });
    } else {
      // Check if the first argument is known to be falsy
      const firstArg = node.arguments[0];
      if (firstArg && !this.isKnownTruish(firstArg)) {
        this.warnings.push({
          message: `assert() with falsy value will always fail - consider adding a condition`,
          start: firstArg.start,
          end: firstArg.end,
          severity: 'warning'
        });
      }
    }
    
    return true;
  }

  validateRegexpFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'regexp', 1)) return true;
    
    this.validateArgumentType(node.arguments[0], 'regexp', 1, [UcodeType.STRING]);
    
    if (node.arguments.length > 1) {
      if (this.validateArgumentType(node.arguments[1], 'regexp', 2, [UcodeType.STRING])) {
        // Validate flags string - only 'i', 's', 'g' are allowed
        const flagsArg = node.arguments[1];
        if (flagsArg && flagsArg.type === 'Literal') {
          const literal = flagsArg as any;
          if (literal.literalType === 'string') {
            const flags = literal.value as string;
            const validFlags = new Set(['i', 's', 'g']);
            const invalidChars: string[] = [];
            
            for (const char of flags) {
              if (!validFlags.has(char)) {
                invalidChars.push(char);
              }
            }
            
            if (invalidChars.length > 0) {
              const uniqueInvalid = [...new Set(invalidChars)];
              this.errors.push({
                message: `Unrecognized flag characters: ${uniqueInvalid.map(c => `'${c}'`).join(', ')}`,
                start: flagsArg.start,
                end: flagsArg.end,
                severity: 'error'
              });
            }
          }
        }
      }
    }
    
    return true;
  }

  validateWildcardFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'wildcard', 2)) return true;

    // 1st arg: any; because everything is convertible to string.
    // 2nd arg: must be string
    this.validateArgumentType(node.arguments[1], 'wildcard', 2, [UcodeType.STRING]);

    const patternArg = node.arguments[1];

    // Third argument detection for future use (case-insensitive flag)
    // Currently not used in validation but available for enhancement

    if (patternArg && patternArg.type === 'Literal') {
      const lit = patternArg as any;
      if (lit.literalType === 'string') {
        const pattern: string = String(lit.value ?? '');
        const valueStart: number = (lit.valueStart ?? (patternArg.start + 1));
        const valueEnd: number   = (lit.valueEnd   ?? (patternArg.end - 1));

        type Sev = 'error' | 'warning' | 'info';
        let hadError = false;
        let sawWildcard = false;

        const pushDiag = (sev: Sev, msg: string, relStart: number, relEnd?: number) => {
          hadError ||= (sev === 'error');
          const start = Math.min(valueEnd, Math.max(valueStart, valueStart + relStart));
          const end   = Math.min(valueEnd, Math.max(start, valueStart + (relEnd ?? relStart + 1)));
          if (sev === 'warning')
            this.warnings.push({ message: msg, start, end, severity: sev });
          else if (sev === 'error')
            this.errors.push({ message: msg, start, end, severity: sev });
        };

        const POSIX_CLASSES = new Set([
          'alnum','alpha','blank','cntrl','digit','graph','lower',
          'print','punct','space','upper','xdigit'
        ]);

        // Non-fatal style nudge: "**" is usually accidental.
        for (let i = 0; i + 1 < pattern.length; i++) {
          if (pattern[i] === '*' && pattern[i + 1] === '*') {
            pushDiag('warning',
              `Redundant '*' at position ${i}. Prefer a single '*' unless you truly want back-to-back globs.`,
              i, i + 2);
          }
        }

        const escapesEnabled = true; // Only FNM_CASEFOLD is supported; escapes behave like OpenBSD.
        let i = 0;

        while (i < pattern.length) {
          const ch = pattern[i];

          if (escapesEnabled && ch === '\\') {
            if (i + 1 < pattern.length) { i += 2; continue; }
            pushDiag('warning',
              `Trailing backslash escapes nothing and is treated as a literal '\\'. If you intended to escape a character, add it after the '\\'.`,
              i);
            i += 1;
            continue;
          }

          if (ch === '*' || ch === '?') {
            sawWildcard = true;
            i += 1;
            continue;
          }

          if (ch === '[') {
            const openPos = i;
            let j = i + 1;
            let hadItemBeforeDash = false;
            let lastLiteralForRange: string | null = null;

            if (j < pattern.length && (pattern[j] === '!' || pattern[j] === '^')) j++;
            if (j < pattern.length && pattern[j] === ']') { // leading ']'
              hadItemBeforeDash = true;
              lastLiteralForRange = ']';
              j++;
            }

            let closed = false;
            while (j < pattern.length) {
              if (escapesEnabled && pattern[j] === '\\') {
                if (j + 1 < pattern.length && pattern[j + 1]) {
                  hadItemBeforeDash = true;
                  lastLiteralForRange = pattern[j + 1] ?? null;
                  j += 2;
                  continue;
                } else { j += 1; continue; }
              }

              // Character class [:name:]
              if (pattern[j] === '[' && j + 1 < pattern.length && pattern[j + 1] === ':') {
                const classStart = j + 2;
                let k = classStart, found = false;
                while (k + 1 < pattern.length) {
                  if (pattern[k] === ':' && pattern[k + 1] === ']') { found = true; break; }
                  k++;
                }
                if (!found) {
                  pushDiag('error',
                    `Unterminated character class. Expected ':]' to close '[:class:]'. Add ':]' to close the class.`,
                    j, Math.min(j + 2, pattern.length));
                  j += 1;
                  continue;
                } else {
                  const name = pattern.slice(classStart, k);
                  if (!POSIX_CLASSES.has(name)) {
                    const lower = name.toLowerCase();
                    const suggestion = POSIX_CLASSES.has(lower) ? ` Did you mean '[:${lower}:]'?` : '';
                    pushDiag('error',
                      `Unknown POSIX character class '[:${name}:]'. Allowed: ${Array.from(POSIX_CLASSES).join(', ')}.` + suggestion,
                      j, k + 2);
                  }
                  hadItemBeforeDash = true;
                  lastLiteralForRange = null;
                  j = k + 2;
                  continue;
                }
              }

              // '*' and '?' are literals inside bracket expressions
              if ((pattern[j] === '*' || pattern[j] === '?') && pattern[j]) {
                pushDiag('warning', `'${pattern[j]}' is literal inside '[...]', not a wildcard.`, j);
                hadItemBeforeDash = true;
                lastLiteralForRange = pattern[j] ?? null;
                j += 1;
                continue;
              }

              if (pattern[j] === ']') { closed = true; j++; break; }

              if (pattern[j] === '-') {
                // Edge '-' is literal: at start of items (no left endpoint)
                // or immediately before a closing ']' (no right endpoint).
                if (!hadItemBeforeDash || j + 1 >= pattern.length || pattern[j + 1] === ']') {
                  hadItemBeforeDash = true;
                  lastLiteralForRange = '-';
                  j += 1;
                  continue;
                }
                // Probe right endpoint (must exist and not be ']' unless escaped/class)
                let k = j + 1;
                let rightChar: string | null = null;
                let rightExists = false;
                if (k < pattern.length) {
                  if (escapesEnabled && pattern[k] === '\\' && k + 1 < pattern.length) {
                    rightExists = (pattern[k + 1] !== ']');
                    rightChar = rightExists ? (pattern[k + 1] ?? null) : null;
                  } else if (pattern[k] !== ']') {
                    rightExists = true;
                    if (!(pattern[k] === '[' && k + 1 < pattern.length && pattern[k + 1] === ':')) {
                      rightChar = pattern[k] ?? null;
                    } else {
                      rightChar = null; // class endpoint; fine for syntax
                    }
                  }
                }

                if (!rightExists) {
                    pushDiag('error',
                    `Malformed range: '-' must have a character on both sides inside '[...]'. Move '-' to the start/end to make it literal (e.g., '[-a]' or '[a-]'), or provide both endpoints (e.g., 'a-z').`,
                    j);
                  hadItemBeforeDash = true;
                  lastLiteralForRange = '-';
                  j += 1;
                  continue;
                } else {
                  if (lastLiteralForRange && rightChar) {
                    const L = lastLiteralForRange.charCodeAt(0);
                    const R = rightChar.charCodeAt(0);
                    const isSuspiciousAlphaSpan =
                      ((lastLiteralForRange >= 'A' && lastLiteralForRange <= 'Z') &&
                      (rightChar          >= 'a' && rightChar          <= 'z') && L < R);
                    if (isSuspiciousAlphaSpan) {
                      pushDiag('warning',
                        `Suspicious range '${lastLiteralForRange}-${rightChar}' spans punctuation (between 'Z' and 'a'). Prefer '[A-Za-z]'.`,
                        j - 1, j + 2);
                    }
                    // Descending/empty range like 'r-i': valid but usually unintended.
                    if (L > R) {
                      pushDiag('warning',
                        `Descending range '${lastLiteralForRange}-${rightChar}' likely matches nothing under byte collation. Did you mean '${rightChar}-${lastLiteralForRange}' or escape '-' as '\\-'?`,
                        j - 1, j + 2);
1                    }
                  }
                  j += 1; // on '-'
                  if (escapesEnabled && pattern[j] === '\\' && j + 1 < pattern.length) {
                    j += 2;
                  } else if (pattern[j] === '[' && j + 1 < pattern.length && pattern[j + 1] === ':') {
                    let m = j + 2, found = false;
                    while (m + 1 < pattern.length) {
                      if (pattern[m] === ':' && pattern[m + 1] === ']') { found = true; break; }
                      m++;
                    }
                    j = found ? m + 2 : j + 1;
                  } else {
                    j += 1;
                  }
                  hadItemBeforeDash = true;
                  lastLiteralForRange = null;
                  continue;
                }
              }

              // Ordinary literal
              hadItemBeforeDash = true;
              lastLiteralForRange = pattern[j] ?? null;
              j += 1;
            } // end bracket scan

            if (!closed) {
              pushDiag('error',
                `Unclosed bracket expression. Add a matching ']' to close the '[' opened here.`,
                openPos);
              i = openPos + 1;
              continue;
            } else {
              sawWildcard = true; // wildcard is []; we know this because the [ is closed.
              // Naked POSIX class like '[:alpha:]' (no inner leading '[') — likely intent was '[[:alpha:]]'
              const inner = pattern.slice(openPos + 1, j - 1);
              const m = /^:([A-Za-z]+):$/.exec(inner);
              if (m && m[1] && POSIX_CLASSES.has(m[1])) {
                pushDiag(
                  'warning',
                  `POSIX character class used without outer brackets. Use '[[:${m[1]}:]]', not '[:${m[1]}:]'.`,
                  openPos, j
                );
              }
              i = j;
              continue;
            }
          }

          // ordinary literal
          i += 1;
        }

        if (!hadError && !sawWildcard) {
          this.warnings.push({
            message: `Wildcard pattern '${pattern}' contains no wildcard characters. Consider adding '*', '?' or a bracket expression '[...]' if you intended a pattern.`,
            start: patternArg.start,
            end: patternArg.end,
            severity: 'warning'
          });
        }
      }
    }

    // 3rd arg: CASEFOLD flag — no *syntax* validation required.
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
            this.warnings.push({ message: `Invalid signal handler string "${literal.value}". Did you mean 'ignore' or 'default'?`, start: handlerArg.start, end: handlerArg.end, severity: 'warning' });
          }
        } else {
            this.validateArgumentType(handlerArg, 'signal', 2, [UcodeType.FUNCTION, UcodeType.STRING]);
        }

        if (signalValue && signalArg) {
            let sigStr = String(signalValue).toUpperCase().replace(/^SIG/, '');
            if (UNHANDLABLE_SIGNALS.has(sigStr)) {
                this.warnings.push({ message: `Signal '${sigStr}' cannot be caught or ignored.`, start: signalArg.start, end: signalArg.end, severity: 'warning' });
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

  validateIptoarrFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'iptoarr', 1)) return true;
    // First argument must be a string (IP address), returns null if not
    this.validateArgumentType(node.arguments[0], 'iptoarr', 1, [UcodeType.STRING]);
    return true;
  }

  validateArrtoipFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'arrtoip', 1)) return true;
    // First argument must be an array (IP components), returns null if not
    this.validateArgumentType(node.arguments[0], 'arrtoip', 1, [UcodeType.ARRAY]);
    return true;
  }

  validateIntFunction(node: CallExpressionNode): boolean {
    if (node.arguments.length !== 1) {
      this.errors.push({
        message: `int() expects 1 argument, got ${node.arguments.length}`,
        start: node.start,
        end: node.end,
        severity: 'error'
      });
      return true;
    }

    const arg = node.arguments[0];
    if (!arg) return true;
    
    const argType = this.getNodeType(arg);

    if (argType !== UcodeType.STRING && argType !== UcodeType.INTEGER && 
        argType !== UcodeType.DOUBLE && argType !== UcodeType.UNKNOWN) {
      this.errors.push({
        message: `int() expects string or number, got ${argType.toLowerCase()}`,
        start: arg.start,
        end: arg.end,
        severity: 'error'
      });
    }

    return true;
  }

  validateHexFunction(node: CallExpressionNode): boolean {
    if (node.arguments.length !== 1) {
      this.errors.push({
        message: `hex() expects 1 argument, got ${node.arguments.length}`,
        start: node.start,
        end: node.end,
        severity: 'error'
      });
      return true;
    }

    const arg = node.arguments[0];
    if (!arg) return true;
    
    const argType = this.getNodeType(arg);

    if (argType !== UcodeType.STRING && argType !== UcodeType.UNKNOWN) {
      this.errors.push({
        message: `hex() expects string, got ${argType.toLowerCase()}`,
        start: arg.start,
        end: arg.end,
        severity: 'error'
      });
    }

    return true;
  }

  validateChrFunction(node: CallExpressionNode): boolean {
    if (node.arguments.length !== 1) {
      this.errors.push({
        message: `chr() expects 1 argument, got ${node.arguments.length}`,
        start: node.start,
        end: node.end,
        severity: 'error'
      });
      return true;
    }

    const arg = node.arguments[0];
    if (!arg) return true;
    
    const argType = this.getNodeType(arg);

    // chr() should accept both strings and numbers (real testing shows both work)
    if (argType !== UcodeType.STRING && argType !== UcodeType.INTEGER && 
        argType !== UcodeType.DOUBLE && argType !== UcodeType.UNKNOWN) {
      this.errors.push({
        message: `chr() expects string or number, got ${argType.toLowerCase()}`,
        start: arg.start,
        end: arg.end,
        severity: 'error'
      });
    }

    return true;
  }

  validateOrdFunction(node: CallExpressionNode): boolean {
    if (node.arguments.length !== 1) {
      this.errors.push({
        message: `ord() expects 1 argument, got ${node.arguments.length}`,
        start: node.start,
        end: node.end,
        severity: 'error'
      });
      return true;
    }

    const arg = node.arguments[0];
    if (!arg) return true;
    
    const argType = this.getNodeType(arg);

    if (argType !== UcodeType.STRING && argType !== UcodeType.UNKNOWN) {
      this.errors.push({
        message: `ord() expects string, got ${argType.toLowerCase()}`,
        start: arg.start,
        end: arg.end,
        severity: 'error'
      });
    }

    return true;
  }

  validateUchrFunction(node: CallExpressionNode): boolean {
    if (node.arguments.length !== 1) {
      this.errors.push({
        message: `uchr() expects 1 argument, got ${node.arguments.length}`,
        start: node.start,
        end: node.end,
        severity: 'error'
      });
      return true;
    }

    const arg = node.arguments[0];
    if (!arg) return true;
    
    const argType = this.getNodeType(arg);

    if (argType !== UcodeType.STRING && argType !== UcodeType.INTEGER && 
        argType !== UcodeType.DOUBLE && argType !== UcodeType.UNKNOWN) {
      this.errors.push({
        message: `uchr() expects string or number, got ${argType.toLowerCase()}`,
        start: arg.start,
        end: arg.end,
        severity: 'error'
      });
    }

    return true;
  }

  validateRequireFunction(node: CallExpressionNode): boolean {
    if (node.arguments.length !== 1) {
      this.errors.push({
        message: `require() expects 1 argument, got ${node.arguments.length}`,
        start: node.start,
        end: node.end,
        severity: 'error'
      });
      return true;
    }

    const arg = node.arguments[0];
    if (!arg) return true;
    
    const argType = this.getNodeType(arg);

    if (argType !== UcodeType.STRING && argType !== UcodeType.UNKNOWN) {
      this.errors.push({
        message: `require() expects string, got ${argType.toLowerCase()}`,
        start: arg.start,
        end: arg.end,
        severity: 'error'
      });
    }

    return true;
  }

  validateIncludeFunction(node: CallExpressionNode): boolean {
    if (node.arguments.length !== 1) {
      this.errors.push({
        message: `include() expects 1 argument, got ${node.arguments.length}`,
        start: node.start,
        end: node.end,
        severity: 'error'
      });
      return true;
    }

    const arg = node.arguments[0];
    if (!arg) return true;
    
    const argType = this.getNodeType(arg);

    if (argType !== UcodeType.STRING && argType !== UcodeType.UNKNOWN) {
      this.errors.push({
        message: `include() expects string, got ${argType.toLowerCase()}`,
        start: arg.start,
        end: arg.end,
        severity: 'error'
      });
    }

    return true;
  }

  validateLoadfileFunction(node: CallExpressionNode): boolean {
    if (node.arguments.length !== 1) {
      this.errors.push({
        message: `loadfile() expects 1 argument, got ${node.arguments.length}`,
        start: node.start,
        end: node.end,
        severity: 'error'
      });
      return true;
    }

    const arg = node.arguments[0];
    if (!arg) return true;
    
    const argType = this.getNodeType(arg);

    if (argType !== UcodeType.STRING && argType !== UcodeType.UNKNOWN) {
      this.errors.push({
        message: `loadfile() expects string, got ${argType.toLowerCase()}`,
        start: arg.start,
        end: arg.end,
        severity: 'error'
      });
    }

    return true;
  }

  validateSourcepathFunction(node: CallExpressionNode): boolean {
    const argCount = node.arguments.length;
    
    // sourcepath(depth?: number, dironly?: boolean)
    // Both parameters are optional

    // ucode is permissive with argument counts, extra arguments are ignored.

    // Validate first parameter (depth) if present - should be number
    if (argCount >= 1) {
      this.validateNumericArgument(node.arguments[0], 'sourcepath', 1);
    }

    // No validation for the second parameter (dironly) because any type can be
    // evaluated as truthy or falsy at runtime in ucode.

    return true;
  }

  getErrors(): TypeError[] {
    return this.errors;
  }

  resetErrors(): void {
    this.errors = [];
  }

  getWarnings(): TypeWarning[] {
    return this.warnings;
  }

  resetWarnings(): void {
    this.warnings = [];
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