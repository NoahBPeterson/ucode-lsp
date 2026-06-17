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
  argIndex?: number;   // 1-based argument index for a positional `%N$` conversion (#49)
}

/** A `%`-sequence that LOOKS like an intended conversion but isn't one in ucode (a C-ism the
 *  ucode parser silently prints literally and consumes no argument for). We can prove these
 *  statically from the format literal, so we flag them even though ucode doesn't error. (#50/#51/#52) */
export interface InvalidFormatSpecifier {
  char: string;                              // the offending conversion char (e.g. 'a', 'l', '*')
  text: string;                              // the full intended specifier as written (e.g. '%lld', '%*d', '%a')
  kind: 'star' | 'length' | 'conversion';
  position: number;
  endPosition: number;
}

// ucode's numeric conversions coerce their argument (ucv_to_integer/_double). A string is
// therefore accepted at runtime — a numeric string becomes its value (`"42"`→42), a non-numeric
// one becomes 0. The string case is handled specially in formatArgMismatches (#53): a known
// numeric string is fine; a statically non-numeric string literal silently becomes 0 (a footgun)
// and is still flagged. The base type list keeps STRING out so the per-arg logic decides.
const FORMAT_NUMERIC_TYPES = [UcodeType.INTEGER, UcodeType.DOUBLE, UcodeType.BOOLEAN];

// The conversions that numerically coerce their argument (so a numeric string is valid).
function isNumericFormatConversion(conv: string): boolean {
  return 'diouxXeEfFgG'.includes(conv);
}

/** The accepted argument types for a ucode printf conversion char, or null if the char is NOT
 *  a ucode conversion. ucode's real set (lib.c `uc_printf_common`) is `d i u o x X e E f F g G
 *  c s J %` — there is NO `a A n p`, NO `*` dynamic width, and NO `h/l/z/j/t` length modifiers.
 *  A non-conversion char makes the `%…` literal text that consumes no argument. */
function formatConversionTypes(conv: string): UcodeType[] | null {
  switch (conv) {
    case 'd': case 'i': case 'u': case 'o': case 'x': case 'X':
    case 'e': case 'E': case 'f': case 'F': case 'g': case 'G':
      return FORMAT_NUMERIC_TYPES;
    case 'c': return [UcodeType.INTEGER, UcodeType.STRING];
    case 's': return [];   // any type (auto-cast to string)
    case 'J': return [];   // any type (JSON encode)
    default: return null;  // not a ucode conversion
  }
}

/**
 * Parse ucode printf-style format specifiers from a format string, mirroring the C parser in
 * `uc_printf_common` exactly (lib.c). Grammar:
 *
 *   % [N$ positional] [flags #0-space+] [width 1-9 digits] [.precision] conversion
 *
 * A `%` whose conversion char isn't a real ucode conversion (`default: continue` in C) is
 * literal text consuming no argument — it is NOT returned as a specifier. `%%` IS returned
 * (with empty expectedTypes) so hover can describe it. Positional `%N$d` sets `argIndex`.
 * Returns specifiers in source order.
 */
export interface ScannedFormat {
  specifiers: FormatSpecifier[];
  invalid: InvalidFormatSpecifier[];
}

/** Back-compat wrapper: just the valid specifiers (used by hover). */
export function parseFormatSpecifiers(format: string): FormatSpecifier[] {
  return scanFormat(format).specifiers;
}

