/**
 * Main Type Checker for ucode semantic analysis
 * Handles type inference and type checking
 */

import {
  type AstNode, type LiteralNode, type IdentifierNode, type BinaryExpressionNode, type UnaryExpressionNode,
  type CallExpressionNode, type MemberExpressionNode, type AssignmentExpressionNode, type ArrayExpressionNode,
  type ObjectExpressionNode, type ConditionalExpressionNode, type ArrowFunctionExpressionNode,
  type FunctionExpressionNode, type IfStatementNode, type ProgramNode, type BlockStatementNode,
  type ExpressionStatementNode, type FunctionDeclarationNode, type VariableDeclarationNode,
  type VariableDeclaratorNode, type ExportDefaultDeclarationNode, type ReturnStatementNode,
  type PropertyNode, type SwitchStatementNode, type SwitchCaseNode, type ForInStatementNode,
  type ExportNamedDeclarationNode, type ForStatementNode, type WhileStatementNode,
  type ThrowStatementNode, type TryStatementNode, type CatchClauseNode, type LogicalExpressionNode,
  type DeleteExpressionNode, type SpreadElementNode, type TemplateLiteralNode,
  type ImportDeclarationNode, type LabeledStatementNode
} from '../ast/nodes';
import { AnalysisDepthExceeded, MAX_ANALYSIS_DEPTH } from './visitor';

/** An AST node viewed as an open record, for dynamic traversal/field access. The base
 *  `AstNode` interface only enumerates `type`/`start`/`end`; specific node kinds carry many
 *  more fields that the generic walkers read after a `type`-string guard. */
type AnyNode = AstNode & Record<string, unknown>;

/** Narrow an arbitrary value to a traversable AST-like node (an object with a string `type`). */
function isAstNodeLike(n: unknown): n is AnyNode {
  return !!n && typeof n === 'object' && typeof (n as { type?: unknown }).type === 'string';
}

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
  // For variable-to-variable equality narrowing (e.g., if (x == y) → x gets y's type)
  // When isNegative is false, the variable is narrowed to this full type.
  // When isNegative is true (inequality), no narrowing is applied.
  equalityNarrowType?: UcodeDataType;
  // Symbol info from the other variable (for richer hover display)
  equalitySymbol?: UcodeSymbol;
  // Whether this guard came from null-propagating builtin pattern (e.g., length(x) > 0).
  // These should NOT be negated in early-exit fall-through because the negation
  // (e.g., length(x) <= 0) doesn't imply x is null — x could just be empty.
  isNullPropagation?: boolean;
}
import { SymbolTable, SymbolType, UcodeType, type UcodeDataType, type SingleType, isUnionType, getUnionTypes, createUnionType, isArrayType, createArrayType, getArrayElementType, isObjectType, singleTypeToBase, dataTypeToBase, extractModuleType, effectiveSymbolType, propertyTypeAt, type Symbol as UcodeSymbol } from './symbolTable';
import { FlowTypeEngine, makeAssignmentTransfer, type FlowEnvironment, type EdgeGuardFn } from './flowTypeEngine';
import { CFGBuilder } from './cfg/cfgBuilder';
import type { CheckResult } from './checkResult';
import { logicalTypeInference } from './logicalTypeInference';
import { arithmeticTypeInference } from './arithmeticTypeInference';
import { UcodeErrorCode } from './errorConstants';
import { BuiltinValidator, TypeCompatibilityChecker } from './checkers';
import { createExceptionObjectDataType } from './exceptionTypes';
import { allBuiltinFunctions } from '../builtins';
import { rtnlTypeRegistry } from './rtnlTypes';
import { nl80211TypeRegistry } from './nl80211Types';
import { Option } from 'effect';
import { isKnownObjectType, isKnownModule, MODULE_REGISTRIES, OBJECT_REGISTRIES, type KnownObjectType } from './moduleDispatch';
import { TypeNarrowingEngine } from './typeNarrowing';

// Builtins that return null when their key argument is null/wrong-type
const NULL_PROPAGATING_BUILTINS: Record<string, number> = {
  length: 0, keys: 0, values: 0, index: 0, rindex: 0,
  sort: 0, reverse: 0, uniq: 0, pop: 0, shift: 0,
  slice: 0, splice: 0, join: 1, trim: 0, ltrim: 0, rtrim: 0,
  ord: 0, split: 0, substr: 0, b64enc: 0, b64dec: 0, hexdec: 0,
};

// Functions that return null for ANY non-string argument at the given index AND do
// not coerce it (verified against the ucode runtime). A TRUTHY result therefore
// proves that argument was a string, so in the branch where the call succeeds we
// narrow it `unknown → string`. POSITIVE-ONLY: a falsy result does NOT prove a
// non-string (a valid string can yield null/empty too — missing file, empty match),
// so the failure branch is never narrowed. NB: uc()/lc() are EXCLUDED — they coerce
// (uc(123) -> "123"), so a truthy result wouldn't prove a string argument.
//
// GLOBAL builtins: matched as bare unshadowed identifiers (`match(x)`, `split(x)`).
const STRING_CONTRACT_GLOBAL_BUILTINS: Record<string, number> = {
  match: 0, substr: 0, trim: 0, ltrim: 0, rtrim: 0, split: 0, ord: 0, b64dec: 0, hexdec: 0,
};
// fs MODULE functions: matched only when the callee resolves to the fs module
// (`fs.stat(x)` or a `let stat = fs.stat` alias) — never a user's own `stat()`.
const STRING_CONTRACT_FS_BUILTINS: Record<string, number> = {
  stat: 0, lstat: 0, readfile: 0, open: 0, opendir: 0, realpath: 0, readlink: 0,
};

export interface FunctionSignature {
  name: string;
  parameters: UcodeType[];
  returnType: UcodeDataType;
  variadic?: boolean;
  minParams?: number;
  maxParams?: number;
  /** When true, null in returnType means only "wrong argument type" — safe to narrow
   *  away when argument types are known to be correct. */
  nullMeansWrongType?: boolean;
  /** Indices of parameters that must match for null narrowing (default: all required params).
   *  e.g., join(sep, arr) only cares about arg index 1 (the array). */
  narrowingArgs?: number[];
  /** When true, a wrong-typed argument is COERCED to the parameter type at runtime (the builtin
   *  is total — e.g. `uc`/`lc` stringify anything), so a type mismatch is not a hard error: it's
   *  a strict-gated warning (warn → error under `'use strict'`) plus a "coerce" quick-fix, never
   *  an always-error. Only `string`-coercing builtins use this today. */
  coercesArgToString?: boolean;
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
  data?: unknown;    // Additional data for quick fixes
}

export interface TypeWarning {
  message: string;
  start: number;
  end: number;
  severity: 'warning';
  code?: string;
  data?: unknown;
}

/**
 * Known numeric return ranges for builtins, used to flag constant (dead)
 * comparisons against out-of-range literals — `index() != -2`, `length() < 0`,
 * etc. `max: Infinity` = unbounded above. `canBeNull` marks builtins that return
 * null on wrong-type args (null coerces to 0 for `< <= > >=` but is never `==` a
 * number — see nullCompare). All entries verified against /usr/local/bin/ucode.
 * Extend by adding a row — no per-function logic needed.
 */
interface ReturnRange {
  fn: string;
  min: number;
  max: number;
  canBeNull: boolean;   // returns null on wrong-type args (null coerces to 0 for ordering, != is true)
  canBeNaN: boolean;    // returns NaN on bad input (every compare false except !=)
  desc: string;
  hint?: string;
  /** When set, this is a MODULE function (not a global): only apply when the call
   *  provably resolves to an import of this module, so a user's own same-named
   *  function (`abs`, `log`, …) isn't mis-flagged. */
  module?: string;
}

const BUILTIN_RETURN_RANGE: Record<string, ReturnRange> = {
  // Global builtins (always available, matched by bare name).
  index:  { fn: 'index',  min: -1, max: Infinity, canBeNull: true,  canBeNaN: false, desc: '-1 (not found) or a non-negative index', hint: 'Did you mean -1?' },
  rindex: { fn: 'rindex', min: -1, max: Infinity, canBeNull: true,  canBeNaN: false, desc: '-1 (not found) or a non-negative index', hint: 'Did you mean -1?' },
  length: { fn: 'length', min: 0,  max: Infinity, canBeNull: true,  canBeNaN: false, desc: 'a non-negative integer (or null on a non-collection)' },
  ord:    { fn: 'ord',    min: 0,  max: 255,      canBeNull: true,  canBeNaN: false, desc: 'a byte value 0–255 (or null on bad args/offset)' },
  // trace(level) returns the PREVIOUS trace level — a uint8_t, so 0–255, never null.
  trace:  { fn: 'trace',  min: 0,  max: 255,      canBeNull: false, canBeNaN: false, desc: 'the previous trace level, a value 0–255' },
  // system() returns the exit code (0–255) OR a NEGATIVE signal number (-WTERMSIG)
  // when the command is signal-killed — so it's bounded ABOVE by 255 but NOT below
  // (min: -Infinity). `system() < 0` is a legitimate signal check and is NOT flagged.
  system: { fn: 'system', min: -Infinity, max: 255, canBeNull: true, canBeNaN: false, desc: 'an exit code 0–255, or a negative signal number (or null)' },
  // math module functions (bounded/signed ranges; return NaN on bad input). Gated
  // on a verified `math` import so a user's own same-named function isn't flagged.
  abs:    { fn: 'abs',    min: 0,        max: Infinity,  canBeNull: false, canBeNaN: true, module: 'math', desc: 'a non-negative number (or NaN)' },
  sqrt:   { fn: 'sqrt',   min: 0,        max: Infinity,  canBeNull: false, canBeNaN: true, module: 'math', desc: 'a non-negative number (or NaN)' },
  exp:    { fn: 'exp',    min: 0,        max: Infinity,  canBeNull: false, canBeNaN: true, module: 'math', desc: 'a positive number (or NaN)' },
  cos:    { fn: 'cos',    min: -1,       max: 1,         canBeNull: false, canBeNaN: true, module: 'math', desc: 'a value in [-1, 1] (or NaN)' },
  sin:    { fn: 'sin',    min: -1,       max: 1,         canBeNull: false, canBeNaN: true, module: 'math', desc: 'a value in [-1, 1] (or NaN)' },
  atan2:  { fn: 'atan2',  min: -Math.PI, max: Math.PI,   canBeNull: false, canBeNaN: true, module: 'math', desc: 'a value in [-π, π] (or NaN)' },
};

/**
 * Numeric return ranges for METHODS on known handle objects (fs.file, io.handle,
 * uloop.timer, …), keyed by `"<objectType>.<method>"`. Distinct from the bare/
 * module registry above because the bound depends on BOTH the receiver's handle
 * type AND the method name — `close()` on an fs.file returns a boolean, but on an
 * fs.proc it's an exit code. Gated at the call site on `detectObjectType` proving
 * the receiver is that handle type, so a user object's same-named method (`.tell`,
 * `.write`, …) is never mis-flagged. All bounds verified against the C source and
 * /usr/local/bin/ucode. `count` = "bytes/offset/fd: a non-negative int, or null on
 * error" (null coerces to 0 for ordering — see nullCompare).
 */
const COUNT_OR_NULL = { min: 0, max: Infinity, canBeNull: true, canBeNaN: false } as const;
const METHOD_RETURN_RANGE: Record<string, ReturnRange> = {
  'fs.file.write':   { fn: 'fs.file.write',   ...COUNT_OR_NULL, desc: 'the number of bytes written (or null on error)' },
  'fs.file.tell':    { fn: 'fs.file.tell',    ...COUNT_OR_NULL, desc: 'a non-negative file offset (or null on error)' },
  'fs.file.fileno':  { fn: 'fs.file.fileno',  ...COUNT_OR_NULL, desc: 'a non-negative file descriptor (or null on error)' },
  'fs.proc.write':   { fn: 'fs.proc.write',   ...COUNT_OR_NULL, desc: 'the number of bytes written (or null on error)' },
  'fs.proc.fileno':  { fn: 'fs.proc.fileno',  ...COUNT_OR_NULL, desc: 'a non-negative file descriptor (or null on error)' },
  // proc.close() returns the exit code (0–255) OR a NEGATIVE signal number when
  // the child is signal-killed (verified: `popen('kill -TERM $$').close()` → -15),
  // so it's bounded ABOVE by 255 but NOT below — `close() < 0` is a legit signal
  // check and is NOT flagged. Mirrors the global system() entry.
  'fs.proc.close':   { fn: 'fs.proc.close',   min: -Infinity, max: 255, canBeNull: true, canBeNaN: false, desc: 'an exit code 0–255, or a negative signal number (or null)' },
  'io.handle.write':  { fn: 'io.handle.write',  ...COUNT_OR_NULL, desc: 'the number of bytes written (or null on error)' },
  'io.handle.tell':   { fn: 'io.handle.tell',   ...COUNT_OR_NULL, desc: 'a non-negative file offset (or null on error)' },
  'io.handle.fileno': { fn: 'io.handle.fileno', ...COUNT_OR_NULL, desc: 'a non-negative file descriptor (or null on error)' },
  // timer/interval remaining() → -1 (not armed) or a non-negative ms count. Can
  // also return null via `if (!timer) err_return(EINVAL)` (invalid `this`); for
  // the [-1,∞) range null (→0 for ordering) agrees with every interval verdict,
  // so canBeNull is behavior-neutral here — but it's the honest value.
  'uloop.timer.remaining':    { fn: 'uloop.timer.remaining',    min: -1, max: Infinity, canBeNull: true, canBeNaN: false, desc: '-1 (not armed) or a non-negative millisecond count (or null)', hint: 'Did you mean -1?' },
  'uloop.interval.remaining': { fn: 'uloop.interval.remaining', min: -1, max: Infinity, canBeNull: true, canBeNaN: false, desc: '-1 (not armed) or a non-negative millisecond count (or null)', hint: 'Did you mean -1?' },
};

/**
 * The COMPLETE closed set of strings ucode's `type()` can return — derived from
 * the C source (`uc_type` in lib.c + `ucv_typename` in types.c), NOT from a
 * runtime sample (the sample missed "resource"). `type(null)` returns null (no
 * string). Comparing `type(x)` to any string OUTSIDE this set is a constant
 * (dead) test — the classic JS-ism `type(x) == "number"` that silently never
 * matches. Note the ucode-specific gotchas: it's "int" not "integer", "bool"
 * not "boolean", "regexp" not "regex".
 */
const TYPE_RESULT_STRINGS = new Set<string>([
  'int', 'double', 'bool', 'string', 'array', 'object',
  'function', 'regexp', 'resource', 'upvalue', 'program', 'source', 'unknown',
]);

/** Common wrong `type()` strings → the correct ucode type name(s), for the
 *  diagnostic hint and the quick-fix. */
const TYPE_STRING_FIX: Record<string, string[]> = {
  number: ['int', 'double'], integer: ['int'], boolean: ['bool'], regex: ['regexp'],
  func: ['function'], fn: ['function'], callable: ['function'], closure: ['function'], cfunction: ['function'],
  float: ['double'], real: ['double'], str: ['string'], obj: ['object'], arr: ['array'],
};

/** Base types whose values can NEVER be `==` a scalar (number/string/bool)
 *  literal under ucode coercion — verified against the runtime: `[]`, `{}`, a
 *  function, a regexp, a resource handle (base OBJECT) and null are all `!=`
 *  every scalar. (Scalars themselves coerce: `true==1`, `1=="1"`, `0==""`.) */
const REF_EQ_BASES = new Set<UcodeType>([
  UcodeType.ARRAY, UcodeType.OBJECT, UcodeType.FUNCTION, UcodeType.REGEX, UcodeType.NULL,
]);
const REF_BASE_DISPLAY: Partial<Record<UcodeType, string>> = {
  [UcodeType.ARRAY]: 'array', [UcodeType.OBJECT]: 'object', [UcodeType.FUNCTION]: 'function',
  [UcodeType.REGEX]: 'regexp', [UcodeType.NULL]: 'null',
};

/** Common JS string/number members → the ucode builtin to use instead. Surfaced
 *  as a hint when a JS-ism like `s.startsWith(...)` is flagged. */
const SCALAR_MEMBER_HINTS: Record<string, string> = {
  length: 'Use length(x).',
  startsWith: 'Use index(x, prefix) == 0.',
  endsWith: 'Use a substr(x, …) comparison.',
  indexOf: 'Use index(x, …).',
  includes: 'Use index(x, …) != -1.',
  toUpperCase: 'Use uc(x).',
  toLowerCase: 'Use lc(x).',
  trim: 'Use trim(x).',
  trimStart: 'Use ltrim(x).',
  trimEnd: 'Use rtrim(x).',
  split: 'Use split(x, sep).',
  replace: 'Use replace(x, …).',
  substring: 'Use substr(x, …).',
  substr: 'Use substr(x, …).',
  slice: 'Use substr(x, …).',
  charAt: 'Use substr(x, i, 1).',
  charCodeAt: 'Use ord(x, i).',
  toFixed: 'Use sprintf("%.2f", x).',
  toString: 'Use sprintf("%s", x) or `"" + x`.',
};

export class TypeChecker {
  private symbolTable: SymbolTable;
  private builtinFunctions: Map<string, FunctionSignature>;
  private errors: TypeError[] = [];
  private warnings: TypeWarning[] = [];
  private builtinValidator: BuiltinValidator;
  private typeCompatibility: TypeCompatibilityChecker;
  private typeNarrowing: TypeNarrowingEngine;
  private assignmentTargetDepth = 0;
  private truthinessDepth = 0;
  private currentAST: ProgramNode | null = null;
  /** Per-node computed type cache. Replaces the old `(node as any)._fullType`
   *  side channel: `checkNode` populates this for every node it visits, so the
   *  rich type (unions, arrays, object shapes) is recoverable AFTER analysis
   *  via getTypeOf(node). Overwrite-on-revisit semantics match the old
   *  `_fullType` exactly (last checkNode call wins). WeakMap → no leak across
   *  ASTs (nodes are per-parse). */
  private nodeTypes = new WeakMap<AstNode, CheckResult>();
  private constantAssignmentProperties = new Map<string, Set<string>>();
  private strictMode = false;
  // Names that are non-strict implicit globals (bare-assigned somewhere). Shared from
  // the semantic analyzer so a call to one isn't reported "Undefined function".
  private implicitGlobalNames: ReadonlySet<string> = new Set();
  setImplicitGlobalNames(names: ReadonlySet<string>): void { this.implicitGlobalNames = names; }
  private globalPropertyNames: ReadonlySet<string> = new Set();
  setGlobalPropertyNames(names: ReadonlySet<string>): void { this.globalPropertyNames = names; }
  // Render-scope names injected by an include(path, {…}) — callable bare (not strict-gated).
  private injectedScopeNames: ReadonlySet<string> = new Set();
  setInjectedScopeNames(names: ReadonlySet<string>): void { this.injectedScopeNames = names; }
  // Types for those injected names, inferred cross-file from the scope VALUE expressions at
  // the include site (e.g. `{ direction: "input" }` → string). Used to type a bare read of an
  // injected name so member access / type() resolve. (phase 4b typing)
  private injectedScopeTypes: ReadonlyMap<string, UcodeDataType> = new Map();
  setInjectedScopeTypes(types: ReadonlyMap<string, UcodeDataType>): void { this.injectedScopeTypes = types; }
  private transitiveTypeAliases: string[] = [];
  /** Optional FileResolver used to read literal values from imported files when
   *  constant-folding `ns.A.B` member chains into property-key strings. */
  private fileResolver: { findExportedObjectPropertyLiteral(uri: string, exp: string, prop: string, display?: boolean): string | null } | null = null;

  setFileResolver(fr: { findExportedObjectPropertyLiteral(uri: string, exp: string, prop: string, display?: boolean): string | null }): void {
    this.fileResolver = fr;
  }

  constructor(symbolTable: SymbolTable) {
    this.symbolTable = symbolTable;
    this.builtinFunctions = new Map();
    this.builtinValidator = new BuiltinValidator();
    this.typeCompatibility = new TypeCompatibilityChecker();
    this.typeNarrowing = new TypeNarrowingEngine();

    // Inject type checker into builtin validator
    // Use a method that returns the full type description including unions
    this.builtinValidator.setTypeChecker(this.getNodeTypeDescription.bind(this));
    this.builtinValidator.setFullTypeChecker(this.getFullTypeFromNode.bind(this));

    this.initializeBuiltins();
  }

  public setTruthinessDepth(depth: number): void {
    this.truthinessDepth = depth;
  }

