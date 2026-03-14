/**
 * Built-in function validation for ucode semantic analysis
 */

import { AstNode, CallExpressionNode, LiteralNode } from '../../ast/nodes';
import { UcodeType, UcodeDataType, createUnionType, createArrayType, isArrayType, getArrayElementType } from '../symbolTable';
import { TypeError, TypeWarning } from '../types';
import { UcodeErrorCode } from '../errorConstants';

export interface FormatSpecifier {
  specifier: string;
  expectedTypes: UcodeType[];
  position: number;
  endPosition: number;
  flags: string;
  width: string;
  precision: string;
  fullMatch: string;
}

/**
 * Parse printf-style format specifiers from a format string.
 * Returns an array of specifiers that consume arguments (excludes %%).
 */
export function parseFormatSpecifiers(format: string): FormatSpecifier[] {
  const specifiers: FormatSpecifier[] = [];
  // Match format specifiers: % [flags] [width] [.precision] [length] conversion
  // Flags: -, +, space, 0, #
  // Width/precision: digits or *
  // Length: h, hh, l, ll, z, j, t
  const formatRegex = /%([#0\- +]*)(\*|\d*)?(?:\.(\*|\d*))?(?:hh?|ll?|[zjt])?([diouxXeEfFgGaAcspJn%])/g;
  let match;
  while ((match = formatRegex.exec(format)) !== null) {
    const conversion = match[4]!;
    const fullMatch = match[0];
    const flags = match[1] || '';
    const width = match[2] || '';
    const precision = match[3] || '';
    const endPosition = match.index + fullMatch.length;

    if (conversion === '%') {
      // Include %% in results for hover (literal percent), but mark with empty expectedTypes
      specifiers.push({ specifier: '%', expectedTypes: [], position: match.index, endPosition, flags: '', width: '', precision: '', fullMatch });
      continue;
    }

    let expectedTypes: UcodeType[] = [];
    switch (conversion) {
      case 'd': case 'i': case 'u': case 'o': case 'x': case 'X':
        expectedTypes = [UcodeType.INTEGER, UcodeType.DOUBLE, UcodeType.BOOLEAN];
        break;
      case 'e': case 'E': case 'f': case 'F': case 'g': case 'G': case 'a': case 'A':
        expectedTypes = [UcodeType.INTEGER, UcodeType.DOUBLE, UcodeType.BOOLEAN];
        break;
      case 'c':
        expectedTypes = [UcodeType.INTEGER, UcodeType.STRING];
        break;
      case 's':
        expectedTypes = []; // ucode auto-casts all types to string — skip type check
        break;
      case 'J': case 'n': case 'p':
        expectedTypes = []; // any type is valid
        break;
    }

    // If width or precision uses *, that consumes an extra argument (integer)
    if (match[2] === '*') {
      specifiers.push({ specifier: '*', expectedTypes: [UcodeType.INTEGER], position: match.index, endPosition, flags, width, precision, fullMatch });
    }
    if (match[3] === '*') {
      specifiers.push({ specifier: '*', expectedTypes: [UcodeType.INTEGER], position: match.index, endPosition, flags, width, precision, fullMatch });
    }

    specifiers.push({ specifier: conversion, expectedTypes, position: match.index, endPosition, flags, width, precision, fullMatch });
  }
  return specifiers;
}

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
  public narrowedReturnType: UcodeDataType | null = null;
  public inTruthinessContext = false;
  private strictMode = false;

  constructor() {}

  setStrictMode(strict: boolean): void {
    this.strictMode = strict;
  }

  /** Push a definite type mismatch diagnostic — always an error */
  private pushTypeMismatch(message: string, start: number, end: number): void {
    this.errors.push({ message, start, end, severity: 'error' });
  }

  /**
   * Set narrowedReturnType based on whether the argument matches valid types.
   * - Valid type → returnTypeIfValid (e.g., INTEGER, ARRAY, STRING)
   * - Unknown → returnTypeIfValid | null (could be valid or not)
   * - Union with some valid types → returnTypeIfValid | null
   * - Known invalid type → NULL (C function returns NULL)
   */
  private narrowForArgType(arg: AstNode | undefined, validTypes: UcodeType[], returnTypeIfValid: UcodeType): void {
    if (!arg) return;
    const argType = this.getNodeType(arg);
    if (validTypes.includes(argType as UcodeType)) {
      this.narrowedReturnType = returnTypeIfValid;
    } else if (argType === UcodeType.UNKNOWN) {
      // Unknown arg could be any type — return includes null since C returns NULL for wrong types
      this.narrowedReturnType = createUnionType([returnTypeIfValid, UcodeType.NULL]) as UcodeType;
    } else if (argType.includes(' | ')) {
      const argTypes = argType.split(' | ').map(t => t.trim());
      const allValid = argTypes.every(t => validTypes.includes(t as UcodeType));
      if (allValid) {
        this.narrowedReturnType = returnTypeIfValid;
      } else {
        // Some types would cause NULL return
        this.narrowedReturnType = createUnionType([returnTypeIfValid, UcodeType.NULL]) as UcodeType;
      }
    } else {
      this.narrowedReturnType = UcodeType.NULL;
    }
  }

  /**
   * If the narrowedReturnType is plain ARRAY and the argument has a known ArrayType,
   * upgrade to preserve element type information.
   */
  private preserveArrayElementType(arg: AstNode | undefined): void {
    if (!arg || this.narrowedReturnType !== UcodeType.ARRAY) return;
    const fullType = this.getNodeFullType(arg);
    if (fullType && isArrayType(fullType)) {
      this.narrowedReturnType = fullType;
    }
  }

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
      this.pushTypeMismatch(
        `Argument ${argPosition} of ${funcName}() cannot be a ${argType.toLowerCase()}. It must be a value convertible to a number.`,
        arg.start, arg.end
      );
      return false;
    }

    if (argType === UcodeType.STRING && arg.type === 'Literal') {
      const literal = arg as LiteralNode;
      if (typeof literal.value === 'string' && !isNumberLikeString(literal.value)) {
        this.pushTypeMismatch(
          `String "${literal.value}" cannot be converted to a number for ${funcName}() argument ${argPosition}.`,
          arg.start, arg.end
        );
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
    toleratedTypes?: UcodeType[],
    customErrorMessage?: string
  ): boolean {
    if (!arg) {
      return true; // Argument presence should be checked before this call
    }

    // Detect || fallback pattern: int(s.timeout || '600')
    // The problem is the left side's type, not the fallback — narrow diagnostic range accordingly.
    let diagStart = arg.start;
    let diagEnd = arg.end;
    let fallbackStart: number | null = null;
    let fallbackEnd: number | null = null;
    let fallbackValid = false;

    if ((arg as any).operator === '||' && (arg as any).left && (arg as any).right) {
      const fallbackType = this.getNodeType((arg as any).right);
      const fallbackTypes = fallbackType.split(' | ').map((t: string) => t.trim());
      fallbackValid = fallbackTypes.every(t => allowedTypes.includes(t as UcodeType));

      // Always narrow diagnostic to left operand — the fallback isn't the problem
      diagStart = (arg as any).left.start;
      diagEnd = (arg as any).left.end;
      fallbackStart = (arg as any).right.start;
      fallbackEnd = (arg as any).right.end;

      // In non-strict mode, valid fallback suppresses the diagnostic entirely
      if (fallbackValid && !this.strictMode) {
        return true;
      }
    }

    const argType = this.getNodeType(arg);

    // toleratedTypes: types that don't trigger warnings but don't appear in "narrow to" messages.
    // e.g. length() tolerates null (returns null safely), so array | null → no diagnostic.
    // In strict mode ('use strict'), no tolerance — null and unknown are always errors.
    const effectiveAllowed = (toleratedTypes && !this.strictMode) ? [...allowedTypes, ...toleratedTypes] : allowedTypes;

    // Check if argType is a union type
    const argTypes = argType.split(' | ').map(t => t.trim());
    const isUnion = argTypes.length > 1;

    if (isUnion) {
      // For union types, check if ANY type is allowed
      const hasAllowedType = argTypes.some(t =>
        t !== UcodeType.UNKNOWN && effectiveAllowed.includes(t as UcodeType)
      );
      const disallowedTypes = argTypes.filter(t =>
        !effectiveAllowed.includes(t as UcodeType)
      );

      if (!hasAllowedType && !argTypes.includes(UcodeType.UNKNOWN)) {
        // None of the types in the union are allowed — definitely wrong, always error
        const message = customErrorMessage ||
          `Function '${funcName}' expects ${allowedTypes.join(' or ')} for argument ${argPosition}, but got ${argType.toLowerCase()}`;

        this.errors.push({ message, start: diagStart, end: diagEnd, severity: 'error' });
        return false;
      } else if (disallowedTypes.length > 0) {
        // Some types are allowed, some are not - WARNING (error in strict mode)
        const message = customErrorMessage ||
          `Argument ${argPosition} of ${funcName}() may be ${disallowedTypes.join(' | ')}. Use a type guard to narrow to ${allowedTypes.join(' | ')}.`;

        // For || fallback, get the variable name from the left operand
        const variableName = fallbackStart != null ? this.getVariableName((arg as any).left) : this.getVariableName(arg);

        const diagData: Record<string, any> = {
          functionName: funcName,
          argumentIndex: argPosition - 1,
          expectedType: allowedTypes.join(' | '),
          expectedTypes: [...allowedTypes],
          actualType: argType,
          variableName: variableName,
          argumentOffset: diagStart
        };
        if (toleratedTypes && toleratedTypes.length > 0) {
          diagData.toleratedTypes = [...toleratedTypes];
        }
        if (fallbackValid && fallbackStart != null && fallbackEnd != null) {
          diagData.fallbackStart = fallbackStart;
          diagData.fallbackEnd = fallbackEnd;
          diagData.fullExprStart = arg.start;
          diagData.fullExprEnd = arg.end;
        }
        if (this.strictMode) {
          this.errors.push({
            message, start: diagStart, end: diagEnd,
            severity: 'error', code: 'nullable-argument', data: diagData
          });
        } else {
          this.warnings.push({
            message, start: diagStart, end: diagEnd,
            severity: 'warning', code: 'nullable-argument', data: diagData
          });
        }
      }
    } else if (argType === UcodeType.UNKNOWN) {
      // Unknown type — could be anything.
      // Suppress warning in truthiness context (e.g., if (!length(x))) since builtins
      // safely return null for invalid types, making this a valid type-check pattern.
      // In strict mode, always warn — no suppressions.
      if (this.strictMode || !this.inTruthinessContext) {
        const message = customErrorMessage ||
          `Argument ${argPosition} of ${funcName}() is unknown. Use a type guard to narrow to ${allowedTypes.join(' | ')}.`;

        const variableName = fallbackStart != null ? this.getVariableName((arg as any).left) : this.getVariableName(arg);

        const diagData: Record<string, any> = {
          functionName: funcName,
          argumentIndex: argPosition - 1,
          expectedType: allowedTypes.join(' | '),
          expectedTypes: [...allowedTypes],
          actualType: argType,
          variableName: variableName,
          argumentOffset: diagStart
        };
        if (toleratedTypes && toleratedTypes.length > 0) {
          diagData.toleratedTypes = [...toleratedTypes];
        }
        if (fallbackValid && fallbackStart != null && fallbackEnd != null) {
          diagData.fallbackStart = fallbackStart;
          diagData.fallbackEnd = fallbackEnd;
          diagData.fullExprStart = arg.start;
          diagData.fullExprEnd = arg.end;
        }
        if (this.strictMode) {
          this.errors.push({
            message, start: diagStart, end: diagEnd,
            severity: 'error', code: 'incompatible-function-argument', data: diagData
          });
        } else {
          this.warnings.push({
            message, start: diagStart, end: diagEnd,
            severity: 'warning', code: 'incompatible-function-argument', data: diagData
          });
        }
      }
    } else {
      // Single known type - check if it's allowed
      if (!effectiveAllowed.includes(argType as UcodeType)) {
        // Definitely wrong — always error
        const message = customErrorMessage ||
          `Function '${funcName}' expects ${allowedTypes.join(' or ')} for argument ${argPosition}, but got ${argType.toLowerCase()}`;

        this.errors.push({ message, start: diagStart, end: diagEnd, severity: 'error' });
        return false;
      }
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

  /**
   * Extract variable name from an argument node for CFG-based type narrowing.
   * Returns null if the argument is not a simple identifier.
   */
  private getVariableName(node: AstNode): string | null {
    if (node.type === 'Identifier') {
      return (node as any).name;
    }
    // For member expressions, return the dotted path (e.g., "data.platform")
    if (node.type === 'MemberExpression') {
      return this.getDottedPath(node);
    }
    // For X || fallback patterns, extract the variable from the left side
    if (node.type === 'BinaryExpression') {
      const bin = node as any;
      if (bin.operator === '||' || bin.operator === '??') {
        return this.getVariableName(bin.left);
      }
    }
    return null;
  }

  private getDottedPath(node: AstNode): string | null {
    if (node.type === 'Identifier') return (node as any).name;
    if (node.type === 'MemberExpression') {
      const member = node as any;
      if (member.computed) return null;
      const objPath = this.getDottedPath(member.object);
      if (!objPath) return null;
      if (member.property?.type === 'Identifier')
        return `${objPath}.${member.property.name}`;
      return null;
    }
    return null;
  }

  validateLengthFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'length', 1)) return true;
    const arg = node.arguments[0];
    this.narrowForArgType(arg, [UcodeType.STRING, UcodeType.ARRAY, UcodeType.OBJECT], UcodeType.INTEGER);
    // length(null) safely returns null — tolerate null so array|null doesn't warn.
    // Unknown still warns: unresolved types deserve attention even in truthiness context.
    this.validateArgumentType(arg, 'length', 1, [UcodeType.STRING, UcodeType.ARRAY, UcodeType.OBJECT],
      [UcodeType.NULL]);
    return true;
  }

  validateIndexFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'index', 2)) return true;
    this.narrowForArgType(node.arguments[0], [UcodeType.STRING, UcodeType.ARRAY], UcodeType.INTEGER);
    this.validateArgumentType(node.arguments[0], 'index', 1, [UcodeType.STRING, UcodeType.ARRAY]);
    return true;
  }

  validateRindexFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'rindex', 2)) return true;
    this.narrowForArgType(node.arguments[0], [UcodeType.STRING, UcodeType.ARRAY], UcodeType.INTEGER);
    this.validateArgumentType(node.arguments[0], 'rindex', 1, [UcodeType.STRING, UcodeType.ARRAY]);
    return true;
  }

  validateMatchFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'match', 2)) return true;
    // C: returns NULL if pattern not regex or subject missing
    this.narrowForArgType(node.arguments[1], [UcodeType.REGEX], UcodeType.ARRAY);
    // Upgrade to array<string> if valid
    if (this.narrowedReturnType === UcodeType.ARRAY) {
      this.narrowedReturnType = createArrayType(UcodeType.STRING);
    }
    this.validateArgumentType(node.arguments[0], 'match', 1, [UcodeType.STRING]); // Include UcodeType.OBJECT when it includes tostring()

    // Custom check for argument 2: suggest regex conversion if a string literal is passed
    const regexArg = node.arguments[1];
    if (regexArg) {
      const regexArgType = this.getNodeType(regexArg);
      if (regexArgType !== UcodeType.REGEX && regexArgType !== UcodeType.UNKNOWN) {
        if (regexArg.type === 'Literal') {
          const literal = regexArg as any;
          if (literal.literalType === 'string') {
            const value = literal.value as string;
            this.pushTypeMismatch(
              `Function 'match' expects regex for argument 2, but got string.\nDid you mean: /${value}/`,
              regexArg.start, regexArg.end
            );
            return true;
          }
        }
        this.validateArgumentType(regexArg, 'match', 2, [UcodeType.REGEX]);
      }
    }

    return true;
  }

  validateSplitFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'split', 2)) return true;
    const textArg = node.arguments[0];
    const separatorArg = node.arguments[1];

    // split() returns NULL when first arg is not string or separator is not string/regex.
    // Only return array<string> when both args are confirmed correct types.
    const textType = textArg ? this.getNodeType(textArg) : UcodeType.UNKNOWN;
    const sepType = separatorArg ? this.getNodeType(separatorArg) : UcodeType.UNKNOWN;
    const textIsString = textType === UcodeType.STRING;
    const sepIsValid = sepType === UcodeType.STRING || sepType === UcodeType.REGEX;

    if (textIsString && sepIsValid) {
      this.narrowedReturnType = createArrayType(UcodeType.STRING);
    } else {
      // Could return null — use array | null (without element type info for uncertain case)
      this.narrowedReturnType = createUnionType([UcodeType.ARRAY, UcodeType.NULL]) as UcodeType;
    }

    if (textArg) {
      this.validateArgumentType(textArg, 'split', 1, [UcodeType.STRING]);
    }

    if (separatorArg) {
      // In ucode, split() can accept string or regex pattern as separator
      this.validateArgumentType(separatorArg, 'split', 2, [UcodeType.STRING, UcodeType.REGEX]);
    }

    // Optional third argument (limit) should be a number
    if (node.arguments.length === 3) {
      const limitArg = node.arguments[2];
      if (limitArg) {
        this.validateArgumentType(limitArg, 'split', 3, [UcodeType.INTEGER]);
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

    this.validateArgumentType(arg, 'loadstring', 1, [UcodeType.STRING]);
    return true;
  }

  validateHexencFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'hexenc', 1)) return true;
    // First argument is converted to string - all types are valid
    return true;
  }

  validateJoinFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'join', 2)) return true;
    if (node.arguments[1]) this.narrowForArgType(node.arguments[1], [UcodeType.ARRAY], UcodeType.STRING);
    this.validateArgumentType(node.arguments[0], 'join', 1, [UcodeType.STRING]);
    this.validateArgumentType(node.arguments[1], 'join', 2, [UcodeType.ARRAY]);
    return true;
  }

  validateExistsFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'exists', 2)) return true;
    // exists() is an introspection function — tolerates null/unknown even in strict mode.
    // exists(null, "key") safely returns false.  Still error on definitely wrong types
    // like exists(42, "key").
    this.validateExistsArg(node.arguments[0]);
    this.validateArgumentType(node.arguments[1], 'exists', 2, [UcodeType.STRING]);
    return true;
  }

  /** Validate exists() first arg: allow object, null, unknown; error on other types */
  private validateExistsArg(arg: CallExpressionNode['arguments'][0] | undefined): void {
    if (!arg) return;
    const argType = this.getNodeType(arg);
    const argTypes = argType.split(' | ').map(t => t.trim());
    // Accept object, null, unknown — reject everything else
    const exempt = [UcodeType.OBJECT as string, UcodeType.NULL as string, UcodeType.UNKNOWN as string];
    const bad = argTypes.filter(t => !exempt.includes(t));
    if (bad.length > 0 && bad.length === argTypes.length) {
      // ALL types are bad — definitely wrong
      this.errors.push({
        message: `Function 'exists' expects object for argument 1, but got ${argType.toLowerCase()}`,
        start: arg.start, end: arg.end, severity: 'error'
      });
    } else if (bad.length > 0) {
      // Mix of valid and invalid — warning only if not all exempt
      const hasObject = argTypes.includes(UcodeType.OBJECT);
      if (!hasObject && !argTypes.includes(UcodeType.UNKNOWN)) {
        this.errors.push({
          message: `Function 'exists' expects object for argument 1, but got ${argType.toLowerCase()}`,
          start: arg.start, end: arg.end, severity: 'error'
        });
      }
    }
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

    // C: returns NULL if pattern not string or subject missing; returns boolean otherwise
    // 1st arg: any; because everything is convertible to string.
    // 2nd arg: must be string
    this.narrowForArgType(node.arguments[1], [UcodeType.STRING], UcodeType.BOOLEAN);
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

            // NEW: remember whether it's a negated set
            const negated = (j < pattern.length && (pattern[j] === '!' || pattern[j] === '^'));
            if (negated) j++;

            // CHANGED: treat a leading ']' as literal ONLY if there's another ']' to close later
            if (j < pattern.length && pattern[j] === ']') {
              const hasAnotherClosing = pattern.indexOf(']', j + 1) !== -1;
              if (hasAnotherClosing) {
                hadItemBeforeDash = true;
                lastLiteralForRange = ']';
                j++;
              }
              // else: don't consume it here; it will act as the closer below,
              // which will make the set empty and we'll issue a specific error
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
                const classStart = j + 2;               // points at first char of the name
                const end = pattern.indexOf(':]', classStart);

                if (end === -1) {
                  // See if the user likely wrote "[[:name]]" (missing the second ':')
                  const plainClose = pattern.indexOf(']', j + 2);
                  if (plainClose !== -1) {
                    const name = pattern.slice(classStart, plainClose);
                    const lower = name.toLowerCase();
                    const isKnown = POSIX_CLASSES.has(name) || POSIX_CLASSES.has(lower);

                    if (isKnown) {
                      pushDiag(
                        'error',
                        `POSIX character class appears to be missing the trailing ':]'.` +
                        (isKnown ? ` Did you mean '[[:${lower}:]]'?` : ` Use the form '[[:class:]]'.`),
                        j, plainClose + 1
                      );
                    }


                    // keep scanning; let ']' be handled by the normal closer
                    j += 1;
                    continue;
                  }

                  // no ']' at all → truly unterminated
                  pushDiag(
                    'error',
                    `Unterminated character class. Expected ':]' to close '[:class:]'. Add ':]' to close the class.`,
                    j, Math.min(j + 2, pattern.length)
                  );
                  j += 1;
                  continue;
                } else {
                  const name = pattern.slice(classStart, end);
                  const isKnown = POSIX_CLASSES.has(name) || POSIX_CLASSES.has(name.toLowerCase());
                  if (!isKnown) {
                    const lower = name.toLowerCase();
                    const suggestion = POSIX_CLASSES.has(lower) ? ` Did you mean '[:${lower}:]'?` : '';
                    pushDiag(
                      'error',
                      `Unknown POSIX character class '[:${name}:]'. Allowed: ${Array.from(POSIX_CLASSES).join(', ')}.` + suggestion,
                      j, end + 2
                    );
                  }
                  hadItemBeforeDash = true;
                  lastLiteralForRange = null;
                  j = end + 2; // skip past ':]'
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
                    }
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
            } // end while

            if (!closed) {
              // keep your existing "unclosed" handling for truly unterminated cases
              pushDiag('error',
                `Unclosed bracket expression. Add a matching ']' to close the '[' opened here.`,
                openPos);
              i = openPos + 1;
              continue;
            } else {
              // NEW: empty-content checks after a successful close
              if (!hadItemBeforeDash) {
                if (negated) {
                  // e.g. "[!]" or "[^]"
                  pushDiag(
                    'error',
                    `Negated bracket expression has no items. Add at least one character, range, or class (e.g., '[!a-z]', '[^[:digit:]]'). To exclude only ']', write '[!]]' or '[^]]'.`,
                    openPos, j
                  );
                } else {
                  // e.g. "[]"
                  pushDiag(
                    'error',
                    `Empty bracket expression '[]' is invalid. To match a literal ']', use '[]]' (']' as the first item), or escape ']' outside brackets as '\\]'.`,
                    openPos, j
                  );
                }
              }

              sawWildcard = true;

              // keep your existing naked POSIX token check
              const inner = pattern.slice(openPos + 1, j - 1);
              const m = /^:([A-Za-z]+):$/.exec(inner);
              if (m && m[1]) {
                const name = m[1];
                const lower = name.toLowerCase();
                if (POSIX_CLASSES.has(name) || POSIX_CLASSES.has(lower)) {
                  pushDiag(
                    'error',
                    `POSIX character class used without outer brackets. Use '[[:${lower}:]]', not '[:${name}:]'.`,
                    openPos, j
                  );
                } else {
                  pushDiag(
                    'warning',
                    `Looks like a POSIX character class '[:${name}:]' used without outer brackets, but '${name}' is not a standard POSIX class. Allowed: ${Array.from(POSIX_CLASSES).join(', ')}.`,
                    openPos, j
                  );
                }
              }
              console.log(lastLiteralForRange);
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
    this.validateArgumentType(node.arguments[0], 'timelocal', 1, [UcodeType.OBJECT]);
    return true;
  }

  validateTypelocalFunction(node: CallExpressionNode): boolean {
    this.checkArgumentCount(node, 'type', 1);
    return true;
  }

  validateTimegmFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'timegm', 1)) return true;
    this.validateArgumentType(node.arguments[0], 'timegm', 1, [UcodeType.OBJECT]);
    return true;
  }

  validateJsonFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'json', 1)) return true;
    this.validateArgumentType(
      node.arguments[0],
      'json',
      1,
      [UcodeType.STRING, UcodeType.OBJECT],
      undefined,
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

  validateClockFunction(node: CallExpressionNode): boolean {
    if (node.arguments[0])
      this.isKnownTruish(node.arguments[0]);
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
                this.pushTypeMismatch(`signal() first parameter cannot be a double`, signalArg.start, signalArg.end);
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
    this.narrowForArgType(node.arguments[0], [UcodeType.ARRAY], UcodeType.ARRAY);
    this.preserveArrayElementType(node.arguments[0]);
    this.validateArgumentType(node.arguments[0], 'uniq', 1, [UcodeType.ARRAY]);
    return true;
  }

  validatePrintfFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'printf', 1)) return true;
    this.validateArgumentType(node.arguments[0], 'printf', 1, [UcodeType.STRING]);
    this.validateFormatString(node, 'printf');
    return true;
  }

  validateSprintfFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'sprintf', 1)) return true;
    this.validateArgumentType(node.arguments[0], 'sprintf', 1, [UcodeType.STRING]);
    this.validateFormatString(node, 'sprintf');
    return true;
  }

  private validateFormatString(node: CallExpressionNode, funcName: string): void {
    const formatArg = node.arguments[0];
    if (!formatArg || formatArg.type !== 'Literal') return;
    const literal = formatArg as LiteralNode;
    if (typeof literal.value !== 'string') return;

    const allSpecifiers = parseFormatSpecifiers(literal.value);
    const specifiers = allSpecifiers.filter(s => s.specifier !== '%'); // exclude %% (literal percent)
    const dataArgs = node.arguments.slice(1); // arguments after the format string
    const specCount = specifiers.length;
    const argCount = dataArgs.length;

    // Count mismatch check
    if (specCount > argCount) {
      this.warnings.push({
        message: `${funcName}(): format string has ${specCount} specifier(s) but only ${argCount} argument(s) provided`,
        start: formatArg.start,
        end: formatArg.end,
        severity: 'warning',
        code: UcodeErrorCode.FORMAT_ARG_COUNT_MISMATCH
      });
    } else if (specCount < argCount) {
      // Extra arguments are silently ignored — lower severity warning
      const firstExtra = dataArgs[specCount]!;
      const lastExtra = dataArgs[argCount - 1]!;
      this.warnings.push({
        message: `${funcName}(): format string has ${specCount} specifier(s) but ${argCount} argument(s) provided (extra arguments are ignored)`,
        start: firstExtra.start,
        end: lastExtra.end,
        severity: 'warning',
        code: UcodeErrorCode.FORMAT_ARG_COUNT_MISMATCH
      });
    }

    // Type mismatch check for each specifier
    for (let i = 0; i < Math.min(specCount, argCount); i++) {
      const spec = specifiers[i]!;
      if (spec.expectedTypes.length === 0) continue; // %s, %J, etc. accept any type

      const arg = dataArgs[i];
      if (!arg) continue;

      const argType = this.getNodeType(arg);
      if (argType === UcodeType.UNKNOWN || argType.includes(' | ')) continue; // Don't flag unknowns or unions

      if (!spec.expectedTypes.includes(argType as UcodeType)) {
        const expectedStr = spec.expectedTypes.map(t => t.toLowerCase()).join(' or ');
        this.warnings.push({
          message: `${funcName}(): argument ${i + 2} has type '${argType.toLowerCase()}' but format specifier '%${spec.specifier}' expects ${expectedStr}`,
          start: arg.start,
          end: arg.end,
          severity: 'warning',
          code: UcodeErrorCode.FORMAT_TYPE_MISMATCH
        });
      }
    }
  }

  validateIptoarrFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'iptoarr', 1)) return true;
    this.narrowForArgType(node.arguments[0], [UcodeType.STRING], UcodeType.ARRAY);
    // iptoarr() always returns array<integer> (IP octets)
    if (this.narrowedReturnType === UcodeType.ARRAY) {
      this.narrowedReturnType = createArrayType(UcodeType.INTEGER);
    }
    this.validateArgumentType(node.arguments[0], 'iptoarr', 1, [UcodeType.STRING]);
    return true;
  }

  validateArrtoipFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'arrtoip', 1)) return true;
    this.narrowForArgType(node.arguments[0], [UcodeType.ARRAY], UcodeType.STRING);
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

    if (node.arguments[0]) {
      this.validateArgumentType(node.arguments[0], 'int', 1, [UcodeType.STRING, UcodeType.INTEGER, UcodeType.DOUBLE]);
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

    if (node.arguments[0]) {
      this.validateArgumentType(node.arguments[0], 'hex', 1, [UcodeType.STRING]);
    }
    return true;
  }

  validateChrFunction(node: CallExpressionNode): boolean {
    if (this.checkArgumentCount(node, 'chr', 1) && node.arguments[0]) {
      for (let i = 0; i < node.arguments.length; i++) {
        const arg = node.arguments[i];
        if (arg) {
          this.validateNumericArgument(arg, 'chr', i);
        }
      }
    }
    return true;
  }

  validateOrdFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'ord', 1)) return true;

    if (node.arguments.length >= 1 && node.arguments[0]) {
      this.narrowForArgType(node.arguments[0], [UcodeType.STRING], UcodeType.INTEGER);
      this.validateArgumentType(node.arguments[0], 'ord', 1, [UcodeType.STRING]);
      if (node.arguments.length >= 2 && node.arguments[1]) {
        this.validateArgumentType(node.arguments[1], 'ord', 2, [UcodeType.INTEGER, UcodeType.DOUBLE]);
      }
    }

    return true;
  }

  validateUchrFunction(node: CallExpressionNode): boolean {
    this.checkArgumentCount(node, 'uchr', 1);
    if (node.arguments[0]) {
      this.validateArgumentType(node.arguments[0], 'uchr', 1, [UcodeType.STRING, UcodeType.INTEGER, UcodeType.DOUBLE]);
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

    if (node.arguments[0]) {
      this.validateArgumentType(node.arguments[0], 'require', 1, [UcodeType.STRING]);
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

    if (node.arguments[0]) {
      this.validateArgumentType(node.arguments[0], 'include', 1, [UcodeType.STRING]);
    }
    return true;
  }

  validateHexdecFunction(node: CallExpressionNode): boolean {
    if (this.checkArgumentCount(node, 'hexdec', 1) && node.arguments[0]) {
      this.narrowForArgType(node.arguments[0], [UcodeType.STRING], UcodeType.STRING);
      this.validateArgumentType(node.arguments[0], 'hexdec', 1, [UcodeType.STRING]);
    }
    return true;
  }

  validateB64encFunction(node: CallExpressionNode): boolean {
    if (this.checkArgumentCount(node, 'b64enc', 1) && node.arguments[0]) {
      this.narrowForArgType(node.arguments[0], [UcodeType.STRING], UcodeType.STRING);
      this.validateArgumentType(node.arguments[0], 'b64enc', 1, [UcodeType.STRING]);
    }
    return true;
  }

  validateB64decFunction(node: CallExpressionNode): boolean {
    if (this.checkArgumentCount(node, 'b64dec', 1) && node.arguments[0]) {
      this.narrowForArgType(node.arguments[0], [UcodeType.STRING], UcodeType.STRING);
      this.validateArgumentType(node.arguments[0], 'b64dec', 1, [UcodeType.STRING]);
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

    // C: returns NULL if path not string; returns compiled function otherwise
    this.narrowForArgType(arg, [UcodeType.STRING], UcodeType.FUNCTION);
    this.validateArgumentType(arg, 'loadfile', 1, [UcodeType.STRING]);

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
      if (argCount >= 2 && node.arguments[1]) {
        this.isKnownTruish(node.arguments[1]);
      }
    }

    // No validation for the second parameter (dironly) because any type can be
    // evaluated as truthy or falsy at runtime in ucode.

    return true;
  }

  validateGcFunction(node: CallExpressionNode): boolean {
    const argCount = node.arguments.length;
    
    // sourcepath(depth?: number, dironly?: boolean)
    // Both parameters are optional

    // ucode is permissive with argument counts, extra arguments are ignored.

    // Validate first parameter (depth) if present - should be number
    if (argCount >= 1 && node.arguments[0] && node.arguments[0].type === "Literal") {
      const literalCommand = node.arguments[0] as LiteralNode;
      if (typeof literalCommand.value === 'string' && 
        literalCommand.value !== 'collect' && 
        literalCommand.value !== 'start' && 
        literalCommand.value !== 'stop' && 
        literalCommand.value !== 'count') {
        this.errors.push(
        {
          message: `Invalid garbage collection command "${literalCommand.value}". Did you mean 'collect', or 'start', 'stop', or 'count'?`,
          start: node.arguments[0].start,
          end: node.arguments[0].end,
          severity: 'error' 
        });
      }
      if (argCount >= 2 && node.arguments[1]) {
        if ((node.arguments[1] as AstNode).type === "Literal") {
          const literalArgument = node.arguments[1] as LiteralNode;
          var message: string = '';
          var error: boolean = false;
          if (typeof literalCommand.value === 'string' && literalCommand.value === 'start') {
            if ((typeof literalArgument.value) === 'number') {
              if (literalArgument.value < 0 || literalArgument.value > 65535) {
                message = `Invalid garbage collection interval ${literalArgument.value}. The acceptable range is 1-65535. 0 for default (1000).`;
                error = true;
              }
            } else if ((typeof node.arguments[1]) === 'number') {

            } else {
                message = `Invalid garbage collection interval ${literalArgument.value} of type ${typeof literalArgument.value}. The acceptable range is 1-65535. 0 for default (1000).`;
                error = true;
            }
          } else {
              message = `Invalid garbage collection argument ${literalArgument.value}. Argument is only used for 'start' command.`;
              error = true;
          }
          if (error)
            this.errors.push(
            { 
              message: message,
              start: node.arguments[1].start,
              end: node.arguments[1].end,
              severity: 'error'
            });
        } else if ((node.arguments[1] as AstNode).type === "Identifier") {
          // ToDo- Advanced type inference
        }
      }
    }

    // No validation for the second parameter (dironly) because any type can be
    // evaluated as truthy or falsy at runtime in ucode.

    return true;
  }

  validatePushFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'push', 1)) return true;
    // C: returns NULL if not mutable array; returns last pushed value otherwise
    this.validateArgumentType(node.arguments[0], 'push', 1, [UcodeType.ARRAY]);
    // Return type is the last pushed value
    if (node.arguments.length >= 2) {
      const lastArg = node.arguments[node.arguments.length - 1];
      if (lastArg) {
        const fullType = this.getNodeFullType(lastArg);
        if (fullType) {
          this.narrowedReturnType = fullType;
        } else {
          const basicType = this.getNodeType(lastArg);
          if (basicType !== UcodeType.UNKNOWN) {
            this.narrowedReturnType = basicType;
          }
        }
      }
    }
    return true;
  }

  validatePopFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'pop', 1)) return true;
    // C: returns NULL if not mutable array; returns popped element otherwise
    const fullType = node.arguments[0] ? this.getNodeFullType(node.arguments[0]) : null;
    if (fullType && isArrayType(fullType)) {
      this.narrowedReturnType = getArrayElementType(fullType);
    }
    this.validateArgumentType(node.arguments[0], 'pop', 1, [UcodeType.ARRAY]);
    return true;
  }

  validateShiftFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'shift', 1)) return true;
    // C: returns NULL if not mutable array; returns shifted element otherwise
    const fullType = node.arguments[0] ? this.getNodeFullType(node.arguments[0]) : null;
    if (fullType && isArrayType(fullType)) {
      this.narrowedReturnType = getArrayElementType(fullType);
    }
    this.validateArgumentType(node.arguments[0], 'shift', 1, [UcodeType.ARRAY]);
    return true;
  }

  validateUnshiftFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'unshift', 1)) return true;
    // C: returns NULL if not mutable array; returns last value added otherwise
    this.validateArgumentType(node.arguments[0], 'unshift', 1, [UcodeType.ARRAY]);
    // Return type is the last unshifted value
    if (node.arguments.length >= 2) {
      const lastArg = node.arguments[node.arguments.length - 1];
      if (lastArg) {
        const fullType = this.getNodeFullType(lastArg);
        if (fullType) {
          this.narrowedReturnType = fullType;
        } else {
          const basicType = this.getNodeType(lastArg);
          if (basicType !== UcodeType.UNKNOWN) {
            this.narrowedReturnType = basicType;
          }
        }
      }
    }
    return true;
  }

  validateSliceFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'slice', 2)) return true;

    // First parameter must be array
    this.narrowForArgType(node.arguments[0], [UcodeType.ARRAY], UcodeType.ARRAY);
    this.preserveArrayElementType(node.arguments[0]);
    this.validateArgumentType(node.arguments[0], 'slice', 1, [UcodeType.ARRAY]);

    // Second parameter (start index) must be number
    this.validateArgumentType(node.arguments[1], 'slice', 2, [UcodeType.INTEGER, UcodeType.DOUBLE]);
    
    // Third parameter (end index) is optional but must be number if present
    if (node.arguments.length >= 3 && node.arguments[2]) {
      this.validateArgumentType(node.arguments[2], 'slice', 3, [UcodeType.INTEGER, UcodeType.DOUBLE]);
    }
    
    return true;
  }

  validateSpliceFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'splice', 2)) return true;

    // First parameter must be array
    this.narrowForArgType(node.arguments[0], [UcodeType.ARRAY], UcodeType.ARRAY);
    this.preserveArrayElementType(node.arguments[0]);
    this.validateArgumentType(node.arguments[0], 'splice', 1, [UcodeType.ARRAY]);
    
    // Second parameter (start index) must be number
    this.validateArgumentType(node.arguments[1], 'splice', 2, [UcodeType.INTEGER, UcodeType.DOUBLE]);
    
    // Third parameter (delete count) is optional but must be number if present
    if (node.arguments.length >= 3 && node.arguments[2]) {
      this.validateArgumentType(node.arguments[2], 'splice', 3, [UcodeType.INTEGER, UcodeType.DOUBLE]);
    }
    
    // Additional parameters are items to insert - any type is allowed
    return true;
  }

  validateSortFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'sort', 1)) return true;

    // First parameter must be array
    this.narrowForArgType(node.arguments[0], [UcodeType.ARRAY], UcodeType.ARRAY);
    this.preserveArrayElementType(node.arguments[0]);
    this.validateArgumentType(node.arguments[0], 'sort', 1, [UcodeType.ARRAY]);
    
    // Second parameter (comparator) is optional but must be function if present
    if (node.arguments.length >= 2 && node.arguments[1]) {
      this.validateArgumentType(node.arguments[1], 'sort', 2, [UcodeType.FUNCTION]);
    }
    
    return true;
  }

  validateReverseFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'reverse', 1)) return true;
    // reverse() return type depends on input: array→array, string→string, other→null
    const arg = node.arguments[0];
    const argType = this.getNodeType(arg);
    if (argType === UcodeType.ARRAY) {
      this.narrowedReturnType = UcodeType.ARRAY;
      this.preserveArrayElementType(arg);
    } else if (argType === UcodeType.STRING) {
      this.narrowedReturnType = UcodeType.STRING;
    } else if (argType === UcodeType.UNKNOWN) {
      // Unknown arg could be any type — include null since C returns NULL for wrong types
      this.narrowedReturnType = createUnionType([UcodeType.ARRAY, UcodeType.STRING, UcodeType.NULL]) as UcodeType;
    } else if (argType.includes(' | ')) {
      const argTypes = argType.split(' | ').map(t => t.trim());
      const validTypes = [UcodeType.ARRAY, UcodeType.STRING];
      const matchedTypes = argTypes.filter(t => validTypes.includes(t as UcodeType));
      const hasInvalid = argTypes.some(t => !validTypes.includes(t as UcodeType));
      if (matchedTypes.length > 0 && hasInvalid) {
        // Some valid, some invalid — return matched types + null
        this.narrowedReturnType = createUnionType([...matchedTypes as UcodeType[], UcodeType.NULL]) as UcodeType;
      } else if (matchedTypes.length > 0) {
        // All valid
        this.narrowedReturnType = createUnionType(matchedTypes as UcodeType[]) as UcodeType;
      } else {
        this.narrowedReturnType = UcodeType.NULL;
      }
    } else {
      this.narrowedReturnType = UcodeType.NULL;
    }
    this.validateArgumentType(arg, 'reverse', 1, [UcodeType.ARRAY, UcodeType.STRING]);
    return true;
  }

  validateFilterFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'filter', 2)) return true;

    // First parameter must be array
    this.narrowForArgType(node.arguments[0], [UcodeType.ARRAY], UcodeType.ARRAY);
    this.preserveArrayElementType(node.arguments[0]);
    this.validateArgumentType(node.arguments[0], 'filter', 1, [UcodeType.ARRAY]);
    
    // Second parameter must be function
    this.validateArgumentType(node.arguments[1], 'filter', 2, [UcodeType.FUNCTION]);
    
    return true;
  }

  validateMapFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'map', 2)) return true;

    // First parameter must be array
    this.narrowForArgType(node.arguments[0], [UcodeType.ARRAY], UcodeType.ARRAY);
    this.validateArgumentType(node.arguments[0], 'map', 1, [UcodeType.ARRAY]);
    
    // Second parameter must be function
    this.validateArgumentType(node.arguments[1], 'map', 2, [UcodeType.FUNCTION]);
    
    return true;
  }

  validateKeysFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'keys', 1)) return true;
    this.narrowForArgType(node.arguments[0], [UcodeType.OBJECT], UcodeType.ARRAY);
    // keys() always returns array<string> (object keys are strings)
    if (this.narrowedReturnType === UcodeType.ARRAY) {
      this.narrowedReturnType = createArrayType(UcodeType.STRING);
    }
    this.validateArgumentType(node.arguments[0], 'keys', 1, [UcodeType.OBJECT]);
    return true;
  }

  validateValuesFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'values', 1)) return true;
    this.narrowForArgType(node.arguments[0], [UcodeType.OBJECT], UcodeType.ARRAY);
    this.validateArgumentType(node.arguments[0], 'values', 1, [UcodeType.OBJECT]);
    return true;
  }

  // Trim functions validation
  validateTrimFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'trim', 1)) return true;
    this.narrowForArgType(node.arguments[0], [UcodeType.STRING], UcodeType.STRING);
    this.validateArgumentType(node.arguments[0], 'trim', 1, [UcodeType.STRING]);
    if (node.arguments.length > 1) {
      this.validateArgumentType(node.arguments[1], 'trim', 2, [UcodeType.STRING]);
    }
    return true;
  }

  validateLtrimFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'ltrim', 1)) return true;
    this.narrowForArgType(node.arguments[0], [UcodeType.STRING], UcodeType.STRING);
    this.validateArgumentType(node.arguments[0], 'ltrim', 1, [UcodeType.STRING]);
    if (node.arguments.length > 1) {
      this.validateArgumentType(node.arguments[1], 'ltrim', 2, [UcodeType.STRING]);
    }
    return true;
  }

  validateRtrimFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'rtrim', 1)) return true;
    this.narrowForArgType(node.arguments[0], [UcodeType.STRING], UcodeType.STRING);
    this.validateArgumentType(node.arguments[0], 'rtrim', 1, [UcodeType.STRING]);
    if (node.arguments.length > 1) {
      this.validateArgumentType(node.arguments[1], 'rtrim', 2, [UcodeType.STRING]);
    }
    return true;
  }

  // Substr function validation
  validateSubstrFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'substr', 2)) return true;

    // First parameter: string
    this.narrowForArgType(node.arguments[0], [UcodeType.STRING], UcodeType.STRING);
    this.validateArgumentType(node.arguments[0], 'substr', 1, [UcodeType.STRING]);
    
    // Second parameter: integer (start position)
    this.validateArgumentType(node.arguments[1], 'substr', 2, [UcodeType.INTEGER, UcodeType.DOUBLE]);
    
    // Third parameter (optional): integer (length)
    if (node.arguments.length > 2) {
      this.validateArgumentType(node.arguments[2], 'substr', 3, [UcodeType.INTEGER, UcodeType.DOUBLE]);
    }
    
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

  private getNodeFullType(_node: any): UcodeDataType | null {
    // This will be injected by the main type checker
    return null;
  }

  // Method to inject the type checker
  setTypeChecker(typeChecker: (node: any) => UcodeType): void {
    this.getNodeType = typeChecker;
  }

  setFullTypeChecker(checker: (node: any) => UcodeDataType | null): void {
    this.getNodeFullType = checker;
  }
}