export function scanFormat(format: string): ScannedFormat {
  const specifiers: FormatSpecifier[] = [];
  const invalid: InvalidFormatSpecifier[] = [];
  const n = format.length;
  const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';
  let i = 0;

  while (i < n) {
    if (format[i] !== '%') { i++; continue; }
    const start = i;            // at '%'
    let p = i + 1;
    let argIndex: number | undefined;
    let flags = '', width = '', precision = '';

    // A leading 1-9 digit run is either a positional index (if `$` follows) or the width.
    if (format[p] !== undefined && format[p]! >= '1' && format[p]! <= '9') {
      let digits = '';
      while (isDigit(format[p])) digits += format[p++];
      if (format[p] === '$') {
        argIndex = parseInt(digits, 10);
        p++;
        // flags + width may follow a positional prefix
        while (p < n && '#0- +'.includes(format[p]!)) flags += format[p++];
        if (format[p] !== undefined && format[p]! >= '1' && format[p]! <= '9') {
          while (isDigit(format[p])) width += format[p++];
        }
      } else {
        width = digits;          // it was the width; flags cannot follow (C jumps to precision)
      }
    } else {
      while (p < n && '#0- +'.includes(format[p]!)) flags += format[p++];
      if (format[p] !== undefined && format[p]! >= '1' && format[p]! <= '9') {
        while (isDigit(format[p])) width += format[p++];
      }
    }

    // .precision — `.` then an optional `-` (negative precision is parsed but ignored) then digits
    if (format[p] === '.') {
      p++;
      if (format[p] === '-') { p++; while (isDigit(format[p])) p++; }
      else { while (isDigit(format[p])) precision += format[p++]; }
    }

    const conv = format[p];
    if (conv === undefined) { i = p; continue; }        // bare `%` at end of string → nothing
    const endPosition = p + 1;
    const fullMatch = format.slice(start, endPosition);

    if (conv === '%') {
      specifiers.push({ specifier: '%', expectedTypes: [], position: start, endPosition, flags: '', width: '', precision: '', fullMatch });
      i = endPosition;
      continue;
    }

    const expectedTypes = formatConversionTypes(conv);
    if (expectedTypes === null) {
      // Not a ucode conversion → literal text, no argument consumed (the C `default: continue`).
      // If the breaking char looks like an INTENDED specifier (a letter, or `*`), record it as
      // invalid so the caller can flag the C-ism; otherwise it's ordinary literal `%` text
      // (e.g. "5%/sec", "100% done") — stay silent. Re-scan from the char after the `%`.
      if (/[a-zA-Z*]/.test(conv)) {
        const kind: InvalidFormatSpecifier['kind'] =
          conv === '*' ? 'star' : 'lhzjt'.includes(conv) ? 'length' : 'conversion';
        // ucode's parser stops at the first invalid char, but the user typed a fuller construct
        // (`%lld`, `%*d`, `%.*f`). For star/length, extend past the remaining spec-body chars and
        // a trailing conversion letter so the diagnostic can quote the whole intended sequence.
        let textEnd = endPosition;
        if (kind !== 'conversion') {
          while (textEnd < n && /[-#+ 0-9.*lhzjt]/.test(format[textEnd]!)) textEnd++;
          if (textEnd < n && /[a-zA-Z]/.test(format[textEnd]!)) textEnd++;
        }
        invalid.push({ char: conv, text: format.slice(start, textEnd), kind, position: start, endPosition });
      }
      i = start + 1;
      continue;
    }

    specifiers.push({ specifier: conv, expectedTypes, position: start, endPosition, flags, width, precision, fullMatch, ...(argIndex !== undefined ? { argIndex } : {}) });
    i = endPosition;
  }
  return { specifiers, invalid };
}

const VALID_SIGNAL_NAMES = new Set([
  'INT', 'ILL', 'ABRT', 'FPE', 'SEGV', 'TERM', 'HUP', 'QUIT', 'TRAP', 
  'KILL', 'PIPE', 'ALRM', 'STKFLT', 'PWR', 'BUS', 'SYS', 'URG', 'STOP', 
  'TSTP', 'CONT', 'CHLD', 'TTIN', 'TTOU', 'POLL', 'XFSZ', 'XCPU', 
  'VTALRM', 'PROF', 'USR1', 'USR2'
]);

const UNHANDLABLE_SIGNALS = new Set(['KILL', 'STOP']);

// ParseConfig keys accepted by loadfile/loadstring's optional options object, from ucode
// lib.c uc_compile_parse_config. Boolean fields are coerced via ucv_is_truish (any value
// works but a non-boolean is almost certainly a mistake); array fields are read with
// ucv_array_length, so a NON-array value is silently dropped (intent lost) — both worth a
// warning. Unknown keys are ignored by ucode, so they're flagged as likely typos.
const PARSE_CONFIG_BOOLEAN_KEYS = new Set(['lstrip_blocks', 'trim_blocks', 'strict_declarations', 'raw_mode']);
const PARSE_CONFIG_ARRAY_KEYS = new Set(['module_search_path', 'force_dynlink_list']);

/** Whether an argument node must be parenthesized when wrapped as `"" + (node)` — true for
 *  operators that bind looser than `+`. Mirrors TypeChecker.needsParensForAddition (#30/#32). */
function coerceArgNeedsParens(node: AstNode): boolean {
  switch (node.type) {
    case 'BinaryExpression':
    case 'LogicalExpression':
    case 'ConditionalExpression':
    case 'AssignmentExpression':
      return true;
    default:
      return false;
  }
}

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
    this.errors.push({ message, start, end, severity: 'error', code: UcodeErrorCode.INVALID_PARAMETER_TYPE });
  }

  /** Push a strict-gated diagnostic: warning in non-strict, error under `'use strict'`. */
  private pushWarnOrStrictError(message: string, start: number, end: number, code: string, data?: unknown): void {
    if (this.strictMode) {
      this.errors.push({ message, start, end, severity: 'error', code, data });
    } else {
      this.warnings.push({ message, start, end, severity: 'warning', code, data });
    }
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
        message: `Function '${funcName}' expects at least ${minArgs} argument${minArgs === 1 ? '' : 's'}, got ${node.arguments.length}`,
        start: node.start,
        end: node.end,
        severity: 'error',
        code: UcodeErrorCode.INVALID_PARAMETER_COUNT,
      });
      return false;
    }
    return true;
  }

  private validateNumericArgument(arg: CallExpressionNode['arguments'][0] | undefined, funcName: string, argPosition: number, softSeverity: boolean = false): boolean {
    if (!arg) {
      return true; // No argument, no error
    }

    const argType = this.getNodeType(arg);

    // `softSeverity`: the builtin COERCES the arg to a number and never throws (e.g.
    // localtime/gmtime via ucv_to_integer — a non-numeric value silently becomes 0), so flag it
    // as a strict-gated warning, not a hard error (#34). Default (false) is the hard error used
    // by builtins that genuinely reject non-numeric args.
    const flag = (msg: string, s: number, e: number) => softSeverity
      ? this.pushWarnOrStrictError(msg, s, e, UcodeErrorCode.INVALID_PARAMETER_TYPE)
      : this.pushTypeMismatch(msg, s, e);

    if (!isNumericConvertibleType(argType)) {
      flag(
        `Argument ${argPosition} of ${funcName}() cannot be a ${argType.toLowerCase()}. It must be a value convertible to a number.`,
        arg.start, arg.end
      );
      return false;
    }

    if (argType === UcodeType.STRING && arg.type === 'Literal') {
      const literal = arg as LiteralNode;
      if (typeof literal.value === 'string' && !isNumberLikeString(literal.value)) {
        flag(
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
    customErrorMessage?: string,
    // `safeInTestContext`: this builtin's result, compared/tested, reads correctly
    // for a wrong-type/null arg — i.e. it's a sound type-test idiom. Only `length`
    // qualifies (`length(x) > 0` → `null > 0` is `false` = "empty/invalid", correct).
    // Contrast `index(x,y) != -1` → `null != -1` is `true` = "found", a logic bug —
    // so index/match/etc. must NOT pass this. When true, the truthiness/comparison
    // suppression applies even under `'use strict'`.
    safeInTestContext: boolean = false,
    // `coercesToString`: this builtin stringifies a wrong-typed argument (total coercion, e.g.
    // `match`'s subject). A DEFINITE non-string, non-null arg is then a strict-gated warning +
    // a "coerce to string" quick-fix, not the hard definite-mismatch error (#32, mirrors #30).
    coercesToString: boolean = false
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
          `Function '${funcName}' expects ${allowedTypes.join(' or ')} for argument ${argPosition}, got ${argType.toLowerCase()}`;

        this.errors.push({ message, start: diagStart, end: diagEnd, severity: 'error', code: UcodeErrorCode.INVALID_PARAMETER_TYPE });
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
      // Suppress in a TEST context (`if (!length(x))`, `length(x) > 0`): there the
      // expression IS the type-check, not a risky use of the value. Non-strict always
      // honors this. Under 'use strict' we keep nagging (the value might still be
      // misused) UNLESS the builtin is a sound test idiom (`safeInTestContext`, i.e.
      // length): strict mode changes undeclared-variable access, not length()'s
      // return behavior, so length()-in-a-predicate is just as safe in strict. A bare
      // value use (`let n = length(x)`) is non-truthiness, so it's still flagged.
      if ((this.strictMode && !safeInTestContext) || !this.inTruthinessContext) {
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
        // A string-coercing builtin (match subject): a DEFINITE non-string, non-null arg is
        // stringified at runtime → strict-gated WARNING + "coerce to string" quick-fix, not a
        // hard error (#32). null is excluded (it's the "possibly null" concern, not coercion).
        if (coercesToString && argType !== UcodeType.NULL) {
          const message = `Function '${funcName}' expects a string; ${argType.toLowerCase()} will be coerced to a string. Pass a string to be explicit (e.g. \`"" + value\`).`;
          const diagData = {
            functionName: funcName,
            argumentIndex: argPosition - 1,
            expectedType: 'string',
            actualType: argType,
            variableName: this.getVariableName(arg),
            coerceToString: true,
            argNeedsParens: coerceArgNeedsParens(arg),
            // A definite single non-string is NOT narrowable by a type guard — only the
            // coerce fix applies. (Defense in depth alongside the quick-fix layer's own gate.)
            narrowable: false,
          };
          this.pushWarnOrStrictError(message, arg.start, arg.end, 'incompatible-function-argument', diagData);
          return false;
        }
        // Definitely wrong — always error
        const message = customErrorMessage ||
          `Function '${funcName}' expects ${allowedTypes.join(' or ')} for argument ${argPosition}, got ${argType.toLowerCase()}`;

        this.errors.push({ message, start: diagStart, end: diagEnd, severity: 'error', code: UcodeErrorCode.INVALID_PARAMETER_TYPE });
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
      [UcodeType.NULL], undefined, /* safeInTestContext */ true);
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

  /** True when `node` is a regex literal carrying the global (`g`) flag. The
   *  literal's value is the full `/pattern/flags` text (flags are letters only,
   *  so the closing delimiter is the last `/`). Returns false for dynamic
   *  regexes (`regexp(...)`) or variables — their flags aren't statically known. */
  private regexLiteralHasGlobalFlag(node: AstNode | undefined): boolean {
    if (!node || node.type !== 'Literal') return false;
    const lit = node as any;
    if (lit.literalType !== 'regexp') return false;
    const v = String(lit.value);
    const lastSlash = v.lastIndexOf('/');
    if (lastSlash < 0) return false;
    return v.slice(lastSlash + 1).includes('g');
  }

  validateMatchFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'match', 2)) return true;

    // Return type. CRITICAL: `null` is ALWAYS possible, even with perfectly valid
    // arguments — match() returns null on NO MATCH (verified against the runtime:
    // `match("zzz", /x/)` → null). This is unlike split()/replace(), where null
    // only signals a wrong arg TYPE (so it can be narrowed away once the args are
    // known-good). For match() it never can be.
    //
    // Element shape depends on the `g` flag of a LITERAL regex:
    //   no g → array<string>          (one match: full match at [0], groups after)
    //   g    → array<array<string>>   (all matches: each element is a match array)
    // A dynamic regexp() falls back to the no-g shape (flag unknown).
    const regexArg = node.arguments[1];
    const regexType = regexArg ? this.getNodeType(regexArg) : UcodeType.UNKNOWN;
    const regexCouldBeValid = regexType === UcodeType.REGEX
      || regexType === UcodeType.UNKNOWN
      || (typeof regexType === 'string' && regexType.includes(' | ')
          && regexType.split(' | ').some(t => t.trim() === UcodeType.REGEX || t.trim() === UcodeType.UNKNOWN));
    if (regexCouldBeValid) {
      const elementType = this.regexLiteralHasGlobalFlag(regexArg)
        ? createArrayType(UcodeType.STRING)   // g: array of match-arrays
        : UcodeType.STRING;                   // no g: array of strings
      this.narrowedReturnType = createUnionType([createArrayType(elementType), UcodeType.NULL]) as UcodeType;
    } else {
      // regex arg is definitely the wrong type → match() always returns null.
      this.narrowedReturnType = UcodeType.NULL;
    }

    // arg 1 (subject) is coerced to a string by ucode (`match(123,/2/)` → `["2"]`), so a
    // non-string is a strict-gated warning + coerce quick-fix, not a hard error (#32).
    this.validateArgumentType(node.arguments[0], 'match', 1, [UcodeType.STRING], undefined, undefined, /*safeInTestContext*/ false, /*coercesToString*/ true);

    // Custom check for argument 2: suggest regex conversion if a string literal is passed
    if (regexArg) {
      if (regexType !== UcodeType.REGEX && regexType !== UcodeType.UNKNOWN) {
        if (regexArg.type === 'Literal') {
          const literal = regexArg as any;
          if (literal.literalType === 'string') {
            // ucode does NOT compile a string as a regex — `match(s, "[0-9]")` silently returns
            // null (never matches). So this stays a hard error, with a "convert to regex literal"
            // quick-fix. The fix is built from the SOURCE text (in server.ts) so escapes like \d/\b
            // survive exactly as written — we deliberately DON'T put a specific /…/ in the message,
            // because this layer only has the DECODED value (the lexer turns `"a\b"` into `"ab"`),
            // which diverges from the source. The quick-fix title shows the correct regex. (#32)
            this.errors.push({
              message: `Function 'match' expects a regex for argument 2, got a string — ucode does not treat a string as a regex (it returns null). Convert it to a regex literal (the quick-fix does this).`,
              start: regexArg.start, end: regexArg.end,
              severity: 'error',
              code: UcodeErrorCode.INVALID_PARAMETER_TYPE,
              data: { convertStringToRegex: true },
            });
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
      // Could return null (wrong arg types) — but IF it returns an array, the
      // elements are always strings. So `array<string> | null`, not bare
      // `array | null`: keeping the element type lets `result[i]` resolve to
      // `string | null` downstream instead of collapsing to unknown.
      this.narrowedReturnType = createUnionType([createArrayType(UcodeType.STRING), UcodeType.NULL]) as UcodeType;
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
    // loadstring(code[, options]) — the optional 2nd arg is a ParseConfig object
    // (raw_mode, strict_declarations, …); C uc_loadstring forwards it to uc_load_common.
    if (node.arguments.length < 1 || node.arguments.length > 2) {
      this.errors.push({
        message: `loadstring() expects 1-2 arguments, got ${node.arguments.length}`,
        start: node.start,
        end: node.end,
        severity: 'error',
        code: UcodeErrorCode.INVALID_PARAMETER_COUNT,
      });
      return true;
    }

    const arg = node.arguments[0];
    if (!arg) return true;

    this.validateArgumentType(arg, 'loadstring', 1, [UcodeType.STRING]);
    if (node.arguments[1]) {
      this.validateArgumentType(node.arguments[1], 'loadstring', 2, [UcodeType.OBJECT]);
      this.validateParseConfigObject(node.arguments[1], 'loadstring');
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
    if (node.arguments[1]) this.narrowForArgType(node.arguments[1], [UcodeType.ARRAY], UcodeType.STRING);
    this.validateArgumentType(node.arguments[0], 'join', 1, [UcodeType.STRING]);
    this.validateArgumentType(node.arguments[1], 'join', 2, [UcodeType.ARRAY]);
    return true;
  }

  validateRandFunction(node: CallExpressionNode): boolean {
    // rand() with 0 args → integer (rand() returns int)
    // rand(max) with 1+ args → double (returns double in [0, max))
    if (node.arguments.length === 0) {
      this.narrowedReturnType = UcodeType.INTEGER;
    } else {
      this.narrowedReturnType = UcodeType.DOUBLE;
    }
    return true;
  }

  validateGetenvFunction(node: CallExpressionNode): boolean {
    // getenv() with 0 args → object (all env vars, never null)
    // getenv(name) with 1 arg → string | null (env var may not exist)
    if (node.arguments.length === 0) {
      this.narrowedReturnType = UcodeType.OBJECT;
    }
    // With 1 arg, the default return type (string | null) is correct
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
        message: `Function 'exists' expects object for argument 1, got ${argType.toLowerCase()}`,
        start: arg.start, end: arg.end, severity: 'error', code: UcodeErrorCode.INVALID_PARAMETER_TYPE
      });
    } else if (bad.length > 0) {
      // Mix of valid and invalid — warning only if not all exempt
      const hasObject = argTypes.includes(UcodeType.OBJECT);
      if (!hasObject && !argTypes.includes(UcodeType.UNKNOWN)) {
        this.errors.push({
          message: `Function 'exists' expects object for argument 1, got ${argType.toLowerCase()}`,
          start: arg.start, end: arg.end, severity: 'error', code: UcodeErrorCode.INVALID_PARAMETER_TYPE
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
        severity: 'warning',
        code: UcodeErrorCode.INVALID_OPERATION,
      });
    } else {
      // Check if the first argument is known to be falsy
      const firstArg = node.arguments[0];
      if (firstArg && !this.isKnownTruish(firstArg)) {
        this.warnings.push({
          message: `assert() with falsy value will always fail - consider adding a condition`,
          start: firstArg.start,
          end: firstArg.end,
          severity: 'warning',
          code: UcodeErrorCode.INVALID_OPERATION,
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
                severity: 'error',
                code: UcodeErrorCode.INVALID_PARAMETER_TYPE,
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

    // C: returns NULL if subject is null/missing OR pattern not string; returns boolean otherwise.
    // 1st arg: must be non-null (any non-null type is converted to string)
    // 2nd arg: must be string
    // Only narrow to boolean when BOTH args are known to satisfy constraints.
    const arg1Type = this.getNodeType ? this.getNodeType(node.arguments[0]) : 'unknown';
    const arg2Type = this.getNodeType ? this.getNodeType(node.arguments[1]) : 'unknown';
    const arg1Ok = arg1Type !== 'unknown' && arg1Type !== 'null' && !arg1Type.includes('null');
    const arg2Ok = arg2Type === 'string';
    if (arg1Ok && arg2Ok) {
      this.narrowedReturnType = UcodeType.BOOLEAN;
    }
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
            this.warnings.push({ message: msg, start, end, severity: sev, code: UcodeErrorCode.INVALID_PARAMETER_TYPE });
          else if (sev === 'error')
            this.errors.push({ message: msg, start, end, severity: sev, code: UcodeErrorCode.INVALID_PARAMETER_TYPE });
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
            severity: 'warning',
            code: UcodeErrorCode.INVALID_PARAMETER_TYPE,
          });
        }
      }
    }

    // 3rd arg: CASEFOLD flag — no *syntax* validation required.
    return true;
  }

  validateLocaltimeFunction(node: CallExpressionNode): boolean {
    // Optional epoch arg, coerced to integer via ucv_to_integer (a numeric string like "123"
    // works; a non-numeric value silently becomes 0 = 1970). So accept numeric/numeric-strings
    // and only WARN (error under 'use strict') on a statically non-numeric value (#34).
    this.validateNumericArgument(node.arguments[0], 'localtime', 1, /*softSeverity*/ true);
    return true;
  }

  validateGmtimeFunction(node: CallExpressionNode): boolean {
    this.validateNumericArgument(node.arguments[0], 'gmtime', 1, /*softSeverity*/ true);
    return true;
  }

  validateTimelocalFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'timelocal', 1)) return true;
    this.validateArgumentType(node.arguments[0], 'timelocal', 1, [UcodeType.OBJECT]);
    return true;
  }

  validateTypelocalFunction(node: CallExpressionNode): boolean {
    this.checkArgumentCount(node, 'type', 1);
    // type(null) returns null; type(non-null) returns string.
    // Narrow to string when arg is known non-null.
    if (node.arguments[0] && this.getNodeType) {
      const argType = this.getNodeType(node.arguments[0]);
      if (argType !== 'unknown' && argType !== 'null' && !argType.includes('null')) {
        this.narrowedReturnType = UcodeType.STRING;
      }
    }
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

  /** `render()` is two-faced, decided by the first argument's type (verified vs the
   *  interpreter + ucode/lib.c uc_render):
   *    - render(path: string, scope?: object)  — include-like; max 2 args.
   *    - render(fn: function, ...args)          — calls fn, forwards ALL trailing args (variadic).
   *  Both return string|null (the function form returns fn's captured print output). A
   *  provably non-string, non-function first arg is a runtime error ("Passed filename is not a
   *  string"), so it's flagged; an unknown/union first arg is enforced to string|function
   *  (consistent with the policy that type-expecting builtins don't silently accept unknown). */
  validateRenderFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'render', 1)) return true;
    const arg0 = node.arguments[0];
    const arg0type = this.getNodeType(arg0);

    if (arg0type === UcodeType.FUNCTION) {
      // Function form — variadic; trailing args are forwarded to fn (any type, no cap).
      return true;
    }

    if (arg0type === UcodeType.STRING) {
      // Template/include form — render(path, scope?). 2nd arg is the scope object.
      if (node.arguments.length >= 2) {
        this.validateArgumentType(node.arguments[1], 'render', 2, [UcodeType.OBJECT, UcodeType.NULL]);
      }
      if (node.arguments.length > 2) {
        this.errors.push({
          message: `Function 'render' (template form) expects at most 2 arguments, got ${node.arguments.length}`,
          start: node.start,
          end: node.end,
          severity: 'error',
          code: UcodeErrorCode.INVALID_PARAMETER_COUNT,
        });
      }
      return true;
    }

    // Ambiguous / provably-wrong first arg → must be a string (template path) or function.
    // Flags concrete wrong types (render(5)/render({})) and unknown ("narrow to ..."). The
    // form is undetermined, so no arity cap / trailing-arg checks here.
    this.validateArgumentType(arg0, 'render', 1, [UcodeType.STRING, UcodeType.FUNCTION]);
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
                    this.errors.push({ message: `Signal number must be between 1 and 31, got ${literal.value}`, start: signalArg.start, end: signalArg.end, severity: 'error', code: UcodeErrorCode.INVALID_PARAMETER_TYPE });
                }
            } else if (signalType === UcodeType.STRING) {
                if (typeof literal.value === 'string') {
                    let sigStr = literal.value.toUpperCase().replace(/^SIG/, '');
                    if (!VALID_SIGNAL_NAMES.has(sigStr) && !UNHANDLABLE_SIGNALS.has(sigStr)) {
                        this.errors.push({ message: `Invalid signal name "${literal.value}"`, start: signalArg.start, end: signalArg.end, severity: 'error', code: UcodeErrorCode.INVALID_PARAMETER_TYPE });
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
            this.warnings.push({ message: `Invalid signal handler string "${literal.value}". Did you mean 'ignore' or 'default'?`, start: handlerArg.start, end: handlerArg.end, severity: 'warning', code: UcodeErrorCode.INVALID_PARAMETER_TYPE });
          }
        } else {
            this.validateArgumentType(handlerArg, 'signal', 2, [UcodeType.FUNCTION, UcodeType.STRING]);
        }

        if (signalValue && signalArg) {
            let sigStr = String(signalValue).toUpperCase().replace(/^SIG/, '');
            if (UNHANDLABLE_SIGNALS.has(sigStr)) {
                this.warnings.push({ message: `Signal '${sigStr}' cannot be caught or ignored.`, start: signalArg.start, end: signalArg.end, severity: 'warning', code: UcodeErrorCode.INVALID_PARAMETER_TYPE });
            }
        }
      }
    }

    // Narrow return type based on argument count and handler type:
    // 1 arg (query): function | string | null (handler, "ignore"/"default", or null)
    // 2 args (set): returns arg2 back — function|null if callable, string|null if string,
    //               null if arg2 is any other type (C else branch returns NULL)
    if (node.arguments.length === 1) {
      // Query mode — full union
    } else if (node.arguments.length === 2 && node.arguments[1]) {
      const handlerType = this.getNodeType ? this.getNodeType(node.arguments[1]) : 'unknown';
      if (handlerType === 'function') {
        this.narrowedReturnType = createUnionType([UcodeType.FUNCTION, UcodeType.NULL]);
      } else if (handlerType === 'string') {
        this.narrowedReturnType = createUnionType([UcodeType.STRING, UcodeType.NULL]);
      } else if (handlerType !== 'unknown') {
        // Definitely not string or function — C code hits else branch, returns NULL
        this.narrowedReturnType = UcodeType.NULL;
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
    // printf() with no args is NOT an error in ucode (it runs, empty output) — so it's not the
    // hard arity error it used to be. But it provably has no effect, and printf is a static target
    // we know more about than a user function, so we flag it as a useless call (#88).
    if (node.arguments.length === 0) { this.warnUselessFormatCall(node, 'printf', 'produces no output'); return true; }
    this.validateArgumentType(node.arguments[0], 'printf', 1, [UcodeType.STRING]);
    this.validateFormatString(node, 'printf');
    return true;
  }

  validateSprintfFunction(node: CallExpressionNode): boolean {
    // sprintf() with no args is valid in ucode (returns "") — not a hard error, but provably
    // useless. Flag as a no-effect call (#88).
    if (node.arguments.length === 0) { this.warnUselessFormatCall(node, 'sprintf', 'returns an empty string'); return true; }
    this.validateArgumentType(node.arguments[0], 'sprintf', 1, [UcodeType.STRING]);
    this.validateFormatString(node, 'sprintf');
    return true;
  }

  /** A zero-argument printf()/sprintf() — valid in ucode but provably useless (#88). */
  private warnUselessFormatCall(node: CallExpressionNode, funcName: string, effect: string): void {
    this.warnings.push({
      message: `${funcName}() with no arguments has no effect (it ${effect}). Did you forget the format string?`,
      start: node.start,
      end: node.end,
      severity: 'warning',
      code: UcodeErrorCode.USELESS_CALL
    });
  }

  /** Whether a printf argument mismatches its conversion specifier. ucode coerces numeric
   *  conversions, so a string is accepted UNLESS it's a statically non-numeric string literal
   *  (which silently becomes 0 — a real footgun worth flagging). %s/%J accept any type. (#53) */
  private formatArgMismatches(spec: FormatSpecifier, arg: AstNode, argType: UcodeType): boolean {
    if (spec.expectedTypes.length === 0) return false;                 // %s / %J — any type
    if (spec.expectedTypes.includes(argType)) return false;
    if (argType === UcodeType.STRING && isNumericFormatConversion(spec.specifier)) {
      return arg.type === 'Literal'
        && typeof (arg as LiteralNode).value === 'string'
        && !isNumberLikeString((arg as LiteralNode).value as string);
    }
    return true;
  }

  private validateFormatString(node: CallExpressionNode, funcName: string): void {
    const formatArg = node.arguments[0];
    if (!formatArg || formatArg.type !== 'Literal') return;
    const literal = formatArg as LiteralNode;
    if (typeof literal.value !== 'string') return;

    const { specifiers: allSpecifiers, invalid } = scanFormat(literal.value);
    const specifiers = allSpecifiers.filter(s => s.specifier !== '%'); // exclude %% (literal percent)
    const dataArgs = node.arguments.slice(1); // arguments after the format string

    // A spread argument (`sprintf(fmt, ...mac)`) expands to an unknown number of
    // values at runtime, so neither the count nor the per-position types can be
    // checked statically — bail out of both checks entirely.
    if (dataArgs.some(arg => arg.type === 'SpreadElement')) return;

    // Unsupported C-isms (`%*d`, `%lld`, `%a`, …): provably not ucode conversions — ucode prints
    // them literally and consumes no argument. ucode itself emits nothing, but the format literal
    // is a static target so we flag them (#50/#51/#52). Anchor on the whole literal to sidestep
    // escape-induced offset drift inside the string.
    for (const inv of invalid) {
      const message =
        inv.kind === 'star'
          ? `${funcName}(): ucode does not support '*' dynamic width/precision — '${inv.text}' prints literally and consumes no argument`
          : inv.kind === 'length'
          ? `${funcName}(): ucode has no printf length modifiers (l/h/z/j/t) — '${inv.text}' prints literally and consumes no argument`
          : `${funcName}(): '${inv.text}' is not a ucode format conversion — it prints literally and consumes no argument`;
      this.warnings.push({ message, start: formatArg.start, end: formatArg.end, severity: 'warning', code: UcodeErrorCode.INVALID_FORMAT_SPECIFIER });
    }

    const specCount = specifiers.length;
    const argCount = dataArgs.length;

    // Positional formats (`%2$s %1$s`) reference arguments by index, so the sequential
    // spec↔arg mapping doesn't apply (#49). Require only that every referenced index is
    // supplied (too-few); a positional format may legitimately skip or reuse indices, so
    // don't flag "extra". Type-check each positional spec against the argument it names.
    const positionalSpecs = specifiers.filter(s => s.argIndex !== undefined);
    if (positionalSpecs.length > 0) {
      const maxIdx = Math.max(...positionalSpecs.map(s => s.argIndex!));
      if (argCount < maxIdx) {
        this.warnings.push({
          message: `${funcName}(): format references argument ${maxIdx} but only ${argCount} argument${argCount === 1 ? ' is' : 's are'} provided`,
          start: formatArg.start,
          end: formatArg.end,
          severity: 'warning',
          code: UcodeErrorCode.FORMAT_ARG_COUNT_MISMATCH
        });
      }
      // Any supplied argument not referenced by a positional index (a gap like `%1$s %3$s`
      // skipping 2, or trailing extras) is silently ignored at runtime (#49 strictness). Only
      // when enough args were supplied (argCount >= maxIdx) — otherwise the too-few warning above
      // already covers the same off-by-one, and flagging the leftover arg too is double-reporting.
      if (argCount >= maxIdx) {
        const referenced = new Set(positionalSpecs.map(s => s.argIndex!));
        for (let idx = 1; idx <= argCount; idx++) {
          if (referenced.has(idx)) continue;
          const arg = dataArgs[idx - 1]!;
          this.warnings.push({
            message: `${funcName}(): argument ${idx} is not referenced by the format string (ignored)`,
            start: arg.start,
            end: arg.end,
            severity: 'warning',
            code: UcodeErrorCode.FORMAT_ARG_COUNT_MISMATCH
          });
        }
      }
      for (const spec of positionalSpecs) {
        if (spec.expectedTypes.length === 0) continue;
        const arg = dataArgs[spec.argIndex! - 1];
        if (!arg) continue;
        const argType = this.getNodeType(arg);
        if (argType === UcodeType.UNKNOWN || argType.includes(' | ')) continue;
        if (this.formatArgMismatches(spec, arg, argType as UcodeType)) {
          const expectedStr = spec.expectedTypes.map(t => t.toLowerCase()).join(' or ');
          this.warnings.push({
            message: `${funcName}(): argument ${spec.argIndex} has type '${argType.toLowerCase()}' but format specifier '%${spec.argIndex}$${spec.specifier}' expects ${expectedStr}`,
            start: arg.start,
            end: arg.end,
            severity: 'warning',
            code: UcodeErrorCode.FORMAT_TYPE_MISMATCH
          });
        }
      }
      return;
    }

    // Count mismatch check
    if (specCount > argCount) {
      this.warnings.push({
        message: `${funcName}(): format string has ${specCount} specifier${specCount === 1 ? '' : 's'} but only ${argCount} argument${argCount === 1 ? '' : 's'} provided`,
        start: formatArg.start,
        end: formatArg.end,
        severity: 'warning',
        code: UcodeErrorCode.FORMAT_ARG_COUNT_MISMATCH
      });
    } else if (specCount < argCount && invalid.length === 0) {
      // Extra arguments are silently ignored — lower severity warning. Suppressed when the format
      // has an invalid C-ism: that diagnostic already explains why an argument goes unconsumed, so
      // a second "extra arguments" note would be redundant noise. A genuine too-few (above) still
      // fires regardless, since it's a real shortfall independent of the bogus specifier.
      const firstExtra = dataArgs[specCount]!;
      const lastExtra = dataArgs[argCount - 1]!;
      this.warnings.push({
        message: `${funcName}(): format string has ${specCount} specifier${specCount === 1 ? '' : 's'} but ${argCount} argument${argCount === 1 ? '' : 's'} provided (extra arguments are ignored)`,
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

      if (this.formatArgMismatches(spec, arg, argType as UcodeType)) {
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
    if (!this.checkArgumentCount(node, 'int', 1)) return true;

    // C source: int() accepts any type.
    // integer/double/boolean/null → always integer (ucv_to_integer succeeds)
    // string → integer | double (depends on content — "abc" → NaN)
    // array/object/function/regex → double (NaN — ucv_to_number fails)
    // unknown → integer | double (can't tell)
    if (node.arguments[0]) {
      const argType = this.getNodeType(node.arguments[0]);
      const alwaysInteger: UcodeType[] = [UcodeType.INTEGER, UcodeType.DOUBLE, UcodeType.BOOLEAN, UcodeType.NULL];
      const alwaysNaN: UcodeType[] = [UcodeType.ARRAY, UcodeType.OBJECT, UcodeType.FUNCTION, UcodeType.REGEX];

      if (alwaysInteger.includes(argType as UcodeType)) {
        this.narrowedReturnType = UcodeType.INTEGER;
      } else if (alwaysNaN.includes(argType as UcodeType)) {
        this.narrowedReturnType = UcodeType.DOUBLE;
      }
      // string and unknown: keep full integer | double union
    }
    return true;
  }

  validateHexFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'hex', 1)) return true;

    // C source: hex() only accepts strings.
    // string → integer | double (valid hex → integer, invalid → NaN)
    // everything else → double (NaN — ucv_string_get returns NULL)
    if (node.arguments[0]) {
      const argType = this.getNodeType(node.arguments[0]);
      if (argType === UcodeType.STRING || argType === UcodeType.UNKNOWN) {
        // String could be valid or invalid hex — keep full union
        // Unknown could be string or not — keep full union
      } else {
        // Definitely not a string → always NaN
        this.narrowedReturnType = UcodeType.DOUBLE;
      }
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
        severity: 'error',
        code: UcodeErrorCode.INVALID_PARAMETER_COUNT,
      });
      return true;
    }

    if (node.arguments[0]) {
      this.validateArgumentType(node.arguments[0], 'require', 1, [UcodeType.STRING]);
    }
    return true;
  }

  validateIncludeFunction(node: CallExpressionNode): boolean {
    if (node.arguments.length < 1 || node.arguments.length > 2) {
      this.errors.push({
        message: `include() expects 1-2 arguments, got ${node.arguments.length}`,
        start: node.start,
        end: node.end,
        severity: 'error',
        code: UcodeErrorCode.INVALID_PARAMETER_COUNT,
      });
      return true;
    }

    if (node.arguments[0]) {
      this.validateArgumentType(node.arguments[0], 'include', 1, [UcodeType.STRING]);
    }
    if (node.arguments[1]) {
      this.validateArgumentType(node.arguments[1], 'include', 2, [UcodeType.OBJECT]);
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
    // loadfile(path[, options]) — the optional 2nd arg is a ParseConfig object
    // (raw_mode, strict_declarations, …); C uc_loadfile forwards it to uc_load_common.
    if (node.arguments.length < 1 || node.arguments.length > 2) {
      this.errors.push({
        message: `loadfile() expects 1-2 arguments, got ${node.arguments.length}`,
        start: node.start,
        end: node.end,
        severity: 'error',
        code: UcodeErrorCode.INVALID_PARAMETER_COUNT,
      });
      return true;
    }

    const arg = node.arguments[0];
    if (!arg) return true;

    // C: returns NULL if path not string; returns compiled function otherwise
    this.narrowForArgType(arg, [UcodeType.STRING], UcodeType.FUNCTION);
    this.validateArgumentType(arg, 'loadfile', 1, [UcodeType.STRING]);
    if (node.arguments[1]) {
      this.validateArgumentType(node.arguments[1], 'loadfile', 2, [UcodeType.OBJECT]);
      this.validateParseConfigObject(node.arguments[1], 'loadfile');
    }

    return true;
  }

  /**
   * Validate the property values of a loadfile/loadstring ParseConfig options object
   * literal. ucode silently coerces/drops wrong-typed values (booleans via truthiness;
   * non-array path values are ignored), so these are warnings, not errors — but they
   * catch real mistakes (e.g. `force_dynlink_list: 'x'` is silently dropped). Unknown
   * keys are ignored by ucode → flagged as likely typos. Only fires for an object
   * literal; a variable/spread options arg is left alone. Known value types only (an
   * unknown-typed value, e.g. a variable, is not flagged).
   */
  private validateParseConfigObject(optionsArg: any, fnName: string): void {
    if (!optionsArg || optionsArg.type !== 'ObjectExpression' || !Array.isArray(optionsArg.properties)) return;
    for (const prop of optionsArg.properties) {
      if (!prop || prop.type !== 'Property' || prop.computed) continue;
      const key = prop.key;
      const keyName = key && key.type === 'Literal' ? key.value : (key ? key.name : undefined);
      if (typeof keyName !== 'string') continue;
      const value = prop.value;
      if (PARSE_CONFIG_BOOLEAN_KEYS.has(keyName)) {
        const vt = this.getNodeType(value);
        if (vt !== UcodeType.UNKNOWN && vt !== UcodeType.BOOLEAN) {
          this.warnings.push({
            message: `${fnName}() ParseConfig option '${keyName}' expects a boolean, got ${vt} (ucode coerces it via truthiness)`,
            start: value.start, end: value.end, severity: 'warning', code: UcodeErrorCode.INVALID_PARAMETER_TYPE
          });
        }
      } else if (PARSE_CONFIG_ARRAY_KEYS.has(keyName)) {
        const vt = this.getNodeType(value);
        if (vt !== UcodeType.UNKNOWN && vt !== UcodeType.ARRAY) {
          this.warnings.push({
            message: `${fnName}() ParseConfig option '${keyName}' expects an array of strings, got ${vt} (non-array values are ignored)`,
            start: value.start, end: value.end, severity: 'warning', code: UcodeErrorCode.INVALID_PARAMETER_TYPE
          });
        }
      } else {
        this.warnings.push({
          message: `Unknown ParseConfig option '${keyName}' (ignored by ${fnName}())`,
          start: key.start, end: key.end, severity: 'warning', code: UcodeErrorCode.INVALID_PARAMETER_TYPE
        });
      }
    }
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
          severity: 'error',
          code: UcodeErrorCode.INVALID_PARAMETER_TYPE,
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
              severity: 'error',
              code: UcodeErrorCode.INVALID_PARAMETER_TYPE,
            });
        } else if ((node.arguments[1] as AstNode).type === "Identifier") {
          // ToDo- Advanced type inference
        }
      }
    }

    // Narrow return type based on gc operation:
    // gc() or gc("collect") → boolean (true)
    // gc("start") → boolean | null
    // gc("stop") → boolean
    // gc("count") → integer
    if (argCount === 0) {
      this.narrowedReturnType = UcodeType.BOOLEAN;
    } else if (argCount >= 1 && node.arguments[0]?.type === 'Literal') {
      const lit = node.arguments[0] as LiteralNode;
      if (typeof lit.value === 'string') {
        switch (lit.value) {
          case 'collect': this.narrowedReturnType = UcodeType.BOOLEAN; break;
          case 'stop': this.narrowedReturnType = UcodeType.BOOLEAN; break;
          case 'count': this.narrowedReturnType = UcodeType.INTEGER; break;
          case 'start': this.narrowedReturnType = createUnionType([UcodeType.BOOLEAN, UcodeType.NULL]); break;
        }
      }
    }

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
    if (!this.checkArgumentCount(node, 'slice', 1)) return true;

    // First parameter must be array
    this.narrowForArgType(node.arguments[0], [UcodeType.ARRAY], UcodeType.ARRAY);
    this.preserveArrayElementType(node.arguments[0]);
    this.validateArgumentType(node.arguments[0], 'slice', 1, [UcodeType.ARRAY]);

    // Second parameter (start index) is optional but must be number if present
    if (node.arguments.length >= 2 && node.arguments[1]) {
      this.validateArgumentType(node.arguments[1], 'slice', 2, [UcodeType.INTEGER, UcodeType.DOUBLE]);
    }

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

    // First parameter must be array or object (per C source, sort works on both)
    // C returns NULL for non-array/non-object args
    const argType = this.getNodeType ? this.getNodeType(node.arguments[0]) : 'unknown';
    if (argType === 'array') {
      this.narrowedReturnType = UcodeType.ARRAY;
      this.preserveArrayElementType(node.arguments[0]);
    } else if (argType === 'object') {
      this.narrowedReturnType = createUnionType([UcodeType.OBJECT, UcodeType.NULL]);
    } else if (argType !== UcodeType.UNKNOWN && !argType.includes(' | ')) {
      this.narrowedReturnType = UcodeType.NULL;
    }
    this.validateArgumentType(node.arguments[0], 'sort', 1, [UcodeType.ARRAY, UcodeType.OBJECT]);

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
    // Tag the call result with keys-of provenance. When the argument is a
    // direct Identifier referring to a known object, downstream code can use
    // this to type `arr[i]` and `for (let k of arr) { obj[k] }` against that
    // object's propertyTypes — see semanticAnalyzer/typeChecker keysOfSymbol
    // handling. Strict on the arg shape: anything but a bare Identifier is
    // skipped (no chasing aliases here — we'd lose soundness on mutation).
    const arg = node.arguments?.[0];
    if (arg?.type === 'Identifier') {
      (node as any)._keysOfSymbol = (arg as any).name;
    }
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

  validateProtoFunction(node: CallExpressionNode): boolean {
    if (!this.checkArgumentCount(node, 'proto', 1)) return true;

    if (node.arguments.length === 1) {
      // 1-arg form: proto(obj) — query prototype, returns object | null
      this.validateArgumentType(node.arguments[0], 'proto', 1, [UcodeType.OBJECT, UcodeType.ARRAY]);
    } else {
      // 2-arg form: proto(obj, proto_obj) — set prototype, returns first arg
      // C source: returns the first argument directly (ucv_get)
      const argType = this.getNodeType(node.arguments[0]);
      if (argType === UcodeType.OBJECT || argType === UcodeType.ARRAY) {
        this.narrowedReturnType = argType;
      } else if (argType !== UcodeType.UNKNOWN && !argType.includes(' | ')) {
        // Definitely wrong type — returns null
        this.narrowedReturnType = UcodeType.NULL;
      }
      this.validateArgumentType(node.arguments[0], 'proto', 1, [UcodeType.OBJECT, UcodeType.ARRAY]);
      if (node.arguments[1]) {
        this.validateArgumentType(node.arguments[1], 'proto', 2, [UcodeType.OBJECT, UcodeType.NULL]);
      }
    }

    return true;
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