  /** Whether a pure-UNKNOWN builtin argument escalates to an error under 'use strict'
   *  (default true). Forwarded to the builtin validator. */
  public setStrictUnknownArguments(strict: boolean): void {
    this.builtinValidator.setStrictUnknownArguments(strict);
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
      { name: 'length', parameters: [UcodeType.UNKNOWN], returnType: createUnionType([UcodeType.INTEGER, UcodeType.NULL]), nullMeansWrongType: true },
      { name: 'substr', parameters: [UcodeType.STRING, UcodeType.INTEGER], returnType: createUnionType([UcodeType.STRING, UcodeType.NULL]), nullMeansWrongType: true, narrowingArgs: [0], minParams: 2, maxParams: 3 },
      { name: 'split', parameters: [UcodeType.STRING, UcodeType.STRING], returnType: createUnionType([UcodeType.ARRAY, UcodeType.NULL]), nullMeansWrongType: true, minParams: 2, maxParams: 3 },
      { name: 'join', parameters: [UcodeType.STRING, UcodeType.ARRAY], returnType: createUnionType([UcodeType.STRING, UcodeType.NULL]), nullMeansWrongType: true, narrowingArgs: [1] },
      { name: 'trim', parameters: [UcodeType.STRING], returnType: createUnionType([UcodeType.STRING, UcodeType.NULL]), nullMeansWrongType: true, narrowingArgs: [0], minParams: 1, maxParams: 2 },
      { name: 'ltrim', parameters: [UcodeType.STRING], returnType: createUnionType([UcodeType.STRING, UcodeType.NULL]), nullMeansWrongType: true, narrowingArgs: [0], minParams: 1, maxParams: 2 },
      { name: 'rtrim', parameters: [UcodeType.STRING], returnType: createUnionType([UcodeType.STRING, UcodeType.NULL]), nullMeansWrongType: true, narrowingArgs: [0], minParams: 1, maxParams: 2 },
      { name: 'chr', parameters: [UcodeType.INTEGER], returnType: UcodeType.STRING },
      { name: 'ord', parameters: [UcodeType.STRING], returnType: createUnionType([UcodeType.INTEGER, UcodeType.NULL]) },
      { name: 'uc', parameters: [UcodeType.STRING], returnType: createUnionType([UcodeType.STRING, UcodeType.NULL]), nullMeansWrongType: true, coercesArgToString: true },
      { name: 'lc', parameters: [UcodeType.STRING], returnType: createUnionType([UcodeType.STRING, UcodeType.NULL]), nullMeansWrongType: true, coercesArgToString: true },
      { name: 'type', parameters: [UcodeType.UNKNOWN], returnType: createUnionType([UcodeType.STRING, UcodeType.NULL]) },
      { name: 'keys', parameters: [UcodeType.OBJECT], returnType: createUnionType([UcodeType.ARRAY, UcodeType.NULL]), nullMeansWrongType: true },
      { name: 'values', parameters: [UcodeType.OBJECT], returnType: createUnionType([UcodeType.ARRAY, UcodeType.NULL]), nullMeansWrongType: true },
      { name: 'push', parameters: [UcodeType.ARRAY], returnType: UcodeType.UNKNOWN, variadic: true },
      { name: 'pop', parameters: [UcodeType.ARRAY], returnType: UcodeType.UNKNOWN },
      { name: 'shift', parameters: [UcodeType.ARRAY], returnType: UcodeType.UNKNOWN },
      { name: 'unshift', parameters: [UcodeType.ARRAY], returnType: UcodeType.UNKNOWN, variadic: true },
      { name: 'filter', parameters: [UcodeType.ARRAY, UcodeType.FUNCTION], returnType: createUnionType([UcodeType.ARRAY, UcodeType.NULL]) },
      { name: 'index', parameters: [UcodeType.UNKNOWN, UcodeType.UNKNOWN], returnType: createUnionType([UcodeType.INTEGER, UcodeType.NULL]), nullMeansWrongType: true, narrowingArgs: [0] },
      // index() and rindex() share the same C impl (uc_index) and both accept a string OR
      // array haystack; the `parameters` model can't express a `string | array` union, so use
      // UNKNOWN for arg 1 exactly like `index` above (was STRING-only — a latent wrong base
      // masked only by validateRindexFunction). (auto-docs #179)
      { name: 'rindex', parameters: [UcodeType.UNKNOWN, UcodeType.UNKNOWN], returnType: createUnionType([UcodeType.INTEGER, UcodeType.NULL]), nullMeansWrongType: true, narrowingArgs: [0] },
      { name: 'require', parameters: [UcodeType.STRING], returnType: UcodeType.UNKNOWN },
      { name: 'include', parameters: [UcodeType.STRING], returnType: UcodeType.UNKNOWN },
      { name: 'json', parameters: [UcodeType.UNKNOWN], returnType: UcodeType.UNKNOWN },
      { name: 'match', parameters: [UcodeType.STRING, UcodeType.STRING], returnType: createUnionType([UcodeType.ARRAY, UcodeType.NULL]) },
      // replace() returns null ONLY when the subject (arg 0) is null — the search
      // arg accepts string OR regex (so a regex must not trip the null-narrowing),
      // and the subject is otherwise coerced to string. So narrow on arg 0 only.
      { name: 'replace', parameters: [UcodeType.STRING, UcodeType.STRING, UcodeType.STRING], returnType: createUnionType([UcodeType.STRING, UcodeType.NULL]), nullMeansWrongType: true, narrowingArgs: [0] },
      { name: 'system', parameters: [UcodeType.UNKNOWN], returnType: UcodeType.INTEGER, minParams: 1, maxParams: 2 },
      { name: 'time', parameters: [], returnType: UcodeType.INTEGER },
      { name: 'sleep', parameters: [UcodeType.INTEGER], returnType: UcodeType.BOOLEAN },
      { name: 'localtime', parameters: [], returnType: createUnionType([UcodeType.OBJECT, UcodeType.NULL]), minParams: 0, maxParams: 1 },
      { name: 'gmtime', parameters: [], returnType: createUnionType([UcodeType.OBJECT, UcodeType.NULL]), minParams: 0, maxParams: 1 },
      { name: 'timelocal', parameters: [UcodeType.OBJECT], returnType: createUnionType([UcodeType.INTEGER, UcodeType.NULL]) },
      { name: 'timegm', parameters: [UcodeType.OBJECT], returnType: createUnionType([UcodeType.INTEGER, UcodeType.NULL]) },
      { name: 'min', parameters: [], returnType: UcodeType.UNKNOWN, variadic: true },
      { name: 'max', parameters: [], returnType: UcodeType.UNKNOWN, variadic: true },
      { name: 'uniq', parameters: [UcodeType.ARRAY], returnType: createUnionType([UcodeType.ARRAY, UcodeType.NULL]), nullMeansWrongType: true },
      { name: 'b64enc', parameters: [UcodeType.STRING], returnType: createUnionType([UcodeType.STRING, UcodeType.NULL]), nullMeansWrongType: true },
      { name: 'b64dec', parameters: [UcodeType.STRING], returnType: createUnionType([UcodeType.STRING, UcodeType.NULL]) },
      // hexenc stringifies ANY value (lib.c uc_hexenc → ucv_to_stringbuf), unlike b64enc which
      // genuinely requires a string — so a non-string is a coercion (warn + fix), not an error (#35).
      { name: 'hexenc', parameters: [UcodeType.STRING], returnType: createUnionType([UcodeType.STRING, UcodeType.NULL]), nullMeansWrongType: true, coercesArgToString: true },
      { name: 'hexdec', parameters: [UcodeType.STRING, UcodeType.STRING], returnType: createUnionType([UcodeType.STRING, UcodeType.NULL]), minParams: 1, maxParams: 2 },
      { name: 'hex', parameters: [UcodeType.STRING], returnType: createUnionType([UcodeType.INTEGER, UcodeType.DOUBLE]) },
      { name: 'uchr', parameters: [UcodeType.INTEGER], returnType: UcodeType.STRING },
      { name: 'iptoarr', parameters: [UcodeType.STRING], returnType: createUnionType([UcodeType.ARRAY, UcodeType.NULL]) },
      { name: 'arrtoip', parameters: [UcodeType.ARRAY], returnType: createUnionType([UcodeType.STRING, UcodeType.NULL]) },
      { name: 'int', parameters: [UcodeType.UNKNOWN], returnType: createUnionType([UcodeType.INTEGER, UcodeType.DOUBLE]), minParams: 1, maxParams: 2 },
      { name: 'loadstring', parameters: [UcodeType.STRING], returnType: createUnionType([UcodeType.FUNCTION, UcodeType.NULL]) },
      { name: 'loadfile', parameters: [UcodeType.STRING], returnType: createUnionType([UcodeType.FUNCTION, UcodeType.NULL]) },
      { name: 'wildcard', parameters: [UcodeType.STRING, UcodeType.STRING], returnType: createUnionType([UcodeType.BOOLEAN, UcodeType.NULL]), nullMeansWrongType: true },
      { name: 'regexp', parameters: [UcodeType.STRING], returnType: UcodeType.REGEX, minParams: 1, maxParams: 2 },
      { name: 'assert', parameters: [], returnType: UcodeType.UNKNOWN, variadic: true, minParams: 0 }, // Returns first argument (reflective) - accepts any truish types
      { name: 'call', parameters: [UcodeType.FUNCTION], returnType: UcodeType.UNKNOWN, variadic: true },
      { name: 'signal', parameters: [UcodeType.INTEGER], returnType: createUnionType([UcodeType.FUNCTION, UcodeType.STRING, UcodeType.NULL]), minParams: 1, maxParams: 2 },
      { name: 'clock', parameters: [UcodeType.BOOLEAN], returnType: UcodeType.ARRAY, minParams: 0, maxParams: 1 },
      
      { name: 'sourcepath', parameters: [UcodeType.INTEGER, UcodeType.BOOLEAN], minParams: 0, maxParams: 2, returnType: createUnionType([UcodeType.STRING, UcodeType.NULL]) },
      { name: 'gc', parameters: [], returnType: UcodeType.BOOLEAN, minParams: 0, maxParams: 2 },
      { name: 'die', parameters: [], returnType: UcodeType.NULL, minParams: 0, maxParams: 1 },
      { name: 'exists', parameters: [UcodeType.OBJECT, UcodeType.STRING], returnType: UcodeType.BOOLEAN },
      { name: 'exit', parameters: [], returnType: UcodeType.NULL, minParams: 0, maxParams: 1 },
      { name: 'getenv', parameters: [UcodeType.STRING], returnType: createUnionType([UcodeType.STRING, UcodeType.NULL]), minParams: 0, maxParams: 1 },
      { name: 'map', parameters: [UcodeType.ARRAY, UcodeType.FUNCTION], returnType: createUnionType([UcodeType.ARRAY, UcodeType.NULL]) },
      { name: 'reverse', parameters: [UcodeType.UNKNOWN], returnType: UcodeType.UNKNOWN },
      { name: 'sort', parameters: [UcodeType.UNKNOWN], returnType: createUnionType([UcodeType.ARRAY, UcodeType.NULL]), minParams: 1, maxParams: 2 },
      { name: 'splice', parameters: [UcodeType.ARRAY, UcodeType.INTEGER], returnType: createUnionType([UcodeType.ARRAY, UcodeType.NULL]), nullMeansWrongType: true, narrowingArgs: [0], variadic: true },
      { name: 'slice', parameters: [UcodeType.ARRAY, UcodeType.INTEGER], returnType: createUnionType([UcodeType.ARRAY, UcodeType.NULL]), nullMeansWrongType: true, narrowingArgs: [0], minParams: 2, maxParams: 3 },
      { name: 'warn', parameters: [], returnType: UcodeType.INTEGER, variadic: true },
      { name: 'trace', parameters: [UcodeType.INTEGER], returnType: createUnionType([UcodeType.INTEGER, UcodeType.NULL]), minParams: 0, maxParams: 1 },
      { name: 'proto', parameters: [UcodeType.OBJECT], returnType: createUnionType([UcodeType.OBJECT, UcodeType.NULL]), minParams: 1, maxParams: 2 },
      // Two-faced: render(path:string, scope?:object) OR render(fn:function, ...args). The
      // arity/type rules per form are enforced by validateRenderFunction (variadic here so the
      // generic fallback, if ever reached, is lenient). Both forms return string|null.
      { name: 'render', parameters: [UcodeType.STRING], returnType: createUnionType([UcodeType.STRING, UcodeType.NULL]), variadic: true, minParams: 1 },
      
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

  /**
   * Compute a node's type WITHOUT emitting any diagnostics. For inference-only queries on
   * a node the caller has already validated in its proper context (e.g. an expression-body
   * arrow's return type — its body is validated during the semantic visit, so re-checking
   * it here must not double-report). Snapshots and restores both this checker's and the
   * builtin validator's error/warning buffers (getErrors/getWarnings return the live arrays).
   */
  checkNodeQuietly(node: AstNode): UcodeDataType {
    const tcE = this.errors.length, tcW = this.warnings.length;
    const bvErr = this.builtinValidator.getErrors(), bvWarn = this.builtinValidator.getWarnings();
    const bvE = bvErr.length, bvW = bvWarn.length;
    const result = this.checkNode(node);
    this.errors.length = tcE;
    this.warnings.length = tcW;
    bvErr.length = bvE;
    bvWarn.length = bvW;
    return result;
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

  /**
   * Constant-fold an expression to its property-key form (the string ucode
   * would coerce it to at runtime: 64 → "64", "foo" → "foo"). Used to resolve
   * the KEY in `obj[expr]` so we can hit `propertyTypes` deterministically.
   * Returns null when the expression isn't statically resolvable (function
   * calls, arithmetic, identifier without a literal init — all the cases the
   * sanity tests exercise to confirm we degrade to `unknown` rather than
   * lying).
   */
  private resolvePropertyKeyToString(node: AstNode): string | null {
    if (node.type === 'Literal') {
      const lit = node as LiteralNode;
      if (lit.value === undefined || lit.value === null) return null;
      return String(lit.value);
    }
    if (node.type === 'UnaryExpression') {
      const u = node as any;
      if (u.operator === '-' && u.argument?.type === 'Literal' && typeof u.argument.value === 'number') {
        return String(-u.argument.value);
      }
      return null;
    }
    if (node.type === 'Identifier') {
      const sym = this.symbolTable.lookupAtPosition((node as IdentifierNode).name, node.start)
                ?? this.symbolTable.lookup((node as IdentifierNode).name);
      if (sym?.initNode) return this.resolvePropertyKeyToString(sym.initNode);
      return null;
    }
    if (node.type === 'MemberExpression') {
      const mem = node as MemberExpressionNode;
      if (mem.computed) return null;
      // Chained namespace constant: `ns.A.B` where `ns` is `import * as ns from 'file.uc'`.
      // Asks the namespace's source file for the raw literal of inner key B.
      if (this.fileResolver && mem.object.type === 'MemberExpression') {
        const inner = mem.object as MemberExpressionNode;
        if (!inner.computed && inner.object.type === 'Identifier') {
          const baseName = (inner.object as IdentifierNode).name;
          const baseSym = this.symbolTable.lookupAtPosition(baseName, node.start) ?? this.symbolTable.lookup(baseName);
          const aName = this.getStaticPropertyName(inner.property);
          const bName = this.getStaticPropertyName(mem.property);
          if (baseSym?.type === SymbolType.IMPORTED && baseSym.importSpecifier === '*'
              && baseSym.importedFrom && baseSym.importedFrom.startsWith('file://')
              && aName && bName) {
            return this.fileResolver.findExportedObjectPropertyLiteral(baseSym.importedFrom, aName, bName, false);
          }
        }
      }
      return null;
    }
    return null;
  }

  /**
   * Build a union over an object's known property values. Used when we can
   * prove the access key is one of the object's keys (via keys-of provenance)
   * but can't pin it to a specific one. Returns null on an empty map.
   * Singletons return the single type (no needless union wrapping).
   */
  private computePropertyValueUnion(propertyTypes: Map<string, UcodeDataType>): UcodeDataType | null {
    if (propertyTypes.size === 0) return null;
    const members: SingleType[] = [];
    for (const t of propertyTypes.values()) {
      if (typeof t === 'string') {
        members.push(t as UcodeType);
      } else if (isUnionType(t)) {
        for (const m of t.types) members.push(m);
      } else if (isObjectType(t) || isArrayType(t)) {
        members.push(t as SingleType);
      } else {
        // ModuleType etc. — collapse to OBJECT to keep the union renderable
        members.push(UcodeType.OBJECT);
      }
    }
    return createUnionType(members);
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

  private _checkDepth = 0;

  // Incremental: byte ranges of unchanged function/method bodies. checkNode short-circuits
  // inside them (emits nothing, no recursion). For a node with a cached type it returns that
  // (so hover/inference still resolve); otherwise UNKNOWN. The analyzer restores the cached
  // return type and replays diagnostics. Ranges sorted by start for binary search.
  private cleanRanges: Array<{ start: number; end: number }> = [];
  setCleanRanges(ranges: Array<{ start: number; end: number }>): void {
    this.cleanRanges = [...ranges].sort((a, b) => a.start - b.start);
  }
  private inCleanRange(off: number): boolean {
    let lo = 0, hi = this.cleanRanges.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const r = this.cleanRanges[mid]!;
      if (off < r.start) hi = mid - 1;
      else if (off >= r.end) lo = mid + 1;
      else return true;
    }
    return false;
  }

  checkNode(node: AstNode): CheckResult {
    if (!node) return UcodeType.UNKNOWN;
    // Incremental skip: inside an unchanged body, don't recompute types or emit diagnostics.
    // Returns UNKNOWN — the analyzer restores the body's cached RETURN type (which is what
    // escapes), and hover/completion for skipped bodies are served from a lazily-computed full
    // analysis in the server (not from this fast diagnostics pass). Sound: verified by the
    // incremental≡full harness.
    if (this.cleanRanges.length > 0 && typeof node.start === 'number' && this.inCleanRange(node.start)) {
      return UcodeType.UNKNOWN;
    }
    // Depth guard: checkNode recurses on its own stack (independent of the visitor), so a
    // deeply-nested expression can overflow HERE. Bail predictably before that. (#117)
    this._checkDepth++;
    try {
      if (this._checkDepth > MAX_ANALYSIS_DEPTH) throw new AnalysisDepthExceeded(MAX_ANALYSIS_DEPTH);
      return this.checkNodeInner(node);
    } finally {
      this._checkDepth--;
    }
  }

  private checkNodeInner(node: AstNode): CheckResult {
    const result = this.dispatchCheck(node);
    // Single source of truth: cache the rich result for post-analysis reads
    // (hover, completion, semanticAnalyzer) via getTypeOf. Replaces the old
    // per-method `(node as any)._fullType = …` writes.
    //
    // Guard: never let an UNKNOWN result CLOBBER an existing known entry. The
    // same node can be re-checked at a point where its scope has exited
    // (symbol lookup fails → checkIdentifier returns UNKNOWN); the old
    // `_fullType` writes lived inside `if (symbol)`, so that spurious UNKNOWN
    // never overwrote a good type. An UNKNOWN still writes when nothing is
    // cached yet; a later known result still upgrades an UNKNOWN.
    if (result !== UcodeType.UNKNOWN || !this.nodeTypes.has(node)) {
      this.nodeTypes.set(node, result);
    }
    return result;
  }

  /** The rich type previously computed for `node` by checkNode, or undefined
   *  if it was never checked. This is the typed replacement for reading
   *  `(node as any)._fullType`. */
  getTypeOf(node: AstNode): CheckResult | undefined {
    return this.nodeTypes.get(node);
  }

  private dispatchCheck(node: AstNode): CheckResult {
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
      case 'ThisExpression':
        return UcodeType.OBJECT;
      case 'DeleteExpression':
        return this.checkDeleteExpression(node as DeleteExpressionNode);
      default:
        return UcodeType.UNKNOWN;
    }
  }

  /**
   * `delete` removes an OBJECT property. Applied to an array element (`delete
   * arr[i]`) ucode throws at runtime ("left-hand side expression is not an
   * object"). Flag it when the receiver is provably an array; `delete obj.k` and
   * `delete obj[k]` (object receiver, or unknown) stay clean.
   */
  private checkDeleteExpression(node: DeleteExpressionNode): CheckResult {
    const arg = node.argument;

    if (arg.type === 'MemberExpression' && (arg as MemberExpressionNode).computed) {
      const objNode = (arg as MemberExpressionNode).object;
      const objType = this.checkNode(objNode) ?? UcodeType.UNKNOWN;
      // Only when the receiver is DEFINITELY an array (not a union like array|null,
      // not unknown) — otherwise we can't be sure it isn't a deletable object.
      if (isArrayType(objType) || objType === UcodeType.ARRAY) {
        this.errors.push({
          message: `'delete' removes object properties; the left-hand side here is an array. Deleting an array element is a runtime error in ucode.`,
          start: node.start,
          end: node.end,
          severity: 'error',
          code: UcodeErrorCode.INVALID_OPERATION,
        });
      }
    }
    return UcodeType.UNKNOWN;
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

  private checkLiteral(node: LiteralNode): CheckResult {
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

  private checkIdentifier(node: IdentifierNode): CheckResult {
    const symbol = this.symbolTable.lookup(node.name);
    if (symbol) {
      this.symbolTable.markUsed(node.name, node.start);

      // The identifier's type is the symbol's SSA-effective type at this point.
      // (Phase C: the guardContextStack + FlowSensitiveTypeTracker narrowing that
      // used to wrap this was proven redundant — disabling both reads changed no
      // diagnostics across the corpus + suites + the differential harness — so
      // they were deleted. Guard narrowing for diagnostics flows through the
      // arg-validation path's getGuardsForPosition and the engine-backed
      // post-visit filter; for hover/completion through getNarrowedTypeAtPosition.)
      //
      // Return the rich type directly — unions, arrays, object shapes flow
      // through the return value (and the central checkNode cache).
      return this.getEffectiveSymbolDataType(symbol, node.start);
    } else {
      // Check if it's a builtin function
      const isBuiltin = allBuiltinFunctions.has(node.name);
      if (isBuiltin) return UcodeType.FUNCTION;
      // An include() render-scope injected name carrying a cross-file-inferred type
      // (from the scope value expression at the include site) — resolve to that type so
      // `type(x)` / member access on it work. (phase 4b typing)
      const injected = this.injectedScopeTypes.get(node.name);
      if (injected !== undefined) return injected;
      // UNKNOWN for truly undefined variables (the SemanticAnalyzer reports UC1001).
      return UcodeType.UNKNOWN;
    }
  }

  private getEffectiveSymbolDataType(symbol: UcodeSymbol, position: number): UcodeDataType {
    return effectiveSymbolType(symbol, position);
  }

  private checkBinaryExpression(node: BinaryExpressionNode): CheckResult {
    const leftType = this.checkNode(node.left);
    const rightType = this.checkNode(node.right);

    // Type checking for binary operators
    switch (node.operator) {
      case '+':
      case '-':
      case '*':
      case '/':
      case '%':
      case '**': {
        // Lint operations that provably evaluate to NaN (array/object/function/
        // regex operand). Result type is unaffected — this is just a warning.
        this.checkNaNArithmetic(node, node.operator, this.dataTypeToUcodeType(leftType), this.dataTypeToUcodeType(rightType));

        // leftType/rightType are already the rich types (checkNode returns them).
        let leftFullType: UcodeDataType = leftType;
        let rightFullType: UcodeDataType = rightType;

        // Every operator except `+` coerces a string operand to a number: a
        // string literal classifies to int/double by its contents, an unknown
        // string to `integer | double`. (`+` with a string is concatenation.)
        if (node.operator !== '+') {
          leftFullType = this.coerceStringForArithmetic(node.left, leftFullType);
          rightFullType = this.coerceStringForArithmetic(node.right, rightFullType);
        }

        // Distribute over union members so e.g. `(integer | string) + 1` yields
        // `integer | string`. The full-type path also handles the plain
        // single-type case (it collapses to one member). Return the rich result
        // directly — unions flow through unchanged.
        return node.operator === '+'
          ? arithmeticTypeInference.inferAdditionFullType(leftFullType, rightFullType)
          : arithmeticTypeInference.inferArithmeticFullType(leftFullType, rightFullType, node.operator);
      }

      case '==':
      case '!=':
      case '===':
      case '!==':
      case '<':
      case '>':
      case '<=':
      case '>=':
        this.checkConstantComparison(node);
        this.checkTypeStringComparison(node);
        this.checkIncompatibleEquality(node);
        return this.typeCompatibility.getComparisonResultType();

      case '??': {
        // Nullish coalescing `a ?? b`: the result is `b` exactly when `a` is
        // null, else `a`. So the result type is (a with null removed) ∪ b.
        // leftType/rightType are rich now, so we handle nullable unions
        // properly instead of returning the whole left union verbatim.
        if (leftType === UcodeType.NULL) {
          return rightType; // always null → always falls back to b
        }
        const leftNonNull = this.typeNarrowing.removeNullFromType(leftType);
        if (leftNonNull.excludedTypes.length === 0) {
          return leftType; // a can't be null → b unreachable
        }
        // `a ?? []` with an EMPTY array literal as the fallback: the empty array
        // contributes no elements, so the result is exactly a-without-null. This keeps
        // the common `lsdir(...) ?? []` idiom typed `array<string>` (and for-in over it
        // `string`) instead of `array<string> | array` → element `unknown`. Sound: the
        // fallback is provably empty. (Bare `[]` is typed UcodeType.ARRAY, which would
        // otherwise dilute the typed-array element type to unknown in the union below.)
        if (node.right.type === 'ArrayExpression'
            && (node.right as ArrayExpressionNode).elements.length === 0
            && isArrayType(leftNonNull.narrowedType)) {
          return leftNonNull.narrowedType;
        }
        // a is nullable → (a without null) ∪ b
        return createUnionType([
          ...getUnionTypes(leftNonNull.narrowedType),
          ...getUnionTypes(rightType),
        ]);
      }

      case '&&':
      case '||': {
        // leftType/rightType are already rich (checkNode returns them).
        const leftFullType: UcodeDataType = leftType;
        const rightFullType: UcodeDataType = rightType;
        // Return the rich union directly — `string | null` etc. flows through.
        return node.operator === '||'
          ? logicalTypeInference.inferLogicalOrFullType(leftFullType, rightFullType)
          : logicalTypeInference.inferLogicalAndFullType(leftFullType, rightFullType);
      }

      case '&':
      case '|':
      case '^':
      case '<<':
      case '>>': {
        // Add warning for unexpected types (but still allow the operation).
        // Collapse to base enum for the singleton checks + readable message.
        const leftBase = this.dataTypeToUcodeType(leftType);
        const rightBase = this.dataTypeToUcodeType(rightType);
        const isLeftExpected = leftBase === UcodeType.BOOLEAN || leftBase === UcodeType.INTEGER || leftBase === UcodeType.UNKNOWN;
        const isRightExpected = rightBase === UcodeType.BOOLEAN || rightBase === UcodeType.INTEGER || rightBase === UcodeType.UNKNOWN;

        if (!isLeftExpected || !isRightExpected) {
          this.warnings.push({
            message: `Bitwise operation on unexpected types: ${leftBase} ${node.operator} ${rightBase}. Consider using boolean or integer types for clarity.`,
            start: node.start,
            end: node.end,
            severity: 'warning',
            code: UcodeErrorCode.INVALID_OPERATION,
          });
        }

        return this.typeCompatibility.getBitwiseResultType();
      }

      case 'in':
        return this.checkInOperator(node, this.dataTypeToUcodeType(leftType), this.dataTypeToUcodeType(rightType));

      default:
        return UcodeType.UNKNOWN;
    }
  }

  private checkUnaryExpression(node: UnaryExpressionNode): CheckResult {
    if (node.operator === '!') this.truthinessDepth++;
    const argType = this.checkNode(node.argument);
    if (node.operator === '!') this.truthinessDepth--;

    // Numeric unary operators on a value that can't convert to a number always
    // yield NaN (e.g. -[1], ++{}). ucode doesn't throw, so warn rather than error.
    if (node.operator === '+' || node.operator === '-' || node.operator === '++' || node.operator === '--') {
      this.checkNaNArithmetic(node, node.operator, this.dataTypeToUcodeType(argType), null);
      // A string coerces to a number; negation/increment preserve int vs double,
      // so the result type IS the coercion type (e.g. -"42" → integer).
      if (argType === UcodeType.STRING) {
        // Return the rich coercion result directly (may be `integer | double`).
        return this.coerceStringForArithmetic(node.argument, argType);
      }
    }

    return this.typeCompatibility.getUnaryResultType(this.dataTypeToUcodeType(argType), node.operator);
  }

  /** array/object/function/regex can never convert to a finite number → NaN in arithmetic. */
  private producesNaNInArithmetic(type: UcodeType): boolean {
    return type === UcodeType.ARRAY || type === UcodeType.OBJECT ||
           type === UcodeType.FUNCTION || type === UcodeType.REGEX;
  }

  /** The numeric value of a literal, or a unary +/- on one (`-2`); else null. */
  private numericLiteralValue(node: AstNode): number | null {
    let n: AstNode = node;
    let sign = 1;
    if (n.type === 'UnaryExpression') {
      const u = n as UnaryExpressionNode;
      if (u.operator === '-' || u.operator === '+') {
        if (u.operator === '-') sign = -1;
        n = u.argument;
      }
    }
    if (n.type === 'Literal' && typeof (n as LiteralNode).value === 'number') return sign * ((n as LiteralNode).value as number);
    return null;
  }

  private flipComparison(op: string): string {
    switch (op) { case '<': return '>'; case '>': return '<'; case '<=': return '>='; case '>=': return '<='; default: return op; }
  }

  /** Is `arr[index]` provably IN BOUNDS at `position`? Computed array access is
   *  typed `element | null` because ucode returns null past the end — but when an
   *  enclosing `if (length(arr) <op> N)` guard establishes a lower bound on the
   *  length that exceeds a literal index, the access can't miss, so the null
   *  drops (e.g. `if (length(parts) == 10) { … parts[3] … }` → parts[3] is string).
   *  Handles the positive (consequent) branch + `&&` chains; conservative else. */
  private arrayIndexProvenInBounds(arrName: string, index: number, position: number): boolean {
    const ast = this.currentAST;
    if (!ast || index < 0) return false;
    let proven = false;
    const checkTest = (test: AstNode | null | undefined): void => {
      if (proven || !test) return;
      if (test.type === 'BinaryExpression') {
        const b = test as BinaryExpressionNode;
        if (b.operator === '&&') { checkTest(b.left); checkTest(b.right); return; }
        const lowerBound = this.lengthLowerBound(b, arrName);
        if (lowerBound !== null && index < lowerBound) proven = true;
      }
    };
    const walk = (node: unknown): void => {
      if (proven || !isAstNodeLike(node)) return;
      if (node.type === 'IfStatement') {
        const ifNode = node as unknown as IfStatementNode;
        if (ifNode.consequent
            && position >= ifNode.consequent.start && position <= ifNode.consequent.end) {
          checkTest(ifNode.test);
        }
      }
      for (const k of Object.keys(node)) {
        if (k === 'leadingJsDoc') continue;
        const v = node[k];
        if (Array.isArray(v)) { for (const it of v) walk(it); }
        else if (isAstNodeLike(v)) walk(v);
      }
    };
    walk(ast);
    return proven;
  }

  /** For `length(arr) <op> N` (either operand order) in its TRUE branch, the
   *  minimum L such that `length(arr) >= L` is guaranteed — or null when the
   *  comparison gives no lower bound (`<`, `<=`, `!=`). */
  /** True when `n` is exactly `length(arrName)`. */
  private isLengthCall(n: AstNode, arrName: string): boolean {
    if (n?.type !== 'CallExpression') return false;
    const c = n as CallExpressionNode;
    return c.callee?.type === 'Identifier'
      && (c.callee as IdentifierNode).name === 'length'
      && c.arguments?.length === 1
      && c.arguments[0]?.type === 'Identifier'
      && (c.arguments[0] as IdentifierNode).name === arrName;
  }

  private lengthLowerBound(b: BinaryExpressionNode, arrName: string): number | null {
    let op: string = b.operator;
    let lit: number | null;
    if (this.isLengthCall(b.left, arrName)) {
      lit = this.numericLiteralValue(b.right);
    } else if (this.isLengthCall(b.right, arrName)) {
      lit = this.numericLiteralValue(b.left);
      op = this.flipComparison(op); // normalize to `length(arr) <op> lit`
    } else {
      return null;
    }
    if (lit === null) return null;
    switch (op) {
      case '==':
      case '===': return lit;     // length == N → length >= N
      case '>=':  return lit;     // length >= N → length >= N
      case '>':   return lit + 1; // length > N  → length >= N+1
      default:    return null;    // <, <=, != → no lower bound
    }
  }

  /** Does a computed array access `obj[prop]` resolve to an in-bounds element
   *  (so the usual `| null` for out-of-bounds doesn't apply)? Covers a literal
   *  index proven by a `length(arr)` guard, and a variable index that is the
   *  induction variable of a `for (i=0; i < length(arr); …)` loop. */
  private computedAccessInBounds(objNode: AstNode, propNode: AstNode, position: number): boolean {
    if (objNode.type !== 'Identifier') return false;
    const arrName = (objNode as IdentifierNode).name;
    const litIdx = this.numericLiteralValue(propNode);
    if (litIdx !== null) return this.arrayIndexProvenInBounds(arrName, litIdx, position);
    if (propNode.type === 'Identifier') return this.arrayIndexInBoundsViaLoop(arrName, (propNode as IdentifierNode).name, position);
    return false;
  }

  /** Is `arr[idxVar]` in bounds because it sits inside a canonical index loop
   *  `for (idxVar = 0…; idxVar < length(arr); …) { … arr[idxVar] … }`? The test
   *  guarantees `idxVar < length(arr)` on entry to the body and the init a
   *  non-negative start, so every `arr[idxVar]` in the body is in range — hence
   *  non-null. Conservative: bails if `idxVar` or `arr` is reassigned anywhere in
   *  the body (the bound could then be stale). */
  private arrayIndexInBoundsViaLoop(arrName: string, idxVar: string, position: number): boolean {
    const ast = this.currentAST;
    if (!ast) return false;
    const isIdx = (n: AstNode | null | undefined): boolean =>
      n?.type === 'Identifier' && (n as IdentifierNode).name === idxVar;

    // test guarantees `idxVar < length(arr)` (either operand order).
    const testProvesUpper = (test: AstNode | null): boolean => {
      if (test?.type !== 'BinaryExpression') return false;
      const b = test as BinaryExpressionNode;
      if (b.operator === '<' && isIdx(b.left) && this.isLengthCall(b.right, arrName)) return true;
      if (b.operator === '>' && this.isLengthCall(b.left, arrName) && isIdx(b.right)) return true;
      return false;
    };
    // init establishes `idxVar = <non-negative literal>`.
    const initProvesLower = (init: AstNode | null): boolean => {
      if (init?.type === 'VariableDeclaration') {
        for (const d of (init as VariableDeclarationNode).declarations || []) {
          if ((d as any)?.id?.name === idxVar) { const v = this.numericLiteralValue((d as any).init); return v !== null && v >= 0; }
        }
      }
      const expr = init?.type === 'ExpressionStatement' ? (init as ExpressionStatementNode).expression : init;
      if (expr?.type === 'AssignmentExpression') {
        const a = expr as AssignmentExpressionNode;
        if (a.operator === '=' && isIdx(a.left)) { const v = this.numericLiteralValue(a.right); return v !== null && v >= 0; }
      }
      return false;
    };
    // The bound is invalidated within the body if idxVar/arrName is reassigned,
    // OR arrName is shrunk by a length-changing builtin (pop/shift/splice) — a
    // shrink before the access makes `arr[idxVar]` out of bounds (null), since the
    // loop test ran against the OLD length. (push/unshift only GROW, so they keep
    // every `arr[idxVar]` in range — no bail.) Conservative: any such op anywhere
    // in the body bails, not just before the access.
    const SHRINKERS = new Set(['pop', 'shift', 'splice']);
    const reassignedInBody = (body: AstNode): boolean => {
      let found = false;
      const scan = (n: unknown): void => {
        if (found || !isAstNodeLike(n)) return;
        if (n.type === 'AssignmentExpression') {
          const a = n as unknown as AssignmentExpressionNode;
          if (a.left?.type === 'Identifier'
              && ((a.left as IdentifierNode).name === idxVar || (a.left as IdentifierNode).name === arrName)) { found = true; return; }
        }
        if (n.type === 'UnaryExpression') {
          const u = n as unknown as UnaryExpressionNode;
          if ((u.operator === '++' || u.operator === '--')
              && u.argument?.type === 'Identifier' && (u.argument as IdentifierNode).name === idxVar) { found = true; return; }
        }
        if (n.type === 'CallExpression') {
          const c = n as unknown as CallExpressionNode;
          if (c.callee?.type === 'Identifier' && SHRINKERS.has((c.callee as IdentifierNode).name)
              && c.arguments?.[0]?.type === 'Identifier' && (c.arguments[0] as IdentifierNode).name === arrName) { found = true; return; }
        }
        for (const k of Object.keys(n)) {
          if (k === 'leadingJsDoc') continue;
          const v = n[k];
          if (Array.isArray(v)) { for (const it of v) scan(it); }
          else if (isAstNodeLike(v)) scan(v);
        }
      };
      scan(body);
      return found;
    };

    let proven = false;
    const walk = (node: unknown): void => {
      if (proven || !isAstNodeLike(node)) return;
      if (node.type === 'ForStatement') {
        const forNode = node as unknown as ForStatementNode;
        if (forNode.body
            && position >= forNode.body.start && position <= forNode.body.end
            && testProvesUpper(forNode.test) && initProvesLower(forNode.init) && !reassignedInBody(forNode.body)) {
          proven = true;
          return;
        }
      }
      for (const k of Object.keys(node)) {
        if (k === 'leadingJsDoc') continue;
        const v = node[k];
        if (Array.isArray(v)) { for (const it of v) walk(it); }
        else if (isAstNodeLike(v)) walk(v);
      }
    };
    walk(ast);
    return proven;
  }

  /** If `node` is a call to a range-registered builtin, return its range — but
   *  for MODULE functions (math.*), only when the call provably resolves to that
   *  module import (named `import { cos } from 'math'; cos(x)` or namespace
   *  `import * as math; math.cos(x)`), so a user's own same-named function isn't
   *  mis-flagged. Global builtins (index/length/…) match by bare name. */
  private resolveRangedCall(node: AstNode): typeof BUILTIN_RETURN_RANGE[string] | null {
    if (node?.type !== 'CallExpression') return null;
    const callee = (node as any).callee;
    if (callee?.type === 'Identifier') {
      const range = BUILTIN_RETURN_RANGE[callee.name];
      if (!range) return null;
      if (range.module) {
        const sym = this.symbolTable.lookup(callee.name);
        if (!sym || sym.importedFrom !== range.module) return null;
      }
      return range;
    }
    if (callee?.type === 'MemberExpression' && !callee.computed && callee.property?.type === 'Identifier') {
      const methodName = callee.property.name;
      // (a) namespace member call: `math.cos(x)` — object is the module import.
      if (callee.object?.type === 'Identifier') {
        const range = BUILTIN_RETURN_RANGE[methodName];
        if (range && range.module) {
          const objSym = this.symbolTable.lookup(callee.object.name);
          if (objSym && objSym.importedFrom === range.module) return range;
        }
      }
      // (b) handle-method call: `f.tell()` where the receiver is provably a known
      //     handle type (fs.file, io.handle, uloop.timer, …). Keyed on the receiver
      //     type so a user object's same-named method isn't mis-flagged.
      const recvType = this.receiverObjectType(callee.object);
      if (recvType) {
        const mrange = METHOD_RETURN_RANGE[`${recvType}.${methodName}`];
        if (mrange) return mrange;
      }
    }
    return null;
  }

  /** The KnownObjectType of a method-call receiver, if it provably has one — via
   *  the per-node type cache (handles `this.fp`, `arr[0]`, …) or, for a bare
   *  identifier, its symbol's declared type (`let f = fs.open(...)`). */
  private receiverObjectType(objNode: AstNode): KnownObjectType | null {
    if (!objNode) return null;
    const cached = this.getTypeOf(objNode);
    if (cached) {
      const d = this.detectObjectType(cached);
      if (d) return d;
    }
    if (objNode.type === 'Identifier') {
      const sym = this.symbolTable.lookup((objNode as IdentifierNode).name);
      if (sym) return this.detectObjectType(sym.dataType);
    }
    return null;
  }

  /** Result of `null <op> n` under ucode semantics: null coerces to 0 for ordering,
   *  but `null == n` / `null === n` is always false (verified against the runtime). */
  private nullCompare(op: string, n: number): boolean {
    switch (op) {
      case '==': case '===': return false;
      case '!=': case '!==': return true;
      case '<': return 0 < n;
      case '<=': return 0 <= n;
      case '>': return 0 > n;
      case '>=': return 0 >= n;
      default: return false;
    }
  }

  /** Result of `NaN <op> n`: only `!=`/`!==` is true; every ordered/equal compare
   *  is false (verified against the runtime — IEEE semantics). */
  private nanCompare(op: string): boolean {
    return op === '!=' || op === '!==';
  }

  /**
   * Is `result <op> n` constant for EVERY value `result` can take — a number in
   * [min, max] (max may be ±Infinity), plus `null` (canBeNull) and/or `NaN`
   * (canBeNaN)? Returns 'true'/'false' when it's a constant (dead) comparison,
   * else null. Infinity bounds compare natively. The null/NaN branches must each
   * agree with the interval verdict, or we don't conclude.
   */
  private constComparison(min: number, max: number, canBeNull: boolean, canBeNaN: boolean, op: string, n: number): 'true' | 'false' | null {
    let intervalAllTrue: boolean, intervalAllFalse: boolean;
    switch (op) {
      case '==': case '===': intervalAllFalse = (n < min || n > max); intervalAllTrue = (min === max && n === min); break;
      case '!=': case '!==': intervalAllTrue = (n < min || n > max); intervalAllFalse = (min === max && n === min); break;
      case '<':  intervalAllTrue = (max < n);  intervalAllFalse = (min >= n); break;
      case '<=': intervalAllTrue = (max <= n); intervalAllFalse = (min > n);  break;
      case '>':  intervalAllTrue = (min > n);  intervalAllFalse = (max <= n); break;
      case '>=': intervalAllTrue = (min >= n); intervalAllFalse = (max < n);  break;
      default: return null;
    }
    let verdict: 'true' | 'false' | null = intervalAllTrue ? 'true' : (intervalAllFalse ? 'false' : null);
    if (verdict === null) return null;
    // The null / NaN cases (if reachable) must each reach the SAME verdict —
    // otherwise the comparison isn't constant over the full return domain.
    if (canBeNull && (this.nullCompare(op, n) ? 'true' : 'false') !== verdict) return null;
    if (canBeNaN && (this.nanCompare(op) ? 'true' : 'false') !== verdict) return null;
    return verdict;
  }

  /**
   * Lint a comparison of a builtin's numeric result against a value outside its
   * known return range — a constant (dead) test. Driven by BUILTIN_RETURN_RANGE
   * so it generalizes across functions (index/rindex never < -1; length never < 0;
   * …) instead of hard-coding one. The legitimate boundary idioms (`index()==-1`,
   * `length()>0`) are NOT constant, so they're left alone.
   */
  private checkConstantComparison(node: BinaryExpressionNode): void {
    let range = this.resolveRangedCall(node.left);
    let litVal = range ? this.numericLiteralValue(node.right) : null;
    let op: string = node.operator;
    if (!range) {
      range = this.resolveRangedCall(node.right);
      litVal = range ? this.numericLiteralValue(node.left) : null;
      op = this.flipComparison(node.operator); // reason as `result <op> lit`
    }
    if (!range || litVal === null) return;

    const always = this.constComparison(range.min, range.max, range.canBeNull, range.canBeNaN, op, litVal);
    if (!always) return;

    const base = {
      message: `${range.fn}() returns ${range.desc}, so this comparison is always ${always}.${range.hint ? ' ' + range.hint : ''}`,
      start: node.start,
      end: node.end,
      code: UcodeErrorCode.IMPOSSIBLE_COMPARISON,
    };
    // Fixed Error, independent of `'use strict'` (#106): an always-true/false
    // comparison is a deterministic bug regardless of the pragma — strict mode
    // only changes undeclared-variable access, never comparison semantics.
    this.errors.push({ ...base, severity: 'error' });
  }

  private isTypeCall(n: AstNode): boolean {
    return n?.type === 'CallExpression'
      && (n as any).callee?.type === 'Identifier'
      && (n as any).callee.name === 'type';
  }

  /** The node, if it's a string literal. */
  private stringLiteralNode(n: AstNode): LiteralNode | null {
    return (n?.type === 'Literal' && typeof (n as LiteralNode).value === 'string')
      ? (n as LiteralNode) : null;
  }

  /**
   * Lint `type(x) <eq> "<string>"` where the string is NOT one type() can ever
   * return — a constant (dead) test. The set of valid results is closed (see
   * TYPE_RESULT_STRINGS), so e.g. `type(x) == "number"` / `"integer"` /
   * `"boolean"` is always false (and `!=` always true). Carries a quick-fix when
   * the wrong string maps to a known ucode type name.
   */
  private checkTypeStringComparison(node: BinaryExpressionNode): void {
    const op = node.operator;
    if (op !== '==' && op !== '!=' && op !== '===' && op !== '!==') return;
    let litNode: LiteralNode | null = null;
    if (this.isTypeCall(node.left)) litNode = this.stringLiteralNode(node.right);
    else if (this.isTypeCall(node.right)) litNode = this.stringLiteralNode(node.left);
    if (!litNode) return;
    const lit = litNode.value as string;
    if (TYPE_RESULT_STRINGS.has(lit)) return; // a legitimate type() result

    const always = (op === '==' || op === '===') ? 'false' : 'true';
    const fixes = TYPE_STRING_FIX[lit];
    let hint: string;
    if (fixes) hint = ` ucode's type() uses ${fixes.map(f => `"${f}"`).join(' / ')}.`;
    else if (lit === 'null' || lit === 'undefined' || lit === 'nil' || lit === 'none')
      hint = ` ucode has no "${lit}" type — type(null) returns null; test \`x == null\` instead.`;
    else hint = ` Valid type() results: ${[...TYPE_RESULT_STRINGS].map(s => `"${s}"`).join(', ')}.`;

    const base = {
      message: `type() never returns "${lit}", so this comparison is always ${always}.${hint}`,
      start: node.start,
      end: node.end,
      code: UcodeErrorCode.IMPOSSIBLE_COMPARISON,
      ...(fixes ? { data: { typeStringFix: fixes, litStart: litNode.start, litEnd: litNode.end } } : {}),
    };
    // Fixed Error, independent of `'use strict'` (#106) — see checkConstantComparison.
    this.errors.push({ ...base, severity: 'error' });
  }

  /** A numeric / string / boolean literal (NOT null, NOT regexp) — a scalar that
   *  could only `==` another scalar under ucode coercion. */
  private isScalarLiteral(n: AstNode): boolean {
    if (n?.type !== 'Literal') return false;
    const v = (n as LiteralNode).value;
    return typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean';
  }

  /** Base types of a data type, flattening unions. */
  private baseMembers(dt: UcodeDataType): UcodeType[] {
    return (isUnionType(dt) ? getUnionTypes(dt) : [dt]).map(m => dataTypeToBase(m));
  }

  /**
   * Lint an equality (`== != === !==`) between a scalar literal and a value whose
   * type is a non-coercible reference type (array / object / function / regexp /
   * resource-handle / null). Such a value can NEVER equal a scalar in ucode
   * (verified: `[]==0`, `{}=="x"`, a handle `==0`, `null==0` are all false), so
   * the test is constant — e.g. `split(s,x) == "foo"` (array vs string) is always
   * false. Only fires when EVERY member of the value's type is a reference base
   * AND none is unknown, so dynamic/unknown values are never mis-flagged.
   */
  private checkIncompatibleEquality(node: BinaryExpressionNode): void {
    const op = node.operator;
    if (op !== '==' && op !== '!=' && op !== '===' && op !== '!==') return;
    let litNode: AstNode, other: AstNode;
    if (this.isScalarLiteral(node.left)) { litNode = node.left; other = node.right; }
    else if (this.isScalarLiteral(node.right)) { litNode = node.right; other = node.left; }
    else return;
    // Don't double-report a `type(x) == "..."` case handled above.
    if (this.isTypeCall(other)) return;

    const otherType = this.getTypeOf(other);
    if (otherType === undefined) return;
    const members = this.baseMembers(otherType);
    if (members.length === 0) return;
    if (members.some(m => m === UcodeType.UNKNOWN)) return;      // not confident → bail
    if (!members.every(m => REF_EQ_BASES.has(m))) return;        // a scalar member could match

    const always = (op === '==' || op === '===') ? 'false' : 'true';
    const typeList = [...new Set(members.map(m => REF_BASE_DISPLAY[m] ?? String(m)))].join(' | ');
    const litRepr = JSON.stringify((litNode as LiteralNode).value);
    const base = {
      message: `a value of type ${typeList} can never be == ${litRepr} in ucode, so this comparison is always ${always}.`,
      start: node.start,
      end: node.end,
      code: UcodeErrorCode.IMPOSSIBLE_COMPARISON,
    };
    // Fixed Error, independent of `'use strict'` (#106) — see checkConstantComparison.
    this.errors.push({ ...base, severity: 'error' });
  }

  /**
   * In an arithmetic (non-`+`) context a string operand coerces to a number.
   * A string LITERAL classifies by its contents (ucode rules: an integer
   * literal in any base, or empty, → integer; a float/scientific/non-numeric
   * value → double). A non-literal string has an unknown value, so it could be
   * either: `integer | double`. Non-string types pass through unchanged.
   */
  private coerceStringForArithmetic(node: AstNode, fullType: UcodeDataType): UcodeDataType {
    if (fullType !== UcodeType.STRING) return fullType;
    if (node.type === 'Literal' && typeof (node as LiteralNode).value === 'string') {
      return this.numericStringIsInteger((node as LiteralNode).value as string)
        ? UcodeType.INTEGER
        : UcodeType.DOUBLE;
    }
    return createUnionType([UcodeType.INTEGER, UcodeType.DOUBLE]);
  }

  /**
   * Does a string coerce to an integer (vs a double) under ucode's number cast?
   * True for an empty string (→ 0) or an integer literal — decimal, hex (0x),
   * binary (0b) or octal (0o), with optional sign and surrounding whitespace.
   * Everything else (float, scientific notation, or non-numeric → NaN) is double.
   */
  private numericStringIsInteger(value: string): boolean {
    const t = value.trim();
    if (t === '') return true;
    return /^[+-]?(0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+|[0-9]+)$/.test(t);
  }

  /**
   * Flag an arithmetic operation that provably evaluates to NaN: a non-numeric,
   * non-coercible operand (array/object/function/regex). The result type is still
   * `double` (NaN is a double value, not a separate type) — this is a lint, not a
   * type change. Strings are excluded (value-dependent: `"42"` works, `"abc"` is
   * NaN), as is `+` with a string operand (that's concatenation). For unary
   * operators, pass rightType = null.
   *
   * Always an Error, independent of `'use strict'` (#106): the NaN result is a
   * deterministic bug in both modes — strict only governs undeclared-variable
   * access, not arithmetic.
   */
  private checkNaNArithmetic(node: AstNode, operator: string, leftType: UcodeType, rightType: UcodeType | null): void {
    if (operator === '+' && (leftType === UcodeType.STRING || rightType === UcodeType.STRING)) {
      return; // string concatenation, not arithmetic
    }
    const offenders: UcodeType[] = [];
    if (this.producesNaNInArithmetic(leftType)) offenders.push(leftType);
    if (rightType !== null && this.producesNaNInArithmetic(rightType) && !offenders.includes(rightType)) {
      offenders.push(rightType);
    }
    if (offenders.length === 0) return;
    const base = {
      message: `This operation always produces NaN: ${offenders.join(' and ')} cannot be converted to a number`,
      start: node.start,
      end: node.end,
      code: UcodeErrorCode.NAN_ARITHMETIC,
    };
    // Fixed Error, independent of `'use strict'` (#106): `5 + {}` produces NaN in
    // both modes — strict only changes undeclared-variable access, not arithmetic.
    this.errors.push({ ...base, severity: 'error' });
  }

  private checkInOperator(node: BinaryExpressionNode, _leftType: UcodeType, rightType: UcodeType): CheckResult {
    // Get the full type data for the right operand
    let rightTypeData = this.getFullTypeFromNode(node.right) || this.getTypeAsDataType(rightType);

    // Check for flow-sensitive narrowing using direct AST analysis
    if (node.right.type === 'Identifier') {
      const variableName = (node.right as IdentifierNode).name;

      // Guard narrowing for the right operand via the AST guard walk (the
      // canonical collectGuards path; the guardContextStack / FlowSensitiveTypeTracker
      // wrappers that used to precede this were proven redundant and removed — C2).
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
    
    // ucode's `in` operator NEVER throws — it returns false for any non-collection right
    // side (verified vs the interpreter: `'x' in null` / `5` / `"s"` / `true` all → false).
    // So a right side that CONTAINS an array or object is a valid, meaningful membership
    // test: the array/object member is the point, and null/scalar members just yield false
    // safely — no null guard needed (unlike `.`/call, which DO throw on null). This makes
    // `'x' in keys(o)` / `map(p,…)` / `filter(p,…)` (typed `array | null`) clean, and also
    // `object | null` / `object | array`. Only a right side that can NEVER be a collection
    // (pure scalar/null) is flagged — `'x' in 5` is always false, a likely mistake.
    const rightSupportsIn =
      this.typeNarrowing.isSubtype(rightTypeData, UcodeType.OBJECT) ||
      this.typeNarrowing.isSubtype(rightTypeData, UcodeType.ARRAY) ||
      this.typeNarrowing.containsType(rightTypeData, UcodeType.OBJECT) ||
      this.typeNarrowing.containsType(rightTypeData, UcodeType.ARRAY);
    if (!rightSupportsIn) {
      // Only a provably-non-collection RHS reaches here: an `unknown`-typed RHS is
      // already exempt (isTypeCompatible treats unknown as compatible) and so is
      // `object|null` / `array|null` (containsType). So what's left — a concrete
      // scalar/null with no object/array member — makes `in` ALWAYS false. ucode
      // doesn't throw on it, but it's a logic bug, so keep it an error. (The old
      // message claimed `in` "requires" a collection, implying a throw — it doesn't;
      // the real defect is that the test can never succeed.)
      this.errors.push({
        message: `'in' over a ${this.getTypeDescription(rightTypeData)} is always false — 'in' tests object keys or array elements`,
        start: node.right.start,
        end: node.right.end,
        severity: 'error',
        code: UcodeErrorCode.IMPOSSIBLE_COMPARISON,
      });
    }

    return UcodeType.BOOLEAN;
  }


  private getTypeAsDataType(type: UcodeType): UcodeDataType {
    return type as UcodeDataType;
  }

  private getFullTypeFromNode(node: AstNode): UcodeDataType | null {
    // Rich type computed by checkNode for this node (typed cache, replaces the
    // old `(node as any)._fullType` side channel).
    return this.nodeTypes.get(node) ?? null;
  }

  private getTypeDescription(type: UcodeDataType): string {
    if (isUnionType(type)) {
      const types = getUnionTypes(type);
      return types.map(t => this.getTypeDescription(t as UcodeDataType)).join(' | ');
    }
    if (isObjectType(type)) {
      return type.name;
    }
    if (isArrayType(type)) {
      return UcodeType.ARRAY;
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

  private getNodeTypeDescription(node: AstNode | undefined): UcodeType {
    // A missing argument (e.g. a builtin called with too few args) has no type → UNKNOWN.
    if (!node) return UcodeType.UNKNOWN;
    // For identifiers, check if there's a narrowed type in the current context.
    // NOTE: this deliberately bases on getFullTypeFromNode (the node's CHECKED
    // type, which carries reassignment / nullMeansWrongType narrowing — e.g.
    // `strval = substr(strval,1)` is string, not string|null) rather than the
    // SSA-effective declared/current type. Routing this through
    // getNarrowedTypeAtPosition (Phase A step 2) under-narrows here and produces
    // false positives (see test-hover-type-consistency T55); a clean merge needs
    // the unified flow type from Phase B.
    if (node.type === 'Identifier') {
      const identifierNode = node as IdentifierNode;
      const variableName = identifierNode.name;

      // Base type: checked type (carries reassignment narrowing) → symbol → UNKNOWN.
      // (The guardContextStack lookup that used to wrap this was proven redundant
      // and removed — C2. The AST guard walk below still applies guards.)
      const baseType: UcodeDataType = this.getFullTypeFromNode(node)
        || this.symbolTable.lookup(variableName)?.dataType
        || UcodeType.UNKNOWN;

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

    // For MemberExpressions, check if there's a guard on the dotted path (e.g., state.errors)
    if (node.type === 'MemberExpression') {
      const dottedPath = this.getDottedPath(node);
      if (dottedPath) {
        const guards = this.getGuardsForPosition(this.currentAST, dottedPath, node.start);
        if (guards.length > 0) {
          let baseType: UcodeDataType = this.getFullTypeFromNode(node) || UcodeType.UNKNOWN;
          for (const guardInfo of guards) {
            baseType = this.applyTypeGuard(baseType, guardInfo);
          }
          return this.getTypeDescription(baseType) as UcodeType;
        }
      }
    }

    // For logical expressions (||, &&), resolve narrowed types of sub-expressions
    // so that guards on identifiers/member expressions propagate through e.g. keys(data.platform || {})
    if (node.type === 'BinaryExpression') {
      const binNode = node as BinaryExpressionNode;
      if (binNode.operator === '||' || binNode.operator === '&&') {
        // getNodeTypeDescription returns a *string* description (possibly a union
        // like "string | null"); inferLogical*FullType needs STRUCTURED types to
        // narrow (e.g. `||` drops null from the left). Parse the descriptions back
        // to structured types first — otherwise `readfile() || ''` stays
        // "string | null" instead of narrowing to "string". Guards applied by the
        // recursive description calls are preserved through the round-trip.
        const leftType = this.parseReturnType(this.getNodeTypeDescription(binNode.left));
        const rightType = this.parseReturnType(this.getNodeTypeDescription(binNode.right));
        if (binNode.operator === '||') {
          const result = logicalTypeInference.inferLogicalOrFullType(leftType, rightType);
          return (isUnionType(result) ? this.getTypeDescription(result) : result) as UcodeType;
        } else {
          const result = logicalTypeInference.inferLogicalAndFullType(leftType, rightType);
          return (isUnionType(result) ? this.getTypeDescription(result) : result) as UcodeType;
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
    return this.dataTypeToUcodeType(this.checkNode(node));
  }

  private parseSingleType(typeStr: string): SingleType {
    switch (typeStr) {
      case 'boolean': return UcodeType.BOOLEAN;
      case 'string': return UcodeType.STRING;
      case 'number': case 'integer': return UcodeType.INTEGER;
      case 'double': return UcodeType.DOUBLE;
      case 'object': return UcodeType.OBJECT;
      case 'array': return UcodeType.ARRAY;
      case 'null': return UcodeType.NULL;
      case 'function': return UcodeType.FUNCTION;
      default:
        // Typed arrays like "array<string>"
        if (typeStr.startsWith('array<') && typeStr.endsWith('>')) {
          const innerType = typeStr.slice(6, -1);
          return createArrayType(this.parseSingleType(innerType) as UcodeDataType);
        }
        // Postfix array syntax like "string[]" → array<string> (keeps the element
        // type instead of collapsing to a bare array).
        if (typeStr.endsWith('[]')) {
          return createArrayType(this.parseSingleType(typeStr.slice(0, -2)) as UcodeDataType);
        }
        // Known object types like "fs.file", "uci.cursor", "io.handle"
        // Create ModuleType (not ObjectType) so downstream code that checks
        // 'moduleName' in dataType works for method resolution, hover, and completions
        if (isKnownObjectType(typeStr)) {
          return { type: UcodeType.OBJECT, moduleName: typeStr } as any;
        }
        return UcodeType.UNKNOWN;
    }
  }

  private parseReturnType(returnTypeStr: string): UcodeDataType {
    if (returnTypeStr.includes(' | ')) {
      const types = returnTypeStr.split(' | ').map(s => this.parseSingleType(s.trim()));
      return createUnionType(types);
    }
    return this.parseSingleType(returnTypeStr);
  }

  /** Public accessor for parseReturnType — used by semantic analyzer to avoid duplication */
  parseReturnTypePublic(returnTypeStr: string): UcodeDataType {
    return this.parseReturnType(returnTypeStr);
  }

  /**
   * Narrow an fs module function's return type based on actual argument types.
   * Many fs functions return X | null where null means the C function got a wrong-type argument.
   * If we can prove the argument satisfies the parameter constraint, eliminate null.
   * If we can prove it doesn't, return just null.
   */
  private narrowFsReturnType(
    returnType: UcodeDataType,
    fsFunction: { parameters: Array<{ type: string; optional?: boolean }>; nullMeansWrongType?: boolean },
    node: CallExpressionNode
  ): UcodeDataType {
    // Only narrow when null strictly means "wrong argument type"
    if (!fsFunction.nullMeansWrongType) return returnType;
    // Only narrow union types that contain null
    if (!isUnionType(returnType)) return returnType;
    const members = getUnionTypes(returnType);
    if (!members.some(m => singleTypeToBase(m) === UcodeType.NULL)) return returnType;

    // Check each required parameter against the actual argument
    const nonNullMembers = members.filter(m => singleTypeToBase(m) !== UcodeType.NULL);
    let allArgsMatch = true;
    let anyArgDefinitelyWrong = false;

    for (let i = 0; i < fsFunction.parameters.length; i++) {
      const param = fsFunction.parameters[i];
      if (!param || param.optional) continue;
      const arg = node.arguments[i];
      if (!arg) { anyArgDefinitelyWrong = true; break; }

      const argType = this.getNodeTypeDescription(arg);
      const expectedBase = this.parseSingleType(param.type);
      const expectedUcode = singleTypeToBase(expectedBase);

      if (argType === UcodeType.UNKNOWN) {
        // Unknown — could match or not
        allArgsMatch = false;
      } else if (argType.includes(' | ')) {
        // Union arg — check if all members are compatible
        const argTypes = argType.split(' | ').map(t => t.trim());
        const allCompatible = argTypes.every(t => t === expectedUcode || t === 'unknown');
        const noneCompatible = !argTypes.some(t => t === expectedUcode || t === 'unknown');
        if (noneCompatible) { anyArgDefinitelyWrong = true; break; }
        if (!allCompatible) allArgsMatch = false;
      } else if (argType !== expectedUcode) {
        anyArgDefinitelyWrong = true;
        break;
      }
    }

    if (anyArgDefinitelyWrong) {
      return UcodeType.NULL;
    }
    if (allArgsMatch && nonNullMembers.length > 0) {
      return nonNullMembers.length === 1 ? nonNullMembers[0] as UcodeDataType : createUnionType(nonNullMembers);
    }
    // Mixed — keep the full union
    return returnType;
  }

  /** True when a variable/parameter of this type could hold something callable —
   *  i.e. its type is function or unknown, or a union that includes either. Used so
   *  calling a function-valued variable (incl. `function | null` from loadstring())
   *  isn't mistaken for an "Undefined function". */
  private typeCouldBeCallable(dataType: UcodeDataType | undefined): boolean {
    if (dataType === undefined) return false;
    for (const member of getUnionTypes(dataType)) {
      const base = singleTypeToBase(member);
      if (base === UcodeType.FUNCTION || base === UcodeType.UNKNOWN) return true;
    }
    return false;
  }

  private checkCallExpression(node: CallExpressionNode): CheckResult {
    if (node.callee.type === 'Identifier') {
      const funcName = (node.callee as IdentifierNode).name;

      // First check if it's a user-defined function, imported function, or variable containing a function
      // Use lookupAtPosition to properly handle local variables in nested scopes
      const symbol = this.symbolTable.lookupAtPosition(funcName, node.start);

      if (symbol) {
        // Argument-check any call whose callee resolves to a symbol carrying a
        // known signature — function declarations, imported functions, AND
        // function-valued variables (`let f = greet; f(123)`). Known-module
        // imports never carry `parameters`, so they're untouched. Additive: this
        // doesn't change the call's resolved return type below.
        if (symbol.parameters) {
          this.checkUserFunctionCall(node, symbol);
        }

        // Check for functions and imported functions
        if (symbol.type === SymbolType.FUNCTION || symbol.type === SymbolType.IMPORTED) {
          // Return type inference for imported module functions
          if (symbol.type === SymbolType.IMPORTED && symbol.importedFrom && isKnownModule(symbol.importedFrom)) {
            const registry = MODULE_REGISTRIES[symbol.importedFrom];
            const moduleFunctionOpt = registry.getFunction(funcName);
            if (Option.isSome(moduleFunctionOpt)) {
              const moduleFunction = moduleFunctionOpt.value;
              let returnTypeData = this.parseReturnType(moduleFunction.returnType);

              // Narrow return type based on argument types.
              // Many module functions return X | null where null means "wrong arg type".
              returnTypeData = this.narrowFsReturnType(returnTypeData, moduleFunction, node);

              return returnTypeData;
            }
          }

          // For user-defined functions and other imported functions, return their return type
          if (symbol.returnType) {
            // Return the full return type (real unions) directly, so a call used
            // as an operand (e.g. `f() + g()`) carries the union for union-aware
            // consumers — not just when assigned to a var.
            return symbol.returnType;
          } else {
            // Fallback for functions without explicit return type
            return UcodeType.UNKNOWN;
          }
        }
        // Check for variables that might contain functions (e.g., arrow functions)
        else if (symbol.type === SymbolType.VARIABLE) {
          // A module function bound to a variable (`let readfile = fs_mod.readfile`)
          // carries importedFrom/importSpecifier — resolve the call's return type
          // from the module registry, same as a direct named import. Use the
          // SPECIFIER (the module's function name), which may differ from the
          // local variable name when aliased.
          if (symbol.importedFrom && isKnownModule(symbol.importedFrom)) {
            const registry = MODULE_REGISTRIES[symbol.importedFrom];
            const moduleFunctionOpt = registry.getFunction(symbol.importSpecifier || funcName);
            if (Option.isSome(moduleFunctionOpt)) {
              const moduleFunction = moduleFunctionOpt.value;
              let returnTypeData = this.parseReturnType(moduleFunction.returnType);
              returnTypeData = this.narrowFsReturnType(returnTypeData, moduleFunction, node);
              return returnTypeData;
            }
          }
          // The variable holds something callable if its type is function or
          // unknown — OR a union that includes either. e.g. `loadstring()` returns
          // `function | null`, so a union check is required (a bare `=== FUNCTION`
          // string test misses it and falsely reports "Undefined function").
          if (this.typeCouldBeCallable(symbol.dataType)) {
            return UcodeType.UNKNOWN; // function calls return unknown by default
          }
        }
        // Check for parameters that might be callback functions (e.g., cb(), uci_getter())
        else if (symbol.type === SymbolType.PARAMETER) {
          // Parameters whose type is (or includes) function/unknown could be callable.
          if (this.typeCouldBeCallable(symbol.dataType)) {
            return UcodeType.UNKNOWN;
          }
        }
      }
      
      // Check global builtin functions (only truly global functions remain)
      const signature = this.builtinFunctions.get(funcName);
      if (signature) {
        return this.validateBuiltinCall(node, signature);
      }

      // Position-aware lookup failed. If the name IS a function declared LATER in
      // scope, this is a forward reference — ucode doesn't hoist function values, so
      // it errors at runtime as "access to undeclared variable". Give a clear message
      // distinct from a genuinely-undefined call (which is the `else` below).
      const laterDecl = this.symbolTable.lookup(funcName);
      if (laterDecl && laterDecl.type === SymbolType.FUNCTION
          && laterDecl.declaredAt !== undefined && laterDecl.declaredAt > node.start) {
        this.errors.push({
          message: `Function '${funcName}' is used before its declaration. Move its declaration above this use.`,
          start: node.start,
          end: node.end,
          severity: 'error',
          code: UcodeErrorCode.FUNCTION_USED_BEFORE_DECLARATION,
        });
        return UcodeType.UNKNOWN;
      }

      // A non-strict implicit global (bare-assigned somewhere) provably exists as a
      // global; it may hold a function (e.g. `uvol_uci_commit = ctx.uci_commit`), so
      // calling it isn't "undefined" — same leniency as an unknown-typed callable.
      if (!this.strictMode && this.implicitGlobalNames.has(funcName)) {
        return UcodeType.UNKNOWN;
      }

      // A function installed on the builtin `global` object (`global.X = function…`) is a
      // real global binding, callable bare as `X(...)` — in strict mode too (unlike the
      // non-strict implicit globals above), so this suppression is not strict-gated.
      if (this.globalPropertyNames.has(funcName)) {
        return UcodeType.UNKNOWN;
      }

      // A render-scope name injected by an include(path, {…}) is a real global binding,
      // callable bare — valid in strict mode too (verified vs the oracle). Not strict-gated.
      if (this.injectedScopeNames.has(funcName)) {
        return UcodeType.UNKNOWN;
      }

      // If the name DID resolve to a symbol but none of the callable paths above
      // matched, it's a defined value that simply isn't callable (`let n = 5; n()`).
      // "Undefined function" is wrong here — it IS defined — so report the real
      // problem (its type) like the literal-call path does (`1()`). (auto-docs #18)
      if (symbol) {
        // Respect flow-narrowing of the callee: inside `if (type(a) == "function") { a() }`
        // the declared type may be non-callable (e.g. null) while the narrowed type here is
        // a function. Use the narrowed type for both the callable check and the message.
        const calleeType = this.getNarrowedTypeAtPosition(funcName, node.start) ?? symbol.dataType;
        if (this.typeCouldBeCallable(calleeType)) {
          return UcodeType.UNKNOWN;
        }
        const typeName = this.getTypeDescription(calleeType);
        this.errors.push({
          message: `'${funcName}' is not a function (it is of type ${typeName})`,
          start: node.start,
          end: node.end,
          severity: 'error',
          code: UcodeErrorCode.NOT_CALLABLE,
        });
        return UcodeType.UNKNOWN;
      }

      this.errors.push({
        message: `Undefined function: ${funcName}`,
        start: node.start,
        end: node.end,
        severity: 'error',
        code: UcodeErrorCode.UNDEFINED_FUNCTION,
      });
      return UcodeType.UNKNOWN;
    }

    // Handle member expression calls (e.g., fs.open, obj.method)
    if (node.callee.type === 'MemberExpression') {
      const memberCallee = node.callee as MemberExpressionNode;
      // Local object-literal method calls: `obj.method()` and `this.method()` resolve to the
      // method's inferred return type (recorded on the receiver symbol's propertyReturnTypes).
      // Checked before the string-hint map below so rich types (object, unions) are preserved.
      if (!memberCallee.computed && memberCallee.property.type === 'Identifier'
          && (memberCallee.object.type === 'Identifier' || memberCallee.object.type === 'ThisExpression')) {
        const recvSym = memberCallee.object.type === 'ThisExpression'
          ? this.symbolTable.lookup('this')
          : this.symbolTable.lookup((memberCallee.object as IdentifierNode).name);
        const rt = recvSym?.propertyReturnTypes?.get((memberCallee.property as IdentifierNode).name);
        if (rt !== undefined) {
          return rt as UcodeType;
        }
      }
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
      // Namespace module calls: import * as io from 'io'; io.open()
      if (memberCallee.object.type === 'Identifier' && memberCallee.property.type === 'Identifier') {
        const objName = (memberCallee.object as IdentifierNode).name;
        const methodName = (memberCallee.property as IdentifierNode).name;
        const objSym = this.symbolTable.lookup(objName);
        if (objSym && typeof objSym.dataType === 'object' && objSym.dataType !== null &&
            'moduleName' in objSym.dataType && isKnownModule((objSym.dataType as any).moduleName)) {
          const modName = (objSym.dataType as any).moduleName as string;
          const registry = MODULE_REGISTRIES[modName as keyof typeof MODULE_REGISTRIES];
          const funcOpt = registry.getFunction(methodName);
          if (Option.isSome(funcOpt)) {
            let returnTypeData = this.parseReturnType(funcOpt.value.returnType);
            returnTypeData = this.narrowFsReturnType(returnTypeData, funcOpt.value, node);
            return returnTypeData;
          }
        }
      }

      // Unimported known module (`fs.open()` with no `import`): the call is
      // invalid (semanticAnalyzer flags UC3006), so don't infer a confident type
      // — fall through to UNKNOWN. Without this, the generic resolver below maps
      // `fs.open` to its return object type `fs.file` (dropping the `| null`),
      // giving the broken/unimported call a MORE specific type than the correct
      // imported call (`fs.file | null`). Once imported, fs has a symbol and the
      // namespace branch above resolves the real return type.
      if (memberCallee.object.type === 'Identifier' && memberCallee.property.type === 'Identifier'
          && !this.symbolTable.lookup((memberCallee.object as IdentifierNode).name)
          && isKnownModule((memberCallee.object as IdentifierNode).name)) {
        return UcodeType.UNKNOWN;
      }

      // Member expression calls — resolve the call's return type from the callee.
      const calleeType = this.checkNode(node.callee);
      // A callee that IS a function (bare FUNCTION) → calling it yields unknown:
      // we don't model the function's own return type. (This is the 0.6.83 fix:
      // never let "the callee is a function" leak out as "the call returns a
      // function".) UNKNOWN callee → also fall through to call-target validation
      // below. Anything else is already the resolved RETURN type from an earlier
      // path (module method, etc.) — return it directly; unions flow through and
      // collapse to UNKNOWN only at the base-type boundary.
      if (calleeType !== UcodeType.FUNCTION && calleeType !== UcodeType.UNKNOWN) {
        return calleeType;
      }
    }

    // For other callees (but not Identifiers, which we already handled above)
    if ((node.callee.type as string) !== 'Identifier') {
      const calleeType = this.dataTypeToUcodeType(this.checkNode(node.callee));
      if (!this.typeCompatibility.isValidCallTarget(calleeType)) {
        this.errors.push({
          message: `Cannot call ${calleeType} as function`,
          start: node.start,
          end: node.end,
          severity: 'error',
          code: UcodeErrorCode.NOT_CALLABLE,
        });
        return UcodeType.UNKNOWN;
      }
    }

    return UcodeType.UNKNOWN;
  }

  /**
   * For `filter(arr, (x) => GUARD(x))`, return GUARD applied to `currentElement`
   * (the input array's element type) — i.e. the narrowed element type of the kept
   * elements — or null when there's nothing to narrow (callback isn't a function,
   * no params, no extractable test, or no recognized guard). Reuses the if-consequent
   * machinery: the callback's first parameter is the guard subject, and filter keeps
   * truthy-predicate elements, so only positive-branch guards apply.
   */
  private narrowFilterElementType(node: CallExpressionNode, currentElement: UcodeDataType): UcodeDataType | null {
    const cb = node.arguments[1];
    if (!cb || (cb.type !== 'ArrowFunctionExpression' && cb.type !== 'FunctionExpression')) return null;
    const params = (cb as ArrowFunctionExpressionNode | FunctionExpressionNode).params;
    const subject = params?.[0]?.name;
    if (!subject) return null;
    const test = this.extractPredicateTest(cb as ArrowFunctionExpressionNode | FunctionExpressionNode);
    if (!test) return null;
    this.transitiveTypeAliases = [];
    const guards: TypeGuardInfo[] = [];
    this.collectPositiveTestGuards(test, subject, guards);
    if (guards.length === 0) return null;
    let elem = currentElement;
    for (const g of guards) elem = this.applyTypeGuard(elem, g);
    // No actual narrowing (e.g. a length()/truthy guard on an unknown element) —
    // leave the type untouched rather than re-wrapping it.
    return elem === currentElement ? null : elem;
  }

  /** The boolean test a predicate callback returns: an expression-bodied arrow's body
   *  directly, or a block body (arrow or function) whose sole statement is
   *  `return <expr>`. Multi-statement bodies are skipped (return null → no narrowing). */
  private extractPredicateTest(cb: ArrowFunctionExpressionNode | FunctionExpressionNode): AstNode | null {
    if (cb.type === 'ArrowFunctionExpression' && cb.expression) return cb.body;
    const body = cb.body as BlockStatementNode | undefined;
    if (body && body.type === 'BlockStatement' && Array.isArray(body.body)) {
      const stmts = body.body.filter((s) => s.type !== 'EmptyStatement');
      if (stmts.length === 1 && stmts[0]?.type === 'ReturnStatement') {
        return (stmts[0] as ReturnStatementNode).argument;
      }
    }
    return null;
  }

  private validateBuiltinCall(node: CallExpressionNode, signature: FunctionSignature): CheckResult {
    // Ensure all arguments are checked first to populate their cached types
    for (const arg of node.arguments) {
      if (arg) {
        this.checkNode(arg);
      }
    }

    // First check special cases
    this.builtinValidator.inTruthinessContext = this.truthinessDepth > 0;
    if (this.validateSpecialBuiltins(node, signature)) {
      let narrowed = this.builtinValidator.narrowedReturnType;
      this.builtinValidator.narrowedReturnType = null;
      // require("builtin-module") is generically typed as that module — wherever it
      // appears (inline, property/member assignment, reassignment), not just at a
      // `let x = require()` binding. So the module type flows through the normal SSA /
      // property / member-read machinery. The arg must be a literal naming a known
      // builtin module; file-path requires (./…) need cross-file resolution → TODO.
      if (signature.name === 'require') {
        const reqArg = node.arguments[0];
        if (reqArg && reqArg.type === 'Literal' && typeof (reqArg as LiteralNode).value === 'string'
            && isKnownModule((reqArg as LiteralNode).value as string)) {
          return { type: UcodeType.OBJECT, moduleName: (reqArg as LiteralNode).value as string } as UcodeDataType;
        }
      }
      // filter(arr, (x) => GUARD(x)) is a type-narrowing construct: it keeps only the
      // elements GUARD accepts, so the result's element type is GUARD applied to the
      // input element type. Reuses the same positive-branch guard engine as
      // if-consequents. (validateFilterFunction already set `narrowed` to array<E>.)
      if (signature.name === 'filter' && narrowed !== null) {
        const curElem = isArrayType(narrowed)
          ? getArrayElementType(narrowed)
          : (narrowed === UcodeType.ARRAY ? (UcodeType.UNKNOWN as UcodeDataType) : null);
        if (curElem !== null) {
          const refined = this.narrowFilterElementType(node, curElem);
          if (refined !== null) narrowed = createArrayType(refined);
        }
      }
      if (narrowed !== null) {
        // Return the narrowed rich type directly.
        return narrowed;
      }
      // Apply nullMeansWrongType narrowing even for special builtins
      let returnType = signature.returnType;
      if (signature.nullMeansWrongType && isUnionType(returnType)) {
        returnType = this.narrowBuiltinReturnType(returnType, signature, node);
      }
      // Return the rich return type (unions flow through).
      return returnType;
    }

    const argCount = node.arguments.length;

    // A zero-arg call to a builtin ucode accepts with no args (e.g. uc/lc/join/hexenc, which are
    // signature-only — not in validateSpecialBuiltins) is valid-but-useless, not an arity error.
    // Handle it like the special-builtin path: strict-gated UC2012 + exact return-type narrowing,
    // skipping the UC2003 error and the coercion arg-check (there are no args to check).
    if (argCount === 0 && this.builtinValidator.applyZeroArgUselessResult(node, signature.name)) {
      const narrowed = this.builtinValidator.narrowedReturnType;
      this.builtinValidator.narrowedReturnType = null;
      if (narrowed !== null) return narrowed;
    }

    const minParams = signature.minParams ?? signature.parameters.length;
    const maxParams = signature.maxParams ?? (signature.variadic ? Infinity : signature.parameters.length);

    // Check argument count
    if (argCount < minParams) {
      this.errors.push({
        message: `Function '${signature.name}' expects at least ${minParams} arguments, got ${argCount}`,
        start: node.start,
        end: node.end,
        severity: 'error',
        code: UcodeErrorCode.INVALID_PARAMETER_COUNT,
      });
    } else if (argCount > maxParams) {
      this.errors.push({
        message: `Function '${signature.name}' expects at most ${maxParams} arguments, got ${argCount}`,
        start: node.start,
        end: node.end,
        severity: 'error',
        code: UcodeErrorCode.INVALID_PARAMETER_COUNT,
      });
    }

    // Check argument types (shared with user-function calls). Builtins flag an
    // unknown-typed actual arg (their C signatures are hard constraints).
    this.checkArgumentTypes(node, signature.parameters, signature.name, { flagUnknownActual: true, softSeverity: false, coercesArgToString: !!signature.coercesArgToString });

    // Narrow return type based on argument types when nullMeansWrongType is set
    let returnType = signature.returnType;
    if (signature.nullMeansWrongType && isUnionType(returnType)) {
      returnType = this.narrowBuiltinReturnType(returnType, signature, node);
    }
    // Return the rich return type directly (unions flow through).
    return returnType;
  }

  /**
   * Check each positional argument against its expected type, emitting
   * `incompatible-function-argument` (or `nullable-argument` semantics via the
   * partial-compatibility split). Shared by builtin calls and user-function
   * calls. `opts.flagUnknownActual`: builtins flag an unknown-typed arg; user
   * functions DON'T (bail on unknown — we're not confident it's wrong). An
   * expected type of UNKNOWN is always skipped (no declared contract).
   * `opts.softSeverity`: builtins escalate a DEFINITE mismatch to an error even
   * in non-strict mode; user functions don't (ucode permits the call) — they
   * warn, escalating to an error only under `'use strict'`.
   */
  /** Whether an argument node must be parenthesized when wrapped as `"" + (node)` — true for
   *  operators that bind looser than `+` (so `"" + a ? b : c` / `"" + a - b` don't misparse). */
  private static needsParensForAddition(node: AstNode): boolean {
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

  private checkArgumentTypes(node: CallExpressionNode, expectedTypes: UcodeType[], fnName: string, opts: { flagUnknownActual: boolean; softSeverity: boolean; coercesArgToString?: boolean }): void {
    const argCount = node.arguments.length;
    for (let i = 0; i < Math.min(argCount, expectedTypes.length); i++) {
      const expectedType = expectedTypes[i];
      const arg = node.arguments[i];
      if (!arg || !expectedType) continue;

      const actualType = this.dataTypeToUcodeType(this.checkNode(arg)) || UcodeType.UNKNOWN;
      let actualTypeData = this.getFullTypeFromNode(arg) || this.getTypeAsDataType(actualType);

      // Apply AST-based guard narrowing for identifier arguments
      if (arg.type === 'Identifier' && (isUnionType(actualTypeData) || actualTypeData === UcodeType.UNKNOWN)) {
        const varName = (arg as IdentifierNode).name;
        const guards = this.getGuardsForPosition(this.currentAST, varName, arg.start);
        if (guards.length > 0) {
          let narrowed: UcodeDataType = actualTypeData;
          for (const g of guards) {
            narrowed = this.applyTypeGuard(narrowed, g);
            if (process.env.GUARD_DEBUG) console.error('[GD]   after', JSON.stringify(g), '=>', JSON.stringify(narrowed));
          }
          actualTypeData = narrowed;
        }
      }

      // Apply AST-based guard narrowing for member expression arguments (e.g., state.errors)
      if (arg.type === 'MemberExpression') {
        const dottedPath = this.getDottedPath(arg);
        if (dottedPath) {
          const guards = this.getGuardsForPosition(this.currentAST, dottedPath, arg.start);
          if (guards.length > 0) {
            let narrowed: UcodeDataType = actualTypeData;
            for (const g of guards) {
              narrowed = this.applyTypeGuard(narrowed, g);
            }
            actualTypeData = narrowed;
          }
        }
      }

      // Bail on an unknown-typed actual arg unless the caller opts in (user
      // functions: a value we can't type might well satisfy the contract).
      if (!opts.flagUnknownActual) {
        const am = isUnionType(actualTypeData) ? getUnionTypes(actualTypeData).map(m => dataTypeToBase(m)) : [dataTypeToBase(actualTypeData)];
        if (am.some(m => m === UcodeType.UNKNOWN)) continue;
      }

      if (expectedType !== UcodeType.UNKNOWN && !this.typeNarrowing.isSubtype(actualTypeData, expectedType)) {
        const incompatibleTypes = this.typeNarrowing.getIncompatibleTypes(actualTypeData, expectedType);
        const actualTypes = getUnionTypes(actualTypeData);
        const hasCompatibleType = actualTypes.some(t => t === UcodeType.UNKNOWN || incompatibleTypes.indexOf(t) === -1);
        const isPartiallyCompatible = hasCompatibleType && incompatibleTypes.length > 0;

        // A string-coercing builtin (`uc`/`lc`): a DEFINITELY non-string, non-null arg is
        // stringified at runtime (totally valid ucode), so it's a strict-gated WARNING + a
        // "coerce" quick-fix, not the hard definite-mismatch error other builtins get (#30).
        // Excluded: a partial/union mismatch (e.g. `string|null`) and any type that includes
        // `null` — null-ness is a distinct concern (the value may be missing), so it keeps the
        // existing "possibly null" nullable handling, where a guard (not coercion) is the nudge.
        const includesNull = actualTypes.some(t => dataTypeToBase(t) === UcodeType.NULL);
        const coerces = !!opts.coercesArgToString && expectedType === UcodeType.STRING && !isPartiallyCompatible && !includesNull;

        const incompatibilityDesc = this.typeNarrowing.getIncompatibilityDescription(actualTypeData, expectedType);
        const message = coerces
          ? `Function '${fnName}' expects a string; ${this.getTypeDescription(actualTypeData)} will be coerced to a string. Pass a string to be explicit (e.g. \`"" + value\`).`
          : incompatibilityDesc
          ? `Function '${fnName}': ${incompatibilityDesc}. Use a guard or assertion.`
          : `Function '${fnName}' expects ${expectedType} for argument ${i + 1}, got ${this.getTypeDescription(actualTypeData)}`;
        const diagData = {
          functionName: fnName,
          argumentIndex: i,
          expectedType: expectedType as string,
          actualType: actualTypeData,
          variableName: this.getVariableName(arg),
          // Whether a type guard could ever rescue this call: true when the actual
          // type has a member that could satisfy the contract (a union with a valid
          // arm, or unknown). A DEFINITE mismatch (a literal `1` for a string param,
          // any single provably-wrong type) is not narrowable — `type(1)=="string"`
          // is always false — so the quick-fix layer must not offer a guard there.
          narrowable: hasCompatibleType,
          // String-coercion quick-fix marker (#30): wrap the arg in `"" + …`. argNeedsParens
          // is computed from the arg's AST node type so the fix stays AST-based.
          ...(coerces ? { coerceToString: true, argNeedsParens: TypeChecker.needsParensForAddition(arg) } : {})
        };

        // Warning when: a coercing builtin (uc/lc — valid, just stringified), partially
        // compatible (union/unknown w/ some valid types), OR the caller uses soft severity
        // (user functions). Either way, strict mode escalates to an error. Other builtins
        // keep their definite-mismatch error.
        const asWarning = (coerces || opts.softSeverity || isPartiallyCompatible) && !this.strictMode;
        if (asWarning) {
          this.warnings.push({
            message, start: arg.start, end: arg.end,
            severity: 'warning', code: 'incompatible-function-argument', data: diagData
          });
        } else {
          this.errors.push({
            message, start: arg.start, end: arg.end,
            severity: 'error', code: 'incompatible-function-argument', data: diagData
          });
        }
      }
    }
  }

  /**
   * Check a call to an in-file user function against its declared signature
   * (param types + arity). Unlike builtins, ucode imposes NO runtime arity or
   * type constraint on user calls (missing→null, extra→ignored, dynamic types),
   * so EVERYTHING here is a warning — escalated to an error only under
   * `'use strict'`. Sound by construction: bail on unknown arg/param types,
   * only flag too-many on non-variadic functions, only flag too-few for params
   * with a declared non-optional type.
   */
  private checkUserFunctionCall(node: CallExpressionNode, funcSymbol: UcodeSymbol): void {
    const params = funcSymbol.parameters;
    if (!params || params.length === 0 && node.arguments.length === 0) return;
    // Spread arg → argument count/positions are unknowable; skip entirely (sound).
    if (node.arguments.some(a => a && (a.type === 'SpreadElement' || (a.type as string) === 'RestElement'))) return;

    const fnName = funcSymbol.name;
    const variadic = params.some(p => p.isRest);
    const positional = params.filter(p => !p.isRest);
    const argCount = node.arguments.length;

    // Argument TYPE checking — collapse each declared param type to a base; a
    // union/unknown type yields UNKNOWN (skipped). Bail on unknown actual args.
    const expectedBases: UcodeType[] = positional.map(p =>
      isUnionType(p.type) ? UcodeType.UNKNOWN : dataTypeToBase(p.type));
    this.checkArgumentTypes(node, expectedBases, fnName, { flagUnknownActual: false, softSeverity: true });

    // Emit at warning severity, escalated to error under `'use strict'`.
    const emit = (message: string) => {
      const d = { message, start: node.start, end: node.end, code: UcodeErrorCode.INVALID_PARAMETER_COUNT };
      if (this.strictMode) this.errors.push({ ...d, severity: 'error' });
      else this.warnings.push({ ...d, severity: 'warning' });
    };

    // Too many arguments — only meaningful when non-variadic (no `...rest`), and
    // ucode has no `arguments` object so the extra args are provably dead.
    if (!variadic && argCount > positional.length) {
      emit(`Function '${fnName}' expects at most ${positional.length} argument${positional.length === 1 ? '' : 's'}, got ${argCount} (extra arguments are ignored)`);
    }

    // Too few arguments — only for missing params with a declared, NON-optional
    // type (un-annotated/unknown or nullable `[name]`/`{T|null}` params are
    // silent; ucode passes null for the missing ones).
    for (let i = argCount; i < positional.length; i++) {
      const p = positional[i]!;
      const base = dataTypeToBase(p.type);
      const isOptional = isUnionType(p.type)
        ? getUnionTypes(p.type).some(m => dataTypeToBase(m) === UcodeType.NULL)
        : base === UcodeType.NULL;
      if (base === UcodeType.UNKNOWN || isOptional) continue;
      emit(`Function '${fnName}' expects argument '${p.name}' (${base}); omitting it passes null.`);
    }
  }

  /**
   * Narrow a builtin function's return type based on actual argument types.
   * When nullMeansWrongType is set and all relevant args match expected types,
   * eliminate null from the return type.
   */
  private narrowBuiltinReturnType(
    returnType: UcodeDataType,
    signature: FunctionSignature,
    node: CallExpressionNode
  ): UcodeDataType {
    if (!isUnionType(returnType)) return returnType;
    const members = getUnionTypes(returnType);
    if (!members.some(m => m === UcodeType.NULL)) return returnType;

    // Determine which parameter indices to check
    const indicesToCheck = signature.narrowingArgs
      ?? signature.parameters.map((_, i) => i);

    let allArgsMatch = true;
    let anyArgDefinitelyWrong = false;

    for (const i of indicesToCheck) {
      const expectedType = signature.parameters[i];
      if (!expectedType || expectedType === UcodeType.UNKNOWN) continue;

      const arg = node.arguments[i];
      if (!arg) { allArgsMatch = false; break; }

      const argType = this.getNodeTypeDescription(arg);

      // Build the set of acceptable types for this parameter
      const acceptableTypes: string[] = [expectedType];
      if (signature.name === 'length') {
        acceptableTypes.push('string', 'array', 'object');
      } else if (signature.name === 'index' || signature.name === 'rindex') {
        acceptableTypes.push('string', 'array');
      }

      if (argType === 'unknown') {
        allArgsMatch = false;
      } else if (argType.includes(' | ')) {
        const argTypes = argType.split(' | ').map(t => t.trim());
        const allCompatible = argTypes.every(t => acceptableTypes.includes(t) || t === 'unknown');
        const noneCompatible = !argTypes.some(t => acceptableTypes.includes(t) || t === 'unknown');
        if (noneCompatible) { anyArgDefinitelyWrong = true; break; }
        if (!allCompatible) allArgsMatch = false;
      } else if (!acceptableTypes.includes(argType)) {
        anyArgDefinitelyWrong = true;
        break;
      }
    }

    if (anyArgDefinitelyWrong) {
      return UcodeType.NULL;
    }

    if (allArgsMatch) {
      // Remove null from the union
      const nonNullMembers = members.filter(m => m !== UcodeType.NULL);
      if (nonNullMembers.length === 1) return nonNullMembers[0] as UcodeDataType;
      return createUnionType(nonNullMembers);
    }

    return returnType;
  }

  /**
   * Detect if a data type represents a known object type from the dispatch layer.
   */
  private detectObjectType(dataType: UcodeDataType): KnownObjectType | null {
    if (typeof dataType === 'string') return null;
    const moduleType = extractModuleType(dataType);
    if (moduleType) {
      if (isKnownObjectType(moduleType.moduleName)) return moduleType.moduleName;
    }
    return null;
  }

  private dataTypeToUcodeType(dataType: UcodeDataType): UcodeType {
    // Single source of truth in symbolTable (see dataTypeToBase). Kept as a
    // thin private alias so existing call sites read naturally.
    return dataTypeToBase(dataType);
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
      case 'getenv':
        return this.builtinValidator.validateGetenvFunction(node);
      case 'rand':
        return this.builtinValidator.validateRandFunction(node);
      case 'trim':
        return this.builtinValidator.validateTrimFunction(node);
      case 'ltrim':
        return this.builtinValidator.validateLtrimFunction(node);
      case 'rtrim':
        return this.builtinValidator.validateRtrimFunction(node);
      case 'substr':
        return this.builtinValidator.validateSubstrFunction(node);
      case 'proto':
        return this.builtinValidator.validateProtoFunction(node);
      case 'render':
        return this.builtinValidator.validateRenderFunction(node);
      default:
        return false;
    }
  }

  /** Fix-data for the null-access quick fixes (optional chaining / null guard). Carries the
   *  source offsets the code-action handler needs (object span, property start, computed flag,
   *  write flag, and whether the receiver is a bare identifier — for the guard). */
  private nullAccessFixData(node: MemberExpressionNode): {
    nullAccess: {
      objStart: number; objEnd: number; propStart: number;
      computed: boolean; isWrite: boolean; isIdentifier: boolean;
    };
  } {
    return {
      nullAccess: {
        objStart: node.object.start,
        objEnd: node.object.end,
        propStart: node.property.start,
        computed: !!node.computed,
        isWrite: this.isAssignmentTargetContext(),
        isIdentifier: node.object.type === 'Identifier',
      },
    };
  }

  /** Tier 2: WARN (not error) on a non-optional `.prop` access whose receiver is a
   *  possibly-null union (`T | null`) where every non-null member is an object/handle — it
   *  crashes at runtime iff null on this path (verified: `cursor()`/`fs.open()` are nullable
   *  per the C source, and a member access on null is a hard error). Guards / optional
   *  chaining remove null from `effType`, so guarded code is silent. Scalar/array non-null
   *  members are left to their own "no members" errors (no redundant double-flagging). */
  private warnPossiblyNullMember(node: MemberExpressionNode, effType: UcodeDataType): void {
    if (node.optional || node.computed || node.property.type !== 'Identifier') return;
    if (!isUnionType(effType)) return;
    const members = getUnionTypes(effType);
    if (!members.some(m => singleTypeToBase(m) === UcodeType.NULL)) return;
    const nonNull = members.filter(m => singleTypeToBase(m) !== UcodeType.NULL);
    if (nonNull.length === 0 || !nonNull.every(m => singleTypeToBase(m) === UcodeType.OBJECT)) return;
    const who = node.object.type === 'Identifier' ? `'${(node.object as IdentifierNode).name}'` : 'this value';
    const isWrite = this.isAssignmentTargetContext();
    const verb = isWrite ? 'setting' : 'accessing';
    const base = {
      message: `${who} may be null here — ${verb} property '${(node.property as IdentifierNode).name}' will fail at runtime if it is null. Guard against null${isWrite ? '' : ', or use optional chaining (?.)'}.`,
      start: node.property.start,
      end: node.property.end,
      code: UcodeErrorCode.POSSIBLY_NULL_MEMBER_ACCESS,
      data: this.nullAccessFixData(node),
    };
    // Severity policy (mirrors the other nullable/impossible-comparison checks): a possibly-
    // null deref only crashes IF null, so it's a WARNING by default — but under `'use strict'`
    // the author has opted into strict checking, so escalate it to an ERROR. (ucode's runtime
    // null-deref is identical in both modes; this is an LSP strictness policy, not semantics.)
    if (this.strictMode) this.errors.push({ ...base, severity: 'error' });
    else this.warnings.push({ ...base, severity: 'warning' });
  }

  private checkMemberExpression(node: MemberExpressionNode): CheckResult {
    // Member-path type narrowing: a `type(o.x) == "str"` guard in scope narrows the
    // member path `o.x` itself. getNarrowedTypeAtPosition resolves a dotted path with
    // no symbol via the guards alone, so this only fires inside such a guard's branch.
    if (!node.computed && node.property.type === 'Identifier') {
      const dotted = this.getDottedPath(node);
      if (dotted && dotted.includes('.')) {
        const narrowed = this.getNarrowedTypeAtPosition(dotted, node.start);
        if (narrowed !== null) return narrowed;
      }
    }

    // Chained member access (base.A.B): when `node.object` is itself a
    // MemberExpression `base.A` and `base.nestedPropertyTypes['A']` knows the
    // type of B, return it. Without this hop, `let x = ns.ALFRED_TYPES.HOSTINFO`
    // types x as `unknown` even though we *know* the inner literal types from
    // the imported file. Only the immediate `base.A.B` pattern is covered —
    // matches the depth our nestedPropertyTypes map holds.
    if (!node.computed && node.object.type === 'MemberExpression') {
      const inner = node.object as MemberExpressionNode;
      if (!inner.computed && inner.object.type === 'Identifier') {
        const baseName = (inner.object as IdentifierNode).name;
        const baseSym = this.symbolTable.lookup(baseName);
        const aName = this.getStaticPropertyName(inner.property);
        const bName = this.getStaticPropertyName(node.property);
        if (baseSym?.nestedPropertyTypes && aName && bName) {
          const innerMap = baseSym.nestedPropertyTypes.get(aName);
          const innerType = innerMap?.get(bName);
          if (innerType !== undefined) {
            return innerType;
          }
        }
      }
    }

    // Chained / indexed / call receiver whose type is a known object handle:
    // `info.dev.major` (member-of-member), `sox[0].recv()` (indexed element), or
    // `fs.open().read()` (call result). The identifier path below only resolves a
    // bare-identifier receiver; here the receiver is itself an expression, so compute
    // its type quietly (no double-emitted diagnostics) and resolve the member against
    // the object-type registry. Property-based shapes (fs.stat.dev/perm, fs.statvfs)
    // resolve through getMethod too. Resolve-only — don't emit "method does not exist"
    // for a chained receiver (conservative; avoids false positives on dynamic shapes).
    if (!node.computed
        && node.object.type !== 'Identifier'
        && node.object.type !== 'ThisExpression') {
      const recvType = this.checkNodeQuietly(node.object);
      // Tier-2 possibly-null warning for a chained/indexed/call receiver too
      // (e.g. `cursor().foreach()` on `uci.cursor | null`), mirroring the
      // identifier-receiver path — the resolution below returns early for handles.
      this.warnPossiblyNullMember(node, recvType);
      const detected = this.detectObjectType(recvType);
      if (detected) {
        const propName = this.getStaticPropertyName(node.property);
        if (propName) {
          const m = OBJECT_REGISTRIES[detected].getMethod(propName);
          if (Option.isSome(m)) {
            return this.parseReturnType(m.value.returnType);
          }
        }
      }
    }

    // Handle `this.property` — look up `this` in symbol table (declared by semantic analyzer)
    if (node.object.type === 'ThisExpression') {
      const thisSym = this.symbolTable.lookup('this');
      if (thisSym && thisSym.propertyTypes && !node.computed) {
        let propertyName: string | null = null;
        if (node.property.type === 'Identifier') {
          propertyName = (node.property as IdentifierNode).name;
        } else if (node.property.type === 'Literal') {
          const lit = node.property as LiteralNode;
          if (lit.value !== undefined && lit.value !== null) {
            propertyName = String(lit.value);
          }
        }
        if (propertyName && thisSym.propertyTypes.has(propertyName)) {
          // Flow-sensitive: the most-recent write at/before this read position.
          const propType = propertyTypeAt(thisSym, propertyName, node.start) ?? thisSym.propertyTypes.get(propertyName)!;
          return this.dataTypeToUcodeType(propType);
        }
      }
      return UcodeType.UNKNOWN;
    }

    // Check if the object is a module
    if (node.object.type === 'Identifier') {
      const symbol = this.symbolTable.lookup((node.object as IdentifierNode).name);

      // If symbol doesn't exist, let the semantic analyzer handle the "Undefined variable" error
      // Don't duplicate the error here by calling checkNode(node.object)
      if (!symbol) {
        return UcodeType.UNKNOWN;
      }

      // Tier 2 possibly-null warning for an IDENTIFIER receiver, emitted up front because the
      // object-handle method-resolution branch below returns early for handles (`fs.file|null`,
      // `uci.cursor|null`, …) — so a stored handle used unguarded (`let c = cursor(); c.foreach()`)
      // would otherwise never reach the late Tier-2 site. Uses the flow-narrowed type so guards
      // silence it. Does not return — the existing resolution still computes the member type.
      {
        const ntp = this.getNarrowedTypeAtPosition((node.object as IdentifierNode).name, node.object.start);
        this.warnPossiblyNullMember(node, ntp ?? effectiveSymbolType(symbol, node.object.start));
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
          // Don't trust stale propertyTypes once the variable has been reassigned to null
          // (its object-ness is gone). Most-recent type wins: `let x = {a:1}; x = null; x.a`
          // must see x as null here — not the dead {a:1} shape — so it falls through to the
          // null-receiver check below instead of returning the defunct property type.
          if (this.dataTypeToUcodeType(effectiveSymbolType(symbol, node.object.start)) !== UcodeType.NULL) {
            // Return the rich property type directly — flow-sensitive to the read position
            // (most-recent write at/before it), so `rv.days` reads `object` before the
            // `rv.days = keys(rv.days)` reassignment and `array<string>` after.
            return propertyTypeAt(symbol, propertyName, node.start) ?? symbol.propertyTypes.get(propertyName)!;
          }
        }
      }

      // A namespace import of a known module (`import * as socket from "socket"`) carries
      // the same {OBJECT, moduleName} shape as an object handle that module returns (e.g.
      // socket.create() also yields moduleName:'socket') — they're only distinguishable by
      // importSpecifier === '*'. For the namespace, `socket.create`/`socket.AF_INET` are
      // MODULE member access (functions/constants), not object methods, so skip the
      // object-type branch and let the module branch below resolve them.
      const nsModInfo = extractModuleType(symbol.dataType);
      const isModuleNamespace = symbol.importSpecifier === '*'
        && nsModInfo != null && isKnownModule(nsModInfo.moduleName);

      // Check if this is a known object type (fs.file/dir/proc, io.handle, uloop.*, uci.cursor, nl80211.listener)
      const detectedObjectType = isModuleNamespace ? null : this.detectObjectType(symbol.dataType);
      if (detectedObjectType && !node.computed) {
        const methodName = (node.property as IdentifierNode).name;
        const method = OBJECT_REGISTRIES[detectedObjectType].getMethod(methodName);
        if (Option.isSome(method)) {
          // Return the full method return type (preserves unions) directly.
          return this.parseReturnType(method.value.returnType);
        }
        this.errors.push({
          message: `Method '${methodName}' does not exist on ${detectedObjectType}`,
          start: node.start,
          end: node.end,
          severity: 'error',
          code: UcodeErrorCode.METHOD_NOT_FOUND,
        });
        return UcodeType.UNKNOWN;
      }

      // Module member access: `fs_mod.readfile` where fs_mod is `module:fs`.
      // A member that names a module function types as FUNCTION (so e.g.
      // `let readfile = fs_mod.readfile;` infers `function`, not `unknown`).
      const moduleInfo = extractModuleType(symbol.dataType);
      const modName = moduleInfo?.moduleName;
      if (modName && isKnownModule(modName) && !node.computed) {
        const memberName = this.getStaticPropertyName(node.property);
        if (memberName && MODULE_REGISTRIES[modName].getFunctionNames().includes(memberName)) {
          return UcodeType.FUNCTION;
        }
        // Module constants (socket.AF_INET, socket.SOCK_STREAM, …) are integers.
        if (memberName && MODULE_REGISTRIES[modName].getConstantNames().includes(memberName)) {
          return UcodeType.INTEGER;
        }
        // Object-handle exports (e.g. fs.stdin/stdout/stderr → fs.file): resolve to the
        // object type so `fs.stdin.read(...)` chains and hover shows the handle type.
        const objExportType = memberName ? MODULE_REGISTRIES[modName].getObjectExportType(memberName) : null;
        if (objExportType) {
          return { type: UcodeType.OBJECT, moduleName: objExportType } as UcodeDataType;
        }
      }

      // Check if this is an rtnl constants object with a specific property
      if (extractModuleType(symbol.dataType)?.moduleName === 'rtnl-const' && !node.computed) {
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
            severity: 'error',
            code: UcodeErrorCode.PROPERTY_NOT_FOUND,
          });
          return UcodeType.UNKNOWN;
        }
        return UcodeType.INTEGER; // RTNL constants are integers
      }
      
      // Check if this is an nl80211 constants object with a specific property
      if (extractModuleType(symbol.dataType)?.moduleName === 'nl80211-const' && !node.computed) {
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
            severity: 'error',
            code: UcodeErrorCode.PROPERTY_NOT_FOUND,
          });
          return UcodeType.UNKNOWN;
        }
        return UcodeType.INTEGER; // NL80211 constants are integers
      }
    }

    // Dictionary value-type FIRST: `O[expr]` where O is a string-keyed map whose
    // VALUE shape was inferred (valuePropertyTypes). Any key yields a value of
    // that shape → return OBJECT (the nested shape rides on the `let v = O[k]`
    // binding copy in the analyzer). Checked before the per-key keys-of union so
    // a map with an incidental static property still reads as its value shape.
    if (node.object.type === 'Identifier' && node.computed) {
      const dictSym = this.symbolTable.lookupAtPosition((node.object as IdentifierNode).name, node.start)
                   ?? this.symbolTable.lookup((node.object as IdentifierNode).name);
      if (dictSym?.valuePropertyTypes && dictSym.valuePropertyTypes.size > 0) {
        return UcodeType.OBJECT as UcodeDataType;
      }
    }

    // Computed property access on an OBJECT-typed identifier — try to type
    // it through static key resolution (literal, const ref, namespace nested
    // constant) OR through keys-of provenance (the key carries a tag that
    // proves it's one of the object's known keys).
    if (node.object.type === 'Identifier' && node.computed) {
      const objSym = this.symbolTable.lookupAtPosition((node.object as IdentifierNode).name, node.start)
                  ?? this.symbolTable.lookup((node.object as IdentifierNode).name);
      // Effective type at the access position. For `let x = {...}` the
      // declarator stamps dataType=OBJECT directly. For `let x; x = {...}`
      // the assignment-handler instead writes currentType (SSA) and leaves
      // dataType=UNKNOWN — so we'd miss the access without consulting both.
      let effType: UcodeDataType | undefined = objSym?.dataType;
      if (objSym?.currentType !== undefined && objSym.currentTypeEffectiveFrom !== undefined
          && node.start >= objSym.currentTypeEffectiveFrom) {
        effType = objSym.currentType;
      }
      const objIsObject = effType !== undefined
        && (effType === UcodeType.OBJECT
            || (typeof effType === 'object' && (effType as any).type === UcodeType.OBJECT));
      if (objSym && objIsObject && objSym.propertyTypes) {
        // 1. Static key resolution: `obj[LIT]`, `obj[const_ident]`, `obj[ns.A.B]`
        const keyStr = this.resolvePropertyKeyToString(node.property);
        if (keyStr !== null) {
          const t = objSym.propertyTypes.get(keyStr);
          if (t !== undefined) {
            return t;
          }
          // Literal that's NOT a known property: we have exhaustive propertyTypes
          // for object literals we own. Stay UNKNOWN (don't claim null — we can't
          // prove the key is missing if the object was mutated since declaration).
        }
        // 2. Keys-of provenance: `obj[k]` where k.keysOfSymbol === obj's name.
        const keyName = (node.property.type === 'Identifier') ? (node.property as IdentifierNode).name : null;
        if (keyName) {
          const keySym = this.symbolTable.lookupAtPosition(keyName, node.start) ?? this.symbolTable.lookup(keyName);
          if (keySym?.keysOfSymbol && keySym.keysOfSymbol === (node.object as IdentifierNode).name) {
            const valueUnion = this.computePropertyValueUnion(objSym.propertyTypes);
            if (valueUnion !== null) {
              return valueUnion;
            }
          }
        }
      }
    }

    // For computed property access on arrays (e.g., uuid[0]), check if we have type info
    if (node.object.type === 'Identifier' && node.computed) {
      const symbol = this.symbolTable.lookup((node.object as IdentifierNode).name);
      if (symbol && (symbol.dataType === UcodeType.ARRAY || isArrayType(symbol.dataType as UcodeDataType))) {
        // Propagate keys-of provenance: indexing a tagged array yields one of
        // the tagged object's keys. `let ks = keys(obj); ks[i]` → keysOfSymbol=obj.
        if (symbol.keysOfSymbol) {
          (node as any)._keysOfSymbol = symbol.keysOfSymbol;
        }
        // Check for per-index property types first
        if (node.property.type === 'Literal') {
          const indexKey = String((node.property as LiteralNode).value);
          if (symbol.propertyTypes && symbol.propertyTypes.has(indexKey)) {
            // Return the rich per-index element type directly.
            return symbol.propertyTypes.get(indexKey)!;
          }
        }
        // Fall back to ArrayType element type (element | null since index may be out of bounds)
        if (isArrayType(symbol.dataType as UcodeDataType)) {
          const elemType = getArrayElementType(symbol.dataType as UcodeDataType);
          // An index proven in bounds (literal under a `length` guard, or the
          // induction var of a `for (i=0; i<length(arr); …)` loop) can't miss →
          // drop the null.
          if (this.computedAccessInBounds(node.object, node.property, node.start)) {
            return elemType;
          }
          // Return the rich `element | null` union directly, preserving a handle
          // element type (e.g. `array<socket>[i]` → `socket | null`) so a chained
          // `arr[i].method()` still resolves — collapsing to the base would drop it.
          return createUnionType([...((isUnionType(elemType) ? getUnionTypes(elemType) : [elemType]) as SingleType[]), UcodeType.NULL]);
        }
      }
    }

    const objectType = this.checkNode(node.object);

    // Computed access on a UNION that contains an array (e.g. `array<string> | null`
    // from split() on a nullable arg, or `parts[i]` where parts is array|null):
    // indexing yields the array member's element type, plus null (index may
    // miss, or the receiver itself may be null). Union analogue of the
    // array-typed branch below — without this, `(array<string>|null)[i]`
    // collapses to unknown and the element's string-ness is lost downstream.
    if (node.computed && isUnionType(objectType)) {
      const arrMember = getUnionTypes(objectType).find(m => isArrayType(m) || singleTypeToBase(m) === UcodeType.ARRAY);
      if (arrMember) {
        const elemType = isArrayType(arrMember) ? getArrayElementType(arrMember) : UcodeType.UNKNOWN;
        // Preserve the rich element type (handle moduleName) in the union.
        return createUnionType([...((isUnionType(elemType) ? getUnionTypes(elemType) : [elemType]) as SingleType[]), UcodeType.NULL]);
      }
    }

    // For computed access on any array-typed expression (e.g., sort(arr)[0], split(s, d)[1])
    // recover ArrayType element info from the object's cached rich type.
    if (this.dataTypeToUcodeType(objectType) === UcodeType.ARRAY && node.computed) {
      const objFullType = this.getTypeOf(node.object);
      if (objFullType && isArrayType(objFullType)) {
        const elemType = getArrayElementType(objFullType);
        // Index proven in bounds (literal under a `length` guard, or a `for`
        // induction var) → no null.
        if (this.computedAccessInBounds(node.object, node.property, node.start)) {
          return elemType;
        }
        // Return the rich `element | null` union directly, preserving a handle
        // element type so `f()[i].method()` resolves.
        return createUnionType([...((isUnionType(elemType) ? getUnionTypes(elemType) : [elemType]) as SingleType[]), UcodeType.NULL]);
      }
    }

    // Collapse the rich object type to its base enum for the singleton
    // comparisons below (ARRAY/OBJECT/STRING/REGEX). The rich `objectType`
    // itself is used where union members matter (string-in-union check).
    const objectBase = this.dataTypeToUcodeType(objectType);

    // For an identifier receiver whose checked type collapsed to UNKNOWN, prefer
    // the flow-narrowed type (what hover shows) — so a value narrowed to a scalar
    // by an early-exit guard (`if (type(x) != "string") continue;`) is still
    // validated for invalid member access below. Equals objectBase otherwise.
    let narrowedBase = objectBase;
    if (!node.computed && objectBase === UcodeType.UNKNOWN && node.object.type === 'Identifier') {
      const nt = this.getNarrowedTypeAtPosition((node.object as IdentifierNode).name, node.object.start);
      if (nt && !isUnionType(nt)) narrowedBase = this.dataTypeToUcodeType(nt);
    }

    // A provably-null receiver: `let x; x.foo` / `x[0]` / `x.foo()` is a hard ucode runtime
    // error ("Reference error: left-hand side expression is null"). Optional chaining
    // (`?.` / `?.[`) short-circuits to null and is the sanctioned form, so it's exempt.
    // Tier 1 only — fires when the base is EXACTLY null. A `T | null` union collapses to
    // UNKNOWN here, so unions ("possibly null") are deliberately NOT flagged.
    //
    // Honor flow narrowing for an identifier receiver: a truthy guard `if (x) x.foo` makes
    // the body unreachable for a provably-null x (so it never errors at runtime), and a
    // reassignment `x = {}` changes the type — in both cases the narrowed type at this
    // position is no longer null, so don't flag. Only flag when x is STILL null here.
    let baseIsNull = (objectBase === UcodeType.NULL || narrowedBase === UcodeType.NULL);
    if (node.object.type === 'Identifier') {
      const nt = this.getNarrowedTypeAtPosition((node.object as IdentifierNode).name, node.object.start);
      if (nt !== null && nt !== undefined) {
        baseIsNull = (this.dataTypeToUcodeType(nt) === UcodeType.NULL);
      }
    }
    if (baseIsNull) {
      if (!node.optional) {
        const who = node.object.type === 'Identifier'
          ? ` ('${(node.object as IdentifierNode).name}' is null here)`
          : '';
        // A write target (`x.foo = 1`) is a *different* ucode error than a read
        // ("Type error: attempt to set property on null value" vs "Reference error: …"),
        // and optional chaining can't be used on an assignment LHS — so tailor the message.
        const isWrite = this.isAssignmentTargetContext();
        const prop = node.computed ? null : (node.property as IdentifierNode).name;
        let message: string;
        if (isWrite) {
          const what = prop ? `set property '${prop}' on` : 'set an element of';
          message = `Cannot ${what} a null value${who} — this is a runtime error in ucode (attempt to set property on null). Assign a non-null value first, or guard against null.`;
        } else {
          const what = prop ? `access property '${prop}' of` : 'index into';
          message = `Cannot ${what} a null value${who} — this is a runtime error in ucode. Use optional chaining (?.) if the value may be null.`;
        }
        this.errors.push({
          message,
          start: node.property.start,
          end: node.property.end,
          severity: 'error',
          code: UcodeErrorCode.NULL_MEMBER_ACCESS,
          data: this.nullAccessFixData(node),
        });
      }
      return UcodeType.NULL; // null.foo errors; null?.foo short-circuits — both yield null
    }

    // Tier 2 for a NON-identifier receiver (a direct chain like `cursor().foreach(...)` /
    // `fs.open(x).read()`). Identifier receivers are handled up front (see above) because
    // their handle resolution returns early. `objectType` is the checked type of the chain.
    if (node.object.type !== 'Identifier') {
      this.warnPossiblyNullMember(node, objectType);
    }

    // Check for array type — arrays in ucode have no properties or methods.
    // Also handle unions containing array (`array | null` from sort/filter, `object | array`
    // from the polymorphic nl80211/rtnl request() returns).
    if (!node.computed) {
      // Determine array/object membership from the richest type available (the checked rich
      // type for any expression; the SSA/declared type for an identifier).
      let dt: UcodeDataType = objectType;
      if (node.object.type === 'Identifier') {
        const sym = this.symbolTable.lookup((node.object as IdentifierNode).name);
        if (sym) dt = (sym.currentType || sym.dataType) as UcodeDataType;
      }
      let hasArray = objectBase === UcodeType.ARRAY || dt === UcodeType.ARRAY || isArrayType(dt);
      let hasObject = false;
      if (isUnionType(dt)) {
        const members = getUnionTypes(dt);
        if (members.some(m => singleTypeToBase(m) === UcodeType.ARRAY)) hasArray = true;
        if (members.some(m => singleTypeToBase(m) === UcodeType.OBJECT)) hasObject = true;
      }

      const propertyName = node.property.type === 'Identifier'
        ? (node.property as IdentifierNode).name
        : String((node.property as LiteralNode).value);

      if (hasArray && !hasObject) {
        // Pure array (or array | null | scalar) — arrays have no named members. Hard error.
        this.errors.push({
          message: `Property '${propertyName}' does not exist on array type. Arrays in ucode have no properties or methods. Use builtin functions instead (e.g., length(array), filter(array, callback)).`,
          start: node.property.start,
          end: node.property.end,
          severity: 'error',
          code: UcodeErrorCode.PROPERTY_NOT_FOUND,
        });
        return UcodeType.UNKNOWN;
      }

      if (hasArray && hasObject) {
        // `object | array` union — property access is valid on the object member but the
        // array member has no properties (access returns null, never a real value). Since we
        // can't prove which it is here, this is "possibly array" — WARN (and ERROR under
        // `'use strict'`), mirroring the possibly-null Tier-2 policy. (nl80211/rtnl request()
        // are genuinely irreducible here: object-vs-array is a runtime reply-count property,
        // not derivable from the arguments — verified in nl80211.c.) Fall through so the
        // object member can still resolve the type.
        const base = {
          message: `Property '${propertyName}' is accessed on a value that may be an array — arrays have no properties (the access returns null). Narrow the type or guard the array case.`,
          start: node.property.start,
          end: node.property.end,
          code: UcodeErrorCode.POSSIBLY_ARRAY_MEMBER_ACCESS,
        };
        if (this.strictMode) this.errors.push({ ...base, severity: 'error' });
        else this.warnings.push({ ...base, severity: 'warning' });
      }
    }
    
    if (objectBase === UcodeType.OBJECT) {
      return this.typeCompatibility.getObjectPropertyType(objectBase);
    }

    // String has no properties — error even when the receiver's base type
    // collapses to UNKNOWN but the rich type is STRING or a union containing
    // STRING (e.g. `parts[0]` where parts is array<string> yields STRING|NULL,
    // whose base collapses to UNKNOWN). Catches the common JavaScript-port
    // mistake `someStr.toUpperCase()`. objectType IS the rich type now.
    let receiverHasString = objectBase === UcodeType.STRING || narrowedBase === UcodeType.STRING;
    if (!receiverHasString && !node.computed) {
      if (objectType === UcodeType.STRING) {
        receiverHasString = true;
      } else if (isUnionType(objectType)) {
        receiverHasString = getUnionTypes(objectType).some(m => singleTypeToBase(m) === UcodeType.STRING);
      }
    }
    if (receiverHasString && !node.computed) {
      // String has no properties.
      const propertyName = (node.property as IdentifierNode).name;
      const hint = SCALAR_MEMBER_HINTS[propertyName];
      this.errors.push({
        message: `Property '${propertyName}' does not exist on string type. Strings in ucode have no member variables or functions.${hint ? ' ' + hint : ''}`,
        start: node.property.start,
        end: node.property.end,
        severity: 'error',
        code: UcodeErrorCode.PROPERTY_NOT_FOUND,
      });

      return UcodeType.UNKNOWN;
    }

    // Number / boolean / function have no properties either — `n.toFixed(2)`,
    // `b.foo`, `fn.prop` raise the same runtime reference error (ucode functions
    // are not objects; you cannot attach properties to them). Driven by
    // narrowedBase so a value narrowed to one of these by a guard is caught too.
    if (!node.computed && (narrowedBase === UcodeType.INTEGER || narrowedBase === UcodeType.DOUBLE || narrowedBase === UcodeType.BOOLEAN || narrowedBase === UcodeType.FUNCTION)) {
      const propertyName = (node.property as IdentifierNode).name;
      const hint = SCALAR_MEMBER_HINTS[propertyName];
      this.errors.push({
        message: `Property '${propertyName}' does not exist on ${narrowedBase} type. ucode ${narrowedBase}s are not objects.${hint ? ' ' + hint : ''}`,
        start: node.property.start,
        end: node.property.end,
        severity: 'error',
        code: UcodeErrorCode.PROPERTY_NOT_FOUND,
      });
      return UcodeType.UNKNOWN;
    }

    if (objectBase === UcodeType.REGEX && !node.computed) {
      // Regex objects have no properties or methods at all
      const propertyName = (node.property as IdentifierNode).name;

      // Invalid property/method access on regex
      this.errors.push({
        message: `Property '${propertyName}' does not exist on regex type. Regular expressions in ucode have no properties or methods. Use builtin functions instead (e.g., match(string, regex), replace(string, regex, replacement)).`,
        start: node.property.start,
        end: node.property.end,
        severity: 'error',
        code: UcodeErrorCode.PROPERTY_NOT_FOUND,
      });
      return UcodeType.UNKNOWN;
    }

    return UcodeType.UNKNOWN;
  }



  private checkAssignmentExpression(node: AssignmentExpressionNode): CheckResult {
    // Check the target for its side effects (populates _fullType, guards, etc.);
    // its type isn't used — ucode assignment has no type-compatibility constraint.
    this.checkNode(node.left);
    const rightType = this.checkNode(node.right);

    // Track array element types
    if (node.operator === '=' && node.left.type === 'MemberExpression') {
      const memberExpr = node.left as MemberExpressionNode;
      if (memberExpr.object.type === 'Identifier' && memberExpr.computed) {
        const arrayName = (memberExpr.object as IdentifierNode).name;
        const symbol = this.symbolTable.lookup(arrayName);

        // If this is an array variable, track the element type
        if (symbol && (symbol.dataType === UcodeType.ARRAY || isArrayType(symbol.dataType as UcodeDataType))) {
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

            // Store the type of this array element. PhaseA: rightType is now
            // UcodeDataType (the rich type we want anyway), so no conversion.
            symbol.propertyTypes.set(indexKey, rightType);
          }
        }
      }
    }

    // ucode is dynamically typed — assignment never has a type-compatibility
    // constraint (a property or element may be reassigned to any type), so there
    // is no assignment type check here.

    return rightType;
  }

  private checkArrayExpression(node: ArrayExpressionNode): CheckResult {
    // Check all elements and collect their types for Array<T> inference
    // Use UcodeDataType to preserve rich types (ArrayType for nested arrays, etc.)
    const elementDataTypes: UcodeDataType[] = [];
    for (const element of node.elements) {
      if (element) {
        // elType is the rich type now (checkNode returns it).
        const elType = this.checkNode(element);
        if (isUnionType(elType) || isArrayType(elType)) {
          // Rich type (union or ArrayType) — deduplicate by checking existing entries
          const isDup = elementDataTypes.some(t =>
            (typeof t !== 'string' && JSON.stringify(t) === JSON.stringify(elType))
          );
          if (!isDup) elementDataTypes.push(elType);
        } else if (elType !== UcodeType.UNKNOWN) {
          if (!elementDataTypes.includes(elType)) {
            elementDataTypes.push(elType);
          }
        }
      }
    }

    // Store Array<T> as _fullType if we inferred element types
    if (elementDataTypes.length > 0) {
      let elementType: UcodeDataType;
      if (elementDataTypes.length === 1) {
        elementType = elementDataTypes[0]!;
      } else {
        // For multiple element types: if all are simple UcodeType strings, use createUnionType.
        // Otherwise store as-is (mixed rich types can't form a standard union).
        const allSimple = elementDataTypes.every(t => typeof t === 'string');
        if (allSimple) {
          elementType = createUnionType(elementDataTypes as UcodeType[]);
        } else {
          // Mix of rich types — flatten simple types into union, keep first rich type
          // This handles cases like [[1], "two"] → array<array<integer> | string>
          elementType = createUnionType(
            elementDataTypes.map(t => typeof t === 'string' ? t as UcodeType : UcodeType.ARRAY)
          );
        }
      }
      // Return the rich array<T> directly; base consumers collapse to ARRAY.
      return createArrayType(elementType);
    }

    return UcodeType.ARRAY;
  }

  private checkObjectExpression(node: ObjectExpressionNode): CheckResult {
    // Check all properties
    for (const property of node.properties) {
      if (property.type === 'SpreadElement') continue;
      this.checkNode(property.key);
      this.checkNode(property.value);
    }
    return UcodeType.OBJECT;
  }

  private checkConditionalExpression(node: ConditionalExpressionNode): CheckResult {
    this.truthinessDepth++;
    this.checkNode(node.test);
    this.truthinessDepth--;
    const consequentType = this.checkNode(node.consequent);
    const alternateType = this.checkNode(node.alternate);

    // Union the RICH branch types directly so refined members survive. Collapsing each
    // branch to a base UcodeType first (the old behavior) turned any *union* branch into
    // UNKNOWN — e.g. `cond ? lsdir() : null` (lsdir → array<string>|null) became
    // `unknown | null` instead of `array<string> | null`, and `d ? d : null`
    // (d: string|null) became `unknown | null` instead of `string | null`.
    return createUnionType([...getUnionTypes(consequentType), ...getUnionTypes(alternateType)]);
  }

  private checkArrowFunctionExpression(_node: ArrowFunctionExpressionNode): CheckResult {
    // Arrow functions are callable, so they have function type
    // For now, we don't analyze parameter types or return type inference
    // This is sufficient to prevent "Undefined function" errors for arrow functions
    return UcodeType.FUNCTION;
  }

  private checkFunctionExpression(_node: FunctionExpressionNode): CheckResult {
    // Function expressions are also callable
    return UcodeType.FUNCTION;
  }

  private checkIfStatement(node: IfStatementNode): CheckResult {
    // Type check the condition (in truthiness context)
    this.truthinessDepth++;
    this.checkNode(node.test);
    this.truthinessDepth--;

    // Traverse both branches. (The guardContextStack push/pop that used to wrap
    // these — fed by FlowSensitiveTypeTracker.analyzeIfStatement — was proven
    // redundant and removed: guard narrowing for diagnostics flows through the
    // per-query getGuardsForPosition walk and the engine-backed post-visit
    // filter; for hover through getNarrowedTypeAtPosition. C2.)
    if (node.consequent) this.checkNode(node.consequent);
    if (node.alternate) this.checkNode(node.alternate);

    return UcodeType.UNKNOWN; // If statements don't return values
  }

  private checkExpressionStatement(node: ExpressionStatementNode): CheckResult {
    return this.checkNode(node.expression);
  }

  private checkVariableDeclaration(node: VariableDeclarationNode): CheckResult {
    for (const declarator of node.declarations) {
      if (declarator.init) {
        this.checkNode(declarator.init);
      }
    }
    return UcodeType.UNKNOWN;
  }

  private checkBlockStatement(node: BlockStatementNode): CheckResult {
    // Plain straight-line traversal. (The early-exit-if detection that used to
    // push negative narrowing onto the guardContextStack for the remaining
    // statements — fed by FlowSensitiveTypeTracker.analyzeIfStatement + the
    // diagnosticTypeAliases map — was proven redundant and removed: early-exit
    // narrowing for diagnostics now flows through the per-query getGuardsForPosition
    // walk and the engine-backed post-visit filter. C2.)
    for (const statement of node.body) {
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

    // try { … } catch { … }: terminates when the try block always terminates AND
    // (there's no catch — an uncaught throw exits — OR the catch also terminates).
    if (last.type === 'TryStatement') {
      const t = last as TryStatementNode;
      if (!this.blockAlwaysTerminates(t.block)) return false;
      return !t.handler || this.blockAlwaysTerminates(t.handler.body);
    }

    // if/else where BOTH branches always terminate (an else is required — a bare
    // `if` can fall through when the condition is false).
    if (last.type === 'IfStatement') {
      const ifStmt = last as IfStatementNode;
      return !!ifStmt.consequent && this.blockAlwaysTerminates(ifStmt.consequent)
        && !!ifStmt.alternate && this.blockAlwaysTerminates(ifStmt.alternate);
    }

    return false;
  }

  private checkReturnStatement(node: ReturnStatementNode): CheckResult {
    if (node.argument) {
      return this.checkNode(node.argument);
    }
    return UcodeType.UNKNOWN;
  }

  private checkSwitchStatement(node: SwitchStatementNode): CheckResult {
    this.checkNode(node.discriminant);

    // Traverse each case body. (The type-switch narrowing that used to push onto
    // the guardContextStack per case — `switch (type(x)) { case "string": … }` —
    // was proven redundant and removed: that narrowing for diagnostics flows
    // through the per-query getGuardsForPosition switch handling, and for hover
    // through getNarrowedTypeAtPosition. C2.)
    for (const caseNode of node.cases) {
      for (const statement of caseNode.consequent) {
        this.checkNode(statement);
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
      case 'regex':
      case 'regexp':
        return UcodeType.REGEX;
      default:
        return null;
    }
  }

  private checkTryStatement(node: TryStatementNode): CheckResult {
    // Check the try block
    if (node.block) {
      this.checkNode(node.block);
    }

    // Check catch handler (let checkCatchClause handle the details)
    if (node.handler) {
      this.checkNode(node.handler);
    }

    // Check finally block. NOTE: TryStatementNode has no `finalizer` in the grammar
    // (ucode `try` has no `finally`), so this branch is effectively dead; kept for safety.
    const finalizer = (node as { finalizer?: AstNode }).finalizer;
    if (finalizer) {
      this.checkNode(finalizer);
    }

    return UcodeType.UNKNOWN;
  }

  private checkCatchClause(node: CatchClauseNode): CheckResult {
    // Enter catch scope
    this.symbolTable.enterScope(node?.start ?? 0);

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
    this.symbolTable.exitScope(node.end);

    return UcodeType.UNKNOWN;
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

  getCommonReturnType(types: UcodeDataType[]): UcodeDataType {
    return this.typeCompatibility.getCommonType(types);
  }

  /**
   * Set the current AST root for AST analysis
   */
  setAST(ast: ProgramNode): void {
    this.currentAST = ast;
    this.guardCache.clear(); // structural guard cache is per-AST; reset when the AST changes
    this.strictMode = this.detectStrictMode(ast);
    this.builtinValidator.setStrictMode(this.strictMode);
  }

  /** Provide the document's raw source so builtin validators can read a node's exact source
   *  slice (the decoded literal `.value` loses escapes — needed for match's regex suggestion). */
  setSource(src: string): void {
    this.builtinValidator.setSource(src);
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
    // Symbol base (needed by both the engine refinement check and the legacy path).
    // Try both lookup (current scope) and lookupAtPosition (exited scopes like callbacks).
    let symbol = this.symbolTable.lookup(variableName);
    if (!symbol) {
      symbol = this.symbolTable.lookupAtPosition(variableName, position);
    }

    // C1 — the flow engine now folds in BOTH reassignment narrowing AND guards
    // (edge transfers), so it is the primary authority. It only covers what the
    // CFG models, though: guard forms the CFG treats as opaque (ternary /
    // `&&`-as-bare-expression) are still seen only by the legacy position walk.
    // So we take the MORE-NARROWED of the two — the engine carries reassignment
    // narrowing the legacy lacks; the legacy carries the not-yet-in-CFG guard
    // forms. Whichever is the strict subtype is the more precise (both are sound
    // narrowings of the same point, so this is their meet, never a widening).
    // The engine is a post-`visit` pass → empty during emission (→ undefined),
    // so emission keeps the legacy result unchanged until C2.
    let engineResult: UcodeDataType | undefined;
    if (symbol) {
      const flowFull = this.flowBaseAt(variableName, position);
      if (flowFull !== undefined && !this.dataTypesCanonicalEqual(flowFull, symbol.dataType)) {
        engineResult = flowFull;
      }
    }

    const legacyResult = this.legacyNarrowedTypeAtPosition(variableName, position, symbol);

    if (engineResult === undefined) return legacyResult;
    if (legacyResult === null) return engineResult;
    return this.moreNarrowed(engineResult, legacyResult);
  }

  /** Of two sound narrowings of the same point, the more precise (strict subtype).
   *  Incomparable → the engine result (the authority). */
  private moreNarrowed(engineResult: UcodeDataType, legacyResult: UcodeDataType): UcodeDataType {
    if (this.dataTypesCanonicalEqual(engineResult, legacyResult)) return engineResult;
    const engineMembers = getUnionTypes(engineResult) as SingleType[];
    const legacyMembers = getUnionTypes(legacyResult) as SingleType[];
    // legacy ⊆ engine → legacy is more narrowed (e.g. ternary the engine missed).
    if (this.typeNarrowing.isSubtypeOfUnion(legacyResult, engineMembers)) return legacyResult;
    // engine ⊆ legacy → engine is more narrowed (e.g. reassignment the legacy missed).
    if (this.typeNarrowing.isSubtypeOfUnion(engineResult, legacyMembers)) return engineResult;
    return engineResult;
  }

  /** The pre-C1 per-query narrowing: the position guard walk (incl. ternary /
   *  `&&` forms) applied to the SSA-effective base. One of the two inputs to
   *  `getNarrowedTypeAtPosition` (the other is the engine). */
  private legacyNarrowedTypeAtPosition(variableName: string, position: number, symbol: UcodeSymbol | null | undefined): UcodeDataType | null {
    const guards = this.getGuardsForPosition(this.currentAST, variableName, position);

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

    const ssaActive = symbol.currentType !== undefined && symbol.currentTypeEffectiveFrom !== undefined
        && position >= symbol.currentTypeEffectiveFrom;
    const baseType: UcodeDataType = effectiveSymbolType(symbol, position);

    // Check if this position is inside a type guard
    if (guards.length > 0) {
      // Apply guards sequentially — each guard further narrows the result.
      // Combined union guards (isCombinedOr from switch fall-through or OR chains)
      // return their union type directly via applyTypeGuard.
      let narrowedType = baseType;
      for (const guardInfo of guards) {
        narrowedType = this.applyTypeGuard(narrowedType, guardInfo);
      }
      return narrowedType;
    }

    // No guards — return the base only when SSA narrowing is active; otherwise
    // null signals "no narrowing applies" (callers fall back to the declared type).
    return ssaActive ? baseType : null;
  }

  /** Order-independent structural equality of two data types (for the flow-base
   *  refinement check). Mirrors flowTypeEngine's canonical comparison. */
  private dataTypesCanonicalEqual(a: UcodeDataType, b: UcodeDataType): boolean {
    if (a === b) return true;
    const canon = (t: UcodeDataType): string => {
      if (typeof t === 'string') return t;
      const u = getUnionTypes(t);
      if (u.length > 1) return '|' + u.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).sort().join('|');
      return JSON.stringify(t);
    };
    return canon(a) === canon(b);
  }

  /** Per-function flow engines, computed once after the main analysis pass.
   *  Each entry covers a function body's source range. */
  private flowEngines: Array<{ start: number; end: number; engine: FlowTypeEngine }> = [];

  /** The flow engine's reassignment-narrowed base for `varName` at `position`,
   *  using the INNERMOST enclosing function's engine. Empty (→ undefined) during
   *  the main analysis pass, so it only augments post-analysis queries (hover). */
  private flowBaseAt(variableName: string, position: number): UcodeDataType | undefined {
    let best: { start: number; end: number; engine: FlowTypeEngine } | undefined;
    for (const fe of this.flowEngines) {
      if (position >= fe.start && position <= fe.end) {
        if (!best || (fe.end - fe.start) < (best.end - best.start)) best = fe;
      }
    }
    return best?.engine.baseTypeAt(variableName, position);
  }

  /** Side-effect-free type of an expression node, for the flow engine's transfer:
   *  the cached checked type (carries reassignment narrowing) with a literal
   *  fallback (literal inits aren't cached). */
  private nodeTypeForFlow(node: AstNode): UcodeDataType | undefined {
    const cached = this.getTypeOf(node);
    if (cached !== undefined) return cached;
    if (node.type === 'Literal') {
      const v = (node as LiteralNode).value;
      if (typeof v === 'string') return UcodeType.STRING;
      if (typeof v === 'number') return Number.isInteger(v) ? UcodeType.INTEGER : UcodeType.DOUBLE;
      if (typeof v === 'boolean') return UcodeType.BOOLEAN;
      if (v === null) return UcodeType.NULL;
    }
    return undefined;
  }

  /**
   * Build the per-function flow engines (Phase B). Called once by the analyzer
   * AFTER the main checkNode pass, when the getTypeOf cache and function
   * signatures are populated. Walks every function, builds a CFG from its body,
   * seeds the entry env with the function's parameter types, and runs the
   * dataflow to a fixpoint.
   */
  buildFlowEngines(ast: ProgramNode): void {
    this.flowEngines = [];
    const typeOf = (n: AstNode) => this.nodeTypeForFlow(n);
    const transfer = makeAssignmentTransfer(typeOf);
    const edgeGuard = this.makeEdgeGuardTransfer(); // C1: guards folded into the dataflow

    const visit = (node: AstNode): void => {
      if (!node || typeof node !== 'object') return;
      const t = node.type;
      if ((t === 'FunctionDeclaration' || t === 'FunctionExpression' || t === 'ArrowFunctionExpression')
          && (node as any).body && !(node as any).forwardDeclaration) {
        const fnBody = (node as any).body;
        if (fnBody.type === 'BlockStatement') {
          try {
            const cfg = new CFGBuilder('fn').build(fnBody);
            const entryEnv: FlowEnvironment = this.functionParamEnv(node);
            const engine = new FlowTypeEngine(cfg, transfer, entryEnv, edgeGuard);
            engine.compute();
            this.flowEngines.push({ start: fnBody.start, end: fnBody.end, engine });
          } catch { /* never let engine construction break analysis */ }
        }
      }
      for (const key of Object.keys(node)) {
        const child = (node as any)[key];
        if (Array.isArray(child)) child.forEach(c => { if (c && typeof c === 'object' && c.type) visit(c); });
        else if (child && typeof child === 'object' && child.type) visit(child);
      }
    };
    visit(ast);
  }

  /**
   * C1: the engine's edge-guard transfer. For a conditional CFG edge (its
   * `condition` AST + whether it's the negative/else/false/early-exit edge),
   * narrow every tracked variable in the flowing env. Reuses the SAME guard
   * extractors the per-query path uses (`collectPositiveTestGuards` /
   * `extractTypeGuard` + the negated forms) and `applyTypeGuard`, so a guard
   * form is authored in exactly one place — folded into the dataflow instead of
   * re-walked per query. The accumulation across nested branches happens
   * naturally as the env flows block-to-block.
   */
  private makeEdgeGuardTransfer(): EdgeGuardFn {
    return (condition: AstNode, isNegative: boolean, env: Map<string, UcodeDataType>) => {
      for (const varName of env.keys()) {
        const guards = this.guardsFromEdgeCondition(condition, isNegative, varName);
        if (guards.length === 0) continue;
        let t = env.get(varName)!;
        for (const g of guards) t = this.applyTypeGuard(t, g);
        env.set(varName, t);
      }
    };
  }

  /**
   * The guards that hold for `variableName` along a single branch edge whose
   * test is `condition`. Positive edge (then / loop-body / true): the same
   * positive-branch guards `collectGuards` collects for an if-consequent.
   * Negative edge (else / false / early-exit fall-through): the negated type
   * guard (skipping null-propagation, which doesn't flip) plus the `if (!x)`
   * non-null form — mirroring `collectGuards`'s alternate branch exactly.
   */
  private guardsFromEdgeCondition(condition: AstNode, isNegative: boolean, variableName: string): TypeGuardInfo[] {
    this.transitiveTypeAliases = [];
    const guards: TypeGuardInfo[] = [];
    if (!isNegative) {
      this.collectPositiveTestGuards(condition, variableName, guards);
    } else {
      const guardInfo = this.extractTypeGuard(condition, variableName);
      if (guardInfo && !guardInfo.isNullPropagation) {
        guards.push({ ...guardInfo, isNegative: !guardInfo.isNegative });
      }
      if (condition.type === 'UnaryExpression') {
        const unary = condition as UnaryExpressionNode;
        if (unary.operator === '!' && unary.argument
            && (unary.argument.type === 'Identifier' || unary.argument.type === 'MemberExpression')
            && this.getDottedPath(unary.argument) === variableName) {
          guards.push({ variableName, narrowToType: UcodeType.NULL, isNegative: true });
        }
      }
    }
    return guards;
  }

  /** Entry environment for a function — its parameters seeded with the resolved
   *  signature types (from the function symbol's ParamInfo). */
  private functionParamEnv(fnNode: AstNode): FlowEnvironment {
    const env = new Map<string, UcodeDataType>();
    const name = (fnNode as any).id?.name;
    if (name) {
      const sym = this.symbolTable.lookup(name);
      for (const p of (sym?.parameters ?? [])) env.set(p.name, p.type);
    }
    return env;
  }

  /**
   * Get the symbol from a variable-to-variable equality guard at a position.
   * Used by hover to display the full type signature from the other variable.
   */
  getEqualityNarrowSymbolAtPosition(variableName: string, position: number): UcodeSymbol | null {
    const guards = this.getGuardsForPosition(this.currentAST, variableName, position);
    for (const guard of guards) {
      if (guard.equalitySymbol && !guard.isNegative) {
        return guard.equalitySymbol;
      }
    }
    return null;
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
    // Handle variable-to-variable equality narrowing
    if (guard.equalityNarrowType !== undefined) {
      if (!guard.isNegative) {
        // Positive: x == y proved, so x has y's type
        return guard.equalityNarrowType;
      }
      // Negative: x != y, can't meaningfully narrow
      return baseType;
    }

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
  // Cache for getGuardsForPosition, keyed by `${variableName}\0${position}`. collectGuards
  // walks the WHOLE AST and is purely structural (a function of ast + variableName + position;
  // the AST is immutable within an analysis), so the result is memoizable. It was called ~15k
  // times on fw4.uc (once per narrowing query, ~7k member accesses) → O(n²). Cleared per
  // analysis in setAST. Also stores the `transitiveTypeAliases` side-effect output.
  private guardCache = new Map<string, { guards: TypeGuardInfo[]; aliases: string[] }>();

  private getGuardsForPosition(ast: AstNode | null, variableName: string, position: number): TypeGuardInfo[] {
    if (!ast) {
      return [];
    }
    const key = variableName + '' + position;
    const cached = this.guardCache.get(key);
    if (cached) {
      this.transitiveTypeAliases = cached.aliases;
      return cached.guards;
    }
    this.transitiveTypeAliases = [];
    const guards: TypeGuardInfo[] = [];
    this.collectGuards(ast, variableName, position, guards);
    this.guardCache.set(key, { guards, aliases: this.transitiveTypeAliases });
    return guards;
  }

  /**
   * Collect the guards that hold in the POSITIVE (truthy) branch of `test` for
   * `variableName` — the type guard (incl. `&&` chains), plus truthiness of the
   * variable itself (an identifier OR a constant member path like `parts[5]` /
   * `o.name`), the `&&`-left-operand form, and a null-propagating call. Shared by
   * if-statement consequents and ternary consequents.
   */
  private collectPositiveTestGuards(test: AstNode, variableName: string, guards: TypeGuardInfo[]): void {
    // For compound `&&` tests like `type(x) == "string" && length(x) > 0`,
    // extractTypeGuard handles single conditions; findGuardInCondition walks `&&`.
    let guardInfo = this.extractTypeGuard(test, variableName);
    if (!guardInfo && test.type === 'BinaryExpression'
        && (test as BinaryExpressionNode).operator === '&&') {
      guardInfo = this.findGuardInCondition(test, variableName);
    }
    if (guardInfo) guards.push(guardInfo);

    // Truthiness of the variable itself: `x`, `parts[5]`, or `o.name` (identifier
    // or constant member path) → non-null in the truthy branch.
    if ((test.type === 'Identifier' || test.type === 'MemberExpression')
        && this.getDottedPath(test) === variableName) {
      guards.push({ variableName, narrowToType: UcodeType.NULL, isNegative: true });
    }
    // `&&` left-operand truthiness: `x && expr` / `parts[5] && expr`.
    if (test.type === 'BinaryExpression') {
      const tb = test as BinaryExpressionNode;
      if (tb.operator === '&&'
          && (tb.left.type === 'Identifier' || tb.left.type === 'MemberExpression')
          && this.getDottedPath(tb.left) === variableName) {
        guards.push({ variableName, narrowToType: UcodeType.NULL, isNegative: true });
      }
    }
    // Truthiness of a null-propagating call: `if (length(x)) { ... }`.
    if (test.type === 'CallExpression') {
      const np = this.getNullPropagatingArg(test);
      if (np && this.getArgVariableName(np.arg) === variableName) {
        guards.push({ variableName, narrowToType: UcodeType.NULL, isNegative: true });
      }
      // Truthiness of an fs string-contract call: `if (stat(path)) { … }`, or the
      // fall-through of `if (!stat(path)) return`. A non-null result proves the arg
      // was a string, so narrow `unknown → string` here. Positive-only.
      const sc = this.getStringContractArg(test);
      if (sc && this.getArgVariableName(sc.arg) === variableName) {
        guards.push({ variableName, narrowToType: UcodeType.STRING, isNegative: false });
      }
    }
    // Truthiness of a plain assignment used AS the condition: `while ((line = fh.read('line')))`
    // or `if ((m = match(s, re)))`. A truthy condition means the assigned value — and thus the
    // target — is non-null in the branch. This is THE canonical read-line / match idiom over a
    // `T | null` producer (e.g. fs handle read()), so it must narrow the target. Plain `=` only;
    // `||=`/`??=`/etc. have different truthiness semantics.
    if (test.type === 'AssignmentExpression') {
      const asn = test as AssignmentExpressionNode;
      if (asn.operator === '='
          && (asn.left.type === 'Identifier' || asn.left.type === 'MemberExpression')
          && this.getDottedPath(asn.left) === variableName) {
        guards.push({ variableName, narrowToType: UcodeType.NULL, isNegative: true });
      }
    }
  }

  /** Is `name` assigned (=, compound-assign, ++/--, or re-declared) anywhere in `root`
   *  with a source offset strictly between `after` and `before`? Conservative scan used
   *  to invalidate an early-exit null-guard narrowing when an intervening reassignment
   *  could have changed the variable (so `if (!x) return; x = null; x.foo` still flags). */
  private isVariableAssignedBetween(root: AstNode | null, name: string, after: number, before: number): boolean {
    let found = false;
    const targetsName = (t: unknown): boolean => isAstNodeLike(t) && t.type === 'Identifier' && t.name === name;
    const walk = (n: unknown): void => {
      if (found || !isAstNodeLike(n)) return;
      if (typeof n.start === 'number' && n.start > after && n.start < before) {
        // NB: only `=`/compound-assign and re-declaration invalidate the guard here.
        // ucode's ++/-- is a UnaryExpression, but `x++`/`x--` can't turn `x` back into
        // null, so it must NOT count as an invalidating reassignment for a null-guard —
        // treating it as one reverts `x` to its declared-null type and falsely flags
        // `if (!x) return; x++; x.foo()`. (The old code checked a non-existent
        // 'UpdateExpression' kind, so it never matched — correct by accident; made explicit.)
        if ((n.type === 'AssignmentExpression' && targetsName(n.left))
            || (n.type === 'VariableDeclarator' && targetsName(n.id))) {
          found = true;
          return;
        }
      }
      for (const k of Object.keys(n)) {
        if (k === 'parent' || k === 'leadingJsDoc') continue;
        const v = n[k];
        if (Array.isArray(v)) { for (const it of v) walk(it); }
        else if (isAstNodeLike(v)) walk(v);
      }
    };
    walk(root);
    return found;
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
        // Collect the positive-branch guards from the test (type guards + truthiness
        // of an identifier / constant member path / null-propagating call).
        this.collectPositiveTestGuards(ifNode.test, variableName, guards);
        this.collectGuards(ifNode.consequent, variableName, position, guards);
        return;
      }

      if (ifNode.alternate &&
          position >= ifNode.alternate.start &&
          position <= ifNode.alternate.end) {
        const guardInfo = this.extractTypeGuard(ifNode.test, variableName);
        // Don't negate a null-propagation guard into the else branch: a false
        // `substr(x,…) == 'wlan'` (i.e. the else) does NOT imply x is null — the
        // call also returns null when x isn't a string, so `!= 'wlan'` is true for
        // BOTH a null x and a non-matching string x. Negating it wrongly narrows x
        // to null, which compounds across an else-if chain (mirrors the early-exit
        // guard at the sibling scan above).
        if (guardInfo && !guardInfo.isNullPropagation) {
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

    // `while (test) body` — the test is truthy on entry to every iteration, so the
    // body gets the same positive guards as an if-consequent (e.g. `while (x)` or
    // `while ((line = fh.read('line')))` narrows the subject to non-null in the body).
    if (node.type === 'WhileStatement') {
      const whileNode = node as WhileStatementNode;
      if (whileNode.body &&
          position >= whileNode.body.start &&
          position <= whileNode.body.end) {
        this.collectPositiveTestGuards(whileNode.test, variableName, guards);
        this.collectGuards(whileNode.body, variableName, position, guards);
        return;
      }
    }

    // `for (init; test; update) body` — same as `while`: the test is truthy in the
    // body. (A `for` with no test imposes no guard.)
    if (node.type === 'ForStatement') {
      const forNode = node as ForStatementNode;
      if (forNode.test && forNode.body &&
          position >= forNode.body.start &&
          position <= forNode.body.end) {
        this.collectPositiveTestGuards(forNode.test, variableName, guards);
        this.collectGuards(forNode.body, variableName, position, guards);
        return;
      }
    }

    // Ternary `test ? consequent : alternate` — mirrors the if-statement narrowing.
    // The consequent runs only when `test` is truthy, so it gets the same positive
    // guards (e.g. `parts[5] ? uc(parts[5]) : null` narrows parts[5] to non-null).
    if (node.type === 'ConditionalExpression') {
      const cond = node as ConditionalExpressionNode;
      if (position >= cond.consequent.start && position <= cond.consequent.end) {
        this.collectPositiveTestGuards(cond.test, variableName, guards);
        this.collectGuards(cond.consequent, variableName, position, guards);
        return;
      }
      if (position >= cond.alternate.start && position <= cond.alternate.end) {
        const guardInfo = this.extractTypeGuard(cond.test, variableName);
        if (guardInfo && !guardInfo.isNullPropagation) {
          guards.push({ ...guardInfo, isNegative: !guardInfo.isNegative });
        }
        this.collectGuards(cond.alternate, variableName, position, guards);
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
              // Multiple types due to fall-through in non-default case — combine into single union guard
              guards.push({
                variableName,
                narrowToType: createUnionType(reachableTypes) as UcodeType,
                isNegative: false,
                isCombinedOr: true
              });
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
                // Skip negating null-propagation guards — length(x) > N returning false
                // doesn't mean x is null, just that the comparison failed.
                if (!guardInfo.isNullPropagation) {
                  guards.push({ ...guardInfo, isNegative: !guardInfo.isNegative });
                }
              } else {
                // Handle AND chains: if (type(x) != "string" && type(x) != "array") return;
                // When negated (early-return), this means x IS string OR array.
                const andGuards = this.extractAndChainGuards(sibIf.test, variableName);
                // The `!(A && B) = !A || !B` union narrowing is only sound when
                // EVERY term is a clean type-of guard. A null-propagation term
                // (`substr(x,…) == lit`) breaks it — its negation says nothing
                // about x's type — so bail on the combined narrowing entirely.
                if (andGuards.length >= 2 && andGuards.every(g => g.isNegative)
                    && !andGuards.some(g => g.isNullPropagation)) {
                  // Flip each to positive and combine as union
                  const types = andGuards.map(g => g.narrowToType).filter((t): t is UcodeType => t !== null);
                  if (types.length >= 2) {
                    guards.push({
                      variableName,
                      narrowToType: createUnionType(types) as UcodeType,
                      isNegative: false,
                      isCombinedOr: true
                    } as TypeGuardInfo);
                  }
                }
                // Handle OR chains: if (type(x) != "string" || !x) return;
                // After early-return, !A && !B — each OR branch is independently false.
                // Extract type guards from individual OR branches and negate each.
                // Skip null-propagation guards: `!(substr(x,…) == lit)` is true for a
                // null x too, so negating one would wrongly narrow x to null and
                // (across a chain) erase an earlier type narrowing.
                const orGuards = this.extractOrChainGuards(sibIf.test, variableName);
                for (const og of orGuards) {
                  if (og.isNullPropagation) continue;
                  guards.push({ ...og, isNegative: !og.isNegative });
                }
              }
              // Early-exit on a string-contract call: `if (!stat(path) || …) return;`
              // proves `path` is a string in the fall-through. Independent of the
              // type-guard extractors above (works whether or not guardInfo matched).
              this.collectNegatedStringContractGuards(sibIf.test, variableName, guards);
              // Handle: if (!x) die() → x is non-null after
              // Only when variable could be null. Use the EFFECTIVE type at this
              // position (SSA currentType) — not the declared dataType — so a
              // declare-then-assign variable (`let c; c = fs.readfile(p);`, whose
              // declared type is the uninitialized `null`) is recognised as
              // string|null and gets null removed after `if (!c) { … return }`.
              if (sibIf.test.type === 'UnaryExpression') {
                const unary = sibIf.test as any;
                if (unary.operator === '!' && unary.argument?.type === 'Identifier'
                    && unary.argument.name === variableName) {
                  // Position-aware lookup: a hover/narrowing query runs AFTER the
                  // function scope has exited, so plain lookup() misses a local
                  // variable — lookupAtPosition finds it by the query position.
                  const sym = this.symbolTable.lookup(variableName)
                    ?? this.symbolTable.lookupAtPosition(variableName, position);
                  const effType = sym ? this.getEffectiveSymbolDataType(sym, position) : undefined;
                  if (effType && isUnionType(effType) && getUnionTypes(effType).includes(UcodeType.NULL)) {
                    guards.push({ variableName, narrowToType: UcodeType.NULL, isNegative: true });
                  } else if (effType && this.dataTypeToUcodeType(effType) === UcodeType.NULL
                             && !this.isVariableAssignedBetween(node, variableName, sibIf.end, position)) {
                    // x is typed EXACTLY null (e.g. a module-level `let ctx;` whose only
                    // non-null assignment lives in another function, so we never merged that
                    // type in). After `if (!x) <early-exit>`, x is provably non-null on the
                    // fall-through path, so narrow to UNKNOWN — its real type is unknown to us,
                    // but it is NOT null here. This suppresses the false provably-null
                    // member-access error (UC5005).
                    //
                    // SOUNDNESS GATE: only when there is NO reassignment of x between the guard
                    // and the use. `if (!x) return; x = null; x.foo` must still flag — the
                    // guard is stale there. (The flow engine doesn't reliably track a
                    // module-level/closure reassignment, so we check the AST directly rather
                    // than rely on it.)
                    guards.push({ variableName, narrowToType: UcodeType.UNKNOWN, isNegative: false });
                  }
                }
              }
              // Detect type-equality aliases for transitive narrowing:
              // if (t != type(variableName)) return; where t = type(otherVar)
              // After return, type(otherVar) == type(variableName)
              const alias = this.detectTypeEqualityAlias(sibIf.test);
              if (alias) {
                if (alias.var1 === variableName && !this.transitiveTypeAliases.includes(alias.var2)) {
                  this.transitiveTypeAliases.push(alias.var2);
                } else if (alias.var2 === variableName && !this.transitiveTypeAliases.includes(alias.var1)) {
                  this.transitiveTypeAliases.push(alias.var1);
                }
              }
            }
          }
        }
        // If entering a function scope where the variable is shadowed by a local
        // declaration or parameter, outer guards don't apply to the inner variable.
        const isFuncScope = child.type === 'FunctionDeclaration' ||
                            child.type === 'FunctionExpression' ||
                            child.type === 'ArrowFunctionExpression';
        if (isFuncScope && this.isShadowedInFunction(child, variableName)) {
          guards.length = 0;
        }
        this.collectGuards(child, variableName, position, guards);
        return;
      }
    }
  }

  /**
   * Check if a variable name is redeclared (shadowed) inside a function node
   * as either a parameter or a local let/const/var declaration.
   */
  private isShadowedInFunction(funcNode: AstNode, variableName: string): boolean {
    // Dotted paths (e.g., pkg.prop) can't be directly shadowed by declarations
    if (variableName.includes('.')) return false;

    // Check parameters
    const params = (funcNode as any).params || [];
    for (const param of params) {
      if (param.type === 'Identifier' && (param as IdentifierNode).name === variableName) {
        return true;
      }
    }
    // Check top-level body for variable declarations
    const body = (funcNode as any).body;
    if (body && body.type === 'BlockStatement') {
      for (const stmt of (body as BlockStatementNode).body) {
        if (stmt.type === 'VariableDeclaration') {
          for (const decl of (stmt as VariableDeclarationNode).declarations) {
            if (decl.id?.type === 'Identifier' && (decl.id as IdentifierNode).name === variableName) {
              return true;
            }
          }
        }
      }
    }
    return false;
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

  /** If `node` is a call to an fs string-contract function (stat/readfile/open/…),
   *  return the argument node whose string-ness a truthy result proves. Resolves
   *  both `fs.stat(x)` (member on an fs-typed object) and a local alias
   *  `let stat = fs.stat; stat(x)` (identifier whose symbol resolves to fs.<fn>),
   *  and gates on the callee actually being an fs function — so a user's own
   *  `stat()` is never matched. Returns null otherwise. */
  private getStringContractArg(node: AstNode): { arg: AstNode } | null {
    if (node.type !== 'CallExpression') return null;
    const call = node as CallExpressionNode;

    // Position-aware lookup (keyed off the call's offset) so LOCAL aliases like
    // `let stat = _fs.stat;` inside a function body resolve — a plain lookup() runs
    // after scope exit and misses them.
    const lookupSym = (name: string) =>
      this.symbolTable.lookupAtPosition(name, call.start) ?? this.symbolTable.lookup(name);

    let argIndex: number | undefined;
    if (call.callee.type === 'Identifier') {
      const name = (call.callee as IdentifierNode).name;
      const sym = lookupSym(name);
      if (sym?.importedFrom === 'fs') {
        // fs function reached via import or a `let stat = fs.stat` alias.
        argIndex = STRING_CONTRACT_FS_BUILTINS[sym.importSpecifier ?? name];
      } else if ((!sym || sym.type === SymbolType.BUILTIN) && !this.symbolTable.shadowedBuiltins.has(name)) {
        // Global builtin (`match(x)`, `split(x)`). The symbol table seeds builtins
        // into global scope, so the resolved symbol is BUILTIN. A user that shadows
        // it (`function match(){…}` — allowed in ucode) is excluded via the
        // shadowedBuiltins set (a param shadow already resolves to a non-BUILTIN).
        argIndex = STRING_CONTRACT_GLOBAL_BUILTINS[name];
      }
    } else if (call.callee.type === 'MemberExpression') {
      const m = call.callee as MemberExpressionNode;
      if (m.object.type === 'Identifier' && m.property.type === 'Identifier') {
        const objSym = lookupSym((m.object as IdentifierNode).name);
        const isFsObject = objSym?.importedFrom === 'fs'
          || extractModuleType(objSym?.dataType as UcodeDataType)?.moduleName === 'fs';
        if (isFsObject) argIndex = STRING_CONTRACT_FS_BUILTINS[(m.property as IdentifierNode).name];
      }
    }
    if (argIndex === undefined) return null;
    const arg = call.arguments[argIndex];
    return arg ? { arg } : null;
  }

  /** For an early-exit guard `if (<test>) return;`, the code after it is reachable
   *  only when `<test>` is FALSE. `!(A || B || …)` ⟹ every disjunct is false, so a
   *  disjunct of the form `!stat(path)` means `stat(path)` is truthy in the
   *  fall-through, which proves `path` is a string. Push that positive guard. */
  private collectNegatedStringContractGuards(test: AstNode, variableName: string, guards: TypeGuardInfo[]): void {
    const disjuncts: AstNode[] = [];
    const split = (n: AstNode): void => {
      if (n.type === 'BinaryExpression' && (n as BinaryExpressionNode).operator === '||') {
        split((n as BinaryExpressionNode).left);
        split((n as BinaryExpressionNode).right);
      } else {
        disjuncts.push(n);
      }
    };
    split(test);
    for (const d of disjuncts) {
      if (d.type === 'UnaryExpression' && (d as any).operator === '!') {
        const sc = this.getStringContractArg((d as any).argument);
        if (sc && this.getArgVariableName(sc.arg) === variableName) {
          guards.push({ variableName, narrowToType: UcodeType.STRING, isNegative: false });
        }
      }
    }
  }

  private comparisonExcludesNull(operator: string, literalValue: string | number | boolean | null, callOnLeft: boolean): boolean {
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

  /**
   * Extract a variable-to-variable equality guard.
   * For `if (x != y) return;`, after the early exit x is narrowed to y's type.
   */
  private extractVariableEqualityGuard(
    binaryExpr: BinaryExpressionNode,
    variableName: string,
    isEquality: boolean
  ): TypeGuardInfo | null {
    let otherVarName: string | null = null;

    // Check: variableName on left, other identifier on right
    if (binaryExpr.left.type === 'Identifier' &&
        (binaryExpr.left as IdentifierNode).name === variableName &&
        binaryExpr.right.type === 'Identifier') {
      otherVarName = (binaryExpr.right as IdentifierNode).name;
    }
    // Check: variableName on right, other identifier on left
    else if (binaryExpr.right.type === 'Identifier' &&
             (binaryExpr.right as IdentifierNode).name === variableName &&
             binaryExpr.left.type === 'Identifier') {
      otherVarName = (binaryExpr.left as IdentifierNode).name;
    }

    if (!otherVarName) return null;

    // Look up the other variable's symbol — try regular lookup first, then position-aware
    // (imports/outer-scope variables may not be in the current scope after analysis)
    const otherNode = (binaryExpr.left.type === 'Identifier' &&
      (binaryExpr.left as IdentifierNode).name === otherVarName)
      ? binaryExpr.left : binaryExpr.right;
    let otherSymbol = this.symbolTable.lookup(otherVarName);
    if (!otherSymbol) {
      otherSymbol = this.symbolTable.lookupAtPosition(otherVarName, otherNode.start);
    }
    if (!otherSymbol) return null;

    // Use the EFFECTIVE type at the comparison (SSA currentType) — a
    // declare-then-assign other variable (`let y; y = f();`) has declared type
    // `null` but an effective type of whatever was assigned.
    const otherType = this.getEffectiveSymbolDataType(otherSymbol, otherNode.start);
    // Only narrow if the other variable has a known type
    if (otherType === UcodeType.UNKNOWN) return null;

    return {
      variableName,
      narrowToType: null,
      isNegative: !isEquality, // == → positive (narrow to type), != → negative (flip by collectGuards)
      equalityNarrowType: otherType,
      equalitySymbol: otherSymbol
    };
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
          // Get the variable's original type at the guard — position-aware lookup
          // and EFFECTIVE type (SSA currentType), so a declare-then-assign variable
          // (`let x; x = f();`, declared `null`) narrows from its assigned type.
          const symbol = this.symbolTable.lookup(variableName)
            ?? this.symbolTable.lookupAtPosition(variableName, binaryExpr.start);
          if (!symbol) {
            return null;
          }

          const originalType = this.getEffectiveSymbolDataType(symbol, binaryExpr.start);
          let originalTypes = getUnionTypes(originalType);

          // For UNKNOWN type with all-positive OR guards, narrow to the union of guarded types
          // e.g., type(x) == "string" || type(x) == "array" → narrow to string | array
          if (originalType === UcodeType.UNKNOWN && allGuards.every(g => !g.isNegative && g.narrowToType)) {
            const types = allGuards.map(g => g.narrowToType).filter((t): t is UcodeType => t !== null);
            if (types.length >= 2) {
              return {
                variableName,
                narrowToType: createUnionType(types) as UcodeType,
                isNegative: false,
                isCombinedOr: true
              };
            }
          }

          // For OR guards: a type satisfies the condition if it satisfies ANY guard.
          // Compare the member's BASE type — a union member may be a refined form
          // (e.g. ArrayType `array<integer>`) while narrowToType is the bare enum.
          const satisfyingTypes = originalTypes.filter(type => {
            const base = singleTypeToBase(type);
            return allGuards.some(guard => {
              if (!guard.narrowToType) {
                return false;
              }

              if (guard.isNegative) {
                // Negative guard: type satisfies if it's NOT the guarded type
                return base !== guard.narrowToType;
              } else {
                // Positive guard: type satisfies if it IS the guarded type
                return base === guard.narrowToType;
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
              return !originalTypes.some(t => singleTypeToBase(t) === guard.narrowToType);
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
            return originalTypes.some(t => singleTypeToBase(t) === guard.narrowToType);
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
            return { variableName, narrowToType: UcodeType.NULL, isNegative: true, isNullPropagation: true };
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
            return { variableName, narrowToType: UcodeType.NULL, isNegative: true, isNullPropagation: true };
          }
        }
      }
    }

    // Variable-to-variable equality: if (x == y) or if (x != y)
    // When one side is variableName and the other is a variable with known type,
    // narrow variableName to the other variable's type
    if (condition.type === 'BinaryExpression') {
      const binaryExpr = condition as BinaryExpressionNode;
      if (binaryExpr.operator === '==' || binaryExpr.operator === '===' ||
          binaryExpr.operator === '!=' || binaryExpr.operator === '!==') {
        const isEquality = binaryExpr.operator === '==' || binaryExpr.operator === '===';
        const guard = this.extractVariableEqualityGuard(binaryExpr, variableName, isEquality);
        if (guard) return guard;
      }
    }

    // Numeric comparison narrowing: variable <op> numericLiteral or numericLiteral <op> variable
    // e.g., if (cpu < 0) narrows cpu to integer | double in the true branch
    if (condition.type === 'BinaryExpression') {
      const binaryExpr = condition as BinaryExpressionNode;
      if (binaryExpr.operator === '<' || binaryExpr.operator === '>' ||
          binaryExpr.operator === '<=' || binaryExpr.operator === '>=') {
        let matchedName: string | null = null;
        if (binaryExpr.left.type === 'Identifier' && binaryExpr.right.type === 'Literal' &&
            typeof (binaryExpr.right as any).value === 'number') {
          matchedName = (binaryExpr.left as any).name;
        } else if (binaryExpr.right.type === 'Identifier' && binaryExpr.left.type === 'Literal' &&
                   typeof (binaryExpr.left as any).value === 'number') {
          matchedName = (binaryExpr.right as any).name;
        }
        if (matchedName === variableName) {
          return {
            variableName,
            narrowToType: null,
            isNegative: false,
            equalityNarrowType: createUnionType([UcodeType.INTEGER, UcodeType.DOUBLE])
          };
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
  /**
   * Get a dotted path string from a node (Identifier or MemberExpression).
   * Returns null for computed properties or non-static expressions.
   * e.g., `state.errors` → "state.errors", `x` → "x"
   */
  private getDottedPath(node: AstNode): string | null {
    if (node.type === 'Identifier') {
      return (node as IdentifierNode).name;
    }
    if (node.type === 'MemberExpression') {
      const member = node as MemberExpressionNode;
      const objPath = this.getDottedPath(member.object);
      if (!objPath) return null;
      if (member.computed) {
        // A CONSTANT index (`parts[5]`, `obj["k"]`) is a stable path, so guards on
        // it (e.g. `parts[5] ? uc(parts[5]) : null`) can be tracked. A variable
        // index (`parts[i]`) can change between guard and use → not trackable.
        if (member.property.type === 'Literal') {
          const v = (member.property as LiteralNode).value;
          if (typeof v === 'number' || typeof v === 'string') {
            return `${objPath}[${JSON.stringify(v)}]`;
          }
        }
        return null;
      }
      if (member.property.type === 'Identifier') {
        return `${objPath}.${(member.property as IdentifierNode).name}`;
      }
      return null;
    }
    return null;
  }

  /**
   * Decompose an AND chain into individual type guards.
   * e.g., type(x) != "string" && type(x) != "array" → [neg-string, neg-array]
   */
  private extractAndChainGuards(condition: AstNode, variableName: string): TypeGuardInfo[] {
    if (condition.type !== 'BinaryExpression') {
      const single = this.extractTypeGuard(condition, variableName);
      return single ? [single] : [];
    }
    const bin = condition as BinaryExpressionNode;
    if (bin.operator === '&&') {
      const left = this.extractAndChainGuards(bin.left, variableName);
      const right = this.extractAndChainGuards(bin.right, variableName);
      return [...left, ...right];
    }
    const single = this.extractTypeGuard(condition, variableName);
    return single ? [single] : [];
  }

  /**
   * Decompose an OR chain into individual type guards.
   * e.g., type(x) != "string" || !x → [neg-string] (non-guard branches are skipped)
   * Used in early-return context where each OR branch is independently negated.
   */
  private extractOrChainGuards(condition: AstNode, variableName: string): TypeGuardInfo[] {
    if (condition.type !== 'BinaryExpression') {
      const single = this.extractTypeGuard(condition, variableName);
      return single ? [single] : [];
    }
    const bin = condition as BinaryExpressionNode;
    if (bin.operator === '||') {
      const left = this.extractOrChainGuards(bin.left, variableName);
      const right = this.extractOrChainGuards(bin.right, variableName);
      return [...left, ...right];
    }
    const single = this.extractTypeGuard(condition, variableName);
    return single ? [single] : [];
  }

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
    let typeLiteral: LiteralNode | null = null;

    // Check left side for type() call, right side for string literal
    if (binaryExpr.left.type === 'CallExpression' &&
        binaryExpr.right.type === 'Literal') {
      typeCall = binaryExpr.left as CallExpressionNode;
      typeLiteral = binaryExpr.right as LiteralNode;
    }
    // Check right side for type() call, left side for string literal
    else if (binaryExpr.right.type === 'CallExpression' &&
             binaryExpr.left.type === 'Literal') {
      typeCall = binaryExpr.right as CallExpressionNode;
      typeLiteral = binaryExpr.left as LiteralNode;
    }

    // Indirect pattern: t == "object" where t = type(variable)
    let resolvedIndirect = false;
    if (!typeCall || !typeLiteral) {
      const resolved = this.resolveIndirectTypeCall(binaryExpr, variableName);
      if (resolved) {
        typeCall = resolved.typeCall;
        typeLiteral = resolved.typeLiteral;
        resolvedIndirect = true;
      }
    }

    if (!typeCall || !typeLiteral) {
      return null;
    }

    // Verify it's a call to type() function
    if (typeCall.callee.type !== 'Identifier' ||
        (typeCall.callee as IdentifierNode).name !== 'type') {
      return null;
    }

    // Verify it has one argument matching our variable name (supports dotted paths like "state.errors")
    // Skip this check for indirect resolution which already verified the match (possibly transitively)
    if (!resolvedIndirect) {
      if (typeCall.arguments.length !== 1 || !typeCall.arguments[0]) {
        return null;
      }
      const argPath = this.getDottedPath(typeCall.arguments[0]);
      if (argPath !== variableName) {
        return null;
      }
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
      case 'regex':
      case 'regexp':
        return UcodeType.REGEX;
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
    let typeLiteral: LiteralNode | null = null;

    // Check left side for type() call, right side for string literal
    if (binaryExpr.left.type === 'CallExpression' &&
        binaryExpr.right.type === 'Literal') {
      typeCall = binaryExpr.left as CallExpressionNode;
      typeLiteral = binaryExpr.right as LiteralNode;
    }
    // Check right side for type() call, left side for string literal
    else if (binaryExpr.right.type === 'CallExpression' &&
             binaryExpr.left.type === 'Literal') {
      typeCall = binaryExpr.right as CallExpressionNode;
      typeLiteral = binaryExpr.left as LiteralNode;
    }

    // Indirect pattern: t != "object" where t = type(variable)
    let resolvedIndirect = false;
    if (!typeCall || !typeLiteral) {
      const resolved = this.resolveIndirectTypeCall(binaryExpr, variableName);
      if (resolved) {
        typeCall = resolved.typeCall;
        typeLiteral = resolved.typeLiteral;
        resolvedIndirect = true;
      }
    }

    if (!typeCall || !typeLiteral) {
      return null;
    }

    // Verify it's a call to type() function
    if (typeCall.callee.type !== 'Identifier' ||
        (typeCall.callee as IdentifierNode).name !== 'type') {
      return null;
    }

    // Verify it has one argument matching our variable name (supports dotted paths like "state.errors")
    // Skip this check for indirect resolution which already verified the match (possibly transitively)
    if (!resolvedIndirect) {
      if (typeCall.arguments.length !== 1 || !typeCall.arguments[0]) {
        return null;
      }
      const argPath = this.getDottedPath(typeCall.arguments[0]);
      if (argPath !== variableName) {
        return null;
      }
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
      case 'regex':
      case 'regexp':
        return UcodeType.REGEX;
      default:
        return null;
    }
  }

  /**
   * Resolve indirect type() call pattern: t == "object" where t = type(variable)
   * Returns the original type() call and the literal if the pattern matches.
   */
  private resolveIndirectTypeCall(
    binaryExpr: BinaryExpressionNode,
    variableName: string
  ): { typeCall: CallExpressionNode; typeLiteral: LiteralNode } | null {
    let identNode: IdentifierNode | null = null;
    let literalNode: LiteralNode | null = null;

    if (binaryExpr.left.type === 'Identifier' && binaryExpr.right.type === 'Literal') {
      identNode = binaryExpr.left as IdentifierNode;
      literalNode = binaryExpr.right as LiteralNode;
    } else if (binaryExpr.right.type === 'Identifier' && binaryExpr.left.type === 'Literal') {
      identNode = binaryExpr.right as IdentifierNode;
      literalNode = binaryExpr.left as LiteralNode;
    }

    if (!identNode || !literalNode || typeof literalNode.value !== 'string') {
      return null;
    }

    // Use position-aware lookup since the variable may be in an exited scope (e.g., export function)
    const sym = this.symbolTable.lookupAtPosition(identNode.name, identNode.start)
             || this.symbolTable.lookup(identNode.name);
    if (!sym?.initNode || sym.initNode.type !== 'CallExpression') {
      return null;
    }

    const initCall = sym.initNode as CallExpressionNode;
    if (initCall.callee.type !== 'Identifier' ||
        (initCall.callee as IdentifierNode).name !== 'type' ||
        initCall.arguments.length !== 1 || !initCall.arguments[0]) {
      return null;
    }

    const argPath = this.getDottedPath(initCall.arguments[0]);
    if (!argPath) {
      return null;
    }
    if (argPath !== variableName) {
      // Check transitive type-equality aliases: if variableName is aliased to argPath
      if (!this.transitiveTypeAliases.includes(argPath)) {
        return null;
      }
    }

    return { typeCall: initCall, typeLiteral: literalNode };
  }

  /**
   * Get the variable name from a type() call (direct or indirect via identifier).
   * For CallExpression: type(x) → "x"
   * For Identifier: t where t = type(x) → "x"
   */
  private getTypeCallVariable(node: AstNode): string | null {
    if (node.type === 'CallExpression') {
      const call = node as CallExpressionNode;
      if (call.callee.type === 'Identifier' &&
          (call.callee as IdentifierNode).name === 'type' &&
          call.arguments.length === 1 && call.arguments[0]) {
        return this.getDottedPath(call.arguments[0]);
      }
    } else if (node.type === 'Identifier') {
      const ident = node as IdentifierNode;
      const sym = this.symbolTable.lookupAtPosition(ident.name, ident.start)
               || this.symbolTable.lookup(ident.name);
      if (sym?.initNode?.type === 'CallExpression') {
        const initCall = sym.initNode as CallExpressionNode;
        if (initCall.callee.type === 'Identifier' &&
            (initCall.callee as IdentifierNode).name === 'type' &&
            initCall.arguments.length === 1 && initCall.arguments[0]) {
          return this.getDottedPath(initCall.arguments[0]);
        }
      }
    }
    return null;
  }

  /**
   * Detect type-equality alias from a != condition: t != type(var2) where t = type(var1)
   * Returns the two variables whose types are being compared, or null.
   */
  private detectTypeEqualityAlias(condition: AstNode): { var1: string, var2: string } | null {
    if (condition.type !== 'BinaryExpression') return null;
    const bin = condition as BinaryExpressionNode;
    if (bin.operator !== '!=' && bin.operator !== '!==') return null;

    const leftVar = this.getTypeCallVariable(bin.left);
    const rightVar = this.getTypeCallVariable(bin.right);

    if (leftVar && rightVar && leftVar !== rightVar) {
      return { var1: leftVar, var2: rightVar };
    }
    return null;
  }

  /**
   * Get child nodes of an AST node for traversal
   */
  private getChildNodes(node: AstNode): AstNode[] {
    const children: AstNode[] = [];

    switch (node.type) {
      // Container nodes
      case 'Program':
        children.push(...(node as ProgramNode).body);
        break;
      case 'BlockStatement':
        children.push(...(node as BlockStatementNode).body);
        break;

      // Statements
      case 'ExpressionStatement':
        children.push((node as ExpressionStatementNode).expression);
        break;
      case 'VariableDeclaration':
        for (const declarator of (node as VariableDeclarationNode).declarations) {
          children.push(declarator);
        }
        break;
      case 'VariableDeclarator': {
        const decl = node as VariableDeclaratorNode;
        children.push(decl.id);
        if (decl.init) children.push(decl.init);
        break;
      }
      case 'IfStatement': {
        const ifNode = node as IfStatementNode;
        children.push(ifNode.test, ifNode.consequent);
        if (ifNode.alternate) children.push(ifNode.alternate);
        break;
      }
      case 'ForStatement': {
        const forNode = node as ForStatementNode;
        if (forNode.init) children.push(forNode.init);
        if (forNode.test) children.push(forNode.test);
        if (forNode.update) children.push(forNode.update);
        children.push(forNode.body);
        break;
      }
      case 'ForInStatement': {
        const fin = node as ForInStatementNode;
        children.push(fin.left, fin.right, fin.body);
        break;
      }
      case 'WhileStatement': {
        const wh = node as WhileStatementNode;
        children.push(wh.test, wh.body);
        break;
      }
      case 'DoWhileStatement': {
        const dw = node as any;
        children.push(dw.body, dw.test);
        break;
      }
      case 'ReturnStatement': {
        const ret = node as ReturnStatementNode;
        if (ret.argument) children.push(ret.argument);
        break;
      }
      case 'ThrowStatement': {
        const thr = node as ThrowStatementNode;
        if (thr.argument) children.push(thr.argument);
        break;
      }
      case 'BreakStatement':
      case 'ContinueStatement':
      case 'EmptyStatement':
        // Leaf statements — no children
        break;
      case 'LabeledStatement': {
        const lbl = node as LabeledStatementNode;
        children.push(lbl.body);
        break;
      }
      case 'SwitchStatement': {
        const sw = node as SwitchStatementNode;
        children.push(sw.discriminant);
        if (sw.cases) {
          for (const c of sw.cases) {
            if (c.test) children.push(c.test);
            children.push(...c.consequent);
          }
        }
        break;
      }
      case 'SwitchCase':
        // Handled inline by SwitchStatement above; if reached standalone:
        break;
      case 'TryStatement': {
        const tr = node as TryStatementNode;
        children.push(tr.block);
        if (tr.handler) children.push(tr.handler);
        break;
      }
      case 'CatchClause': {
        const cc = node as CatchClauseNode;
        children.push(cc.body);
        break;
      }

      // Functions
      case 'FunctionDeclaration': {
        const fd = node as FunctionDeclarationNode;
        children.push(fd.id, ...fd.params, fd.body);
        break;
      }
      case 'FunctionExpression': {
        const fe = node as FunctionExpressionNode;
        if (fe.id) children.push(fe.id);
        children.push(...fe.params, fe.body);
        break;
      }
      case 'ArrowFunctionExpression': {
        const ae = node as ArrowFunctionExpressionNode;
        children.push(...ae.params);
        if (ae.body && typeof ae.body === 'object') {
          children.push(ae.body as AstNode);
        }
        break;
      }

      // Expressions
      case 'BinaryExpression': {
        const bin = node as BinaryExpressionNode;
        children.push(bin.left, bin.right);
        break;
      }
      case 'LogicalExpression': {
        const log = node as LogicalExpressionNode;
        children.push(log.left, log.right);
        break;
      }
      case 'UnaryExpression': {
        const un = node as UnaryExpressionNode;
        children.push(un.argument);
        break;
      }
      case 'AssignmentExpression': {
        const asg = node as AssignmentExpressionNode;
        children.push(asg.left, asg.right);
        break;
      }
      case 'ConditionalExpression': {
        const cond = node as ConditionalExpressionNode;
        children.push(cond.test, cond.consequent, cond.alternate);
        break;
      }
      case 'CallExpression': {
        const call = node as CallExpressionNode;
        children.push(call.callee);
        children.push(...call.arguments.filter(arg => arg != null));
        break;
      }
      case 'MemberExpression': {
        const mem = node as MemberExpressionNode;
        children.push(mem.object, mem.property);
        break;
      }
      case 'DeleteExpression': {
        const del = node as DeleteExpressionNode;
        children.push(del.argument);
        break;
      }
      case 'SpreadElement': {
        const spr = node as SpreadElementNode;
        children.push(spr.argument);
        break;
      }

      // Literals and atoms
      case 'ObjectExpression':
        for (const prop of (node as ObjectExpressionNode).properties) {
          children.push(prop);
        }
        break;
      case 'Property': {
        const prop = node as PropertyNode;
        if (prop.key) children.push(prop.key);
        if (prop.value) children.push(prop.value);
        break;
      }
      case 'ArrayExpression':
        children.push(...(node as ArrayExpressionNode).elements.filter(el => el != null));
        break;
      case 'TemplateLiteral': {
        const tl = node as TemplateLiteralNode;
        for (const expr of tl.expressions) children.push(expr);
        break;
      }
      case 'TemplateElement':
      case 'Literal':
      case 'Identifier':
      case 'ThisExpression':
      case 'JsDocComment':
        // Leaf nodes — no children to traverse
        break;

      // Imports/exports
      case 'ImportDeclaration': {
        const imp = node as ImportDeclarationNode;
        children.push(...imp.specifiers);
        break;
      }
      case 'ImportSpecifier':
      case 'ImportDefaultSpecifier':
      case 'ImportNamespaceSpecifier':
      case 'ExportSpecifier':
        // Leaf specifier nodes
        break;
      case 'ExportDefaultDeclaration': {
        const ed = node as ExportDefaultDeclarationNode;
        if (ed.declaration) children.push(ed.declaration);
        break;
      }
      case 'ExportNamedDeclaration': {
        const en = node as ExportNamedDeclarationNode;
        if (en.declaration) children.push(en.declaration);
        break;
      }
      case 'ExportAllDeclaration':
        break;

      default: {
        // Exhaustive check — if this errors, a new AstNodeKind was added without a case here
        const _exhaustive: never = node.type;
        void _exhaustive;
        break;
      }
    }

    return children.filter(child => child != null);
  }

}
