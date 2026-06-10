/**
 * Symbol Table for ucode semantic analysis
 * Manages variable scoping and symbol resolution
 */

import { AstNode, IdentifierNode } from '../ast/nodes';
import { Match } from 'effect';

export enum SymbolType {
  VARIABLE = 'variable',
  FUNCTION = 'function',
  PARAMETER = 'parameter',
  BUILTIN = 'builtin',
  IMPORTED = 'imported',
  MODULE = 'module'
}

export enum UcodeType {
  INTEGER = 'integer',
  DOUBLE = 'double', 
  STRING = 'string',
  BOOLEAN = 'boolean',
  ARRAY = 'array',
  OBJECT = 'object',
  FUNCTION = 'function',
  REGEX = 'regex',
  NULL = 'null',
  UNKNOWN = 'unknown',
  UNION = 'union'
}

/** A known object type like fs.file, uci.cursor, io.handle, etc. */
export interface ObjectType {
  type: 'objectKind';
  name: string;
}

/** A concrete (non-union) type — can appear as a union member */
export type SingleType = UcodeType | ObjectType | ArrayType;

export interface UnionType {
  type: UcodeType.UNION;
  types: SingleType[];
}

export interface ModuleType {
  type: UcodeType.OBJECT;
  moduleName: string;
}

export interface DefaultImportType {
  type: UcodeType.OBJECT;
  isDefaultImport: boolean;
}

export interface ArrayType {
  type: UcodeType.ARRAY;
  elementType: UcodeDataType;
}

export type UcodeDataType = UcodeType | UnionType | ModuleType | DefaultImportType | ArrayType | ObjectType;

// --- ObjectType helpers ---

export function isObjectType(type: UcodeDataType): type is ObjectType {
  return typeof type === 'object' && type !== null && (type as any).type === 'objectKind';
}

export function getObjectTypeName(type: UcodeDataType): string | null {
  if (isObjectType(type)) return type.name;
  return null;
}

// --- ModuleType helpers ---

/**
 * Extract a ModuleType from a UcodeDataType.
 * Handles both bare ModuleType and UnionType containing a ModuleType (e.g., io.handle | null).
 * Returns null if no ModuleType is found.
 */
export function extractModuleType(dataType: UcodeDataType | undefined | null): ModuleType | null {
  if (!dataType || typeof dataType !== 'object') return null;

  // Direct ModuleType: { type: 'object', moduleName: string }
  if ('moduleName' in dataType && (dataType as any).type === UcodeType.OBJECT) {
    return dataType as ModuleType;
  }

  // UnionType containing a ModuleType (e.g., io.handle | null)
  if (isUnionType(dataType)) {
    for (const member of dataType.types) {
      if (typeof member === 'object' && 'moduleName' in member) {
        return member as unknown as ModuleType;
      }
    }
  }

  return null;
}

/** Convert a SingleType to the base UcodeType (for comparisons, type narrowing) */
export const singleTypeToBase: (t: SingleType) => UcodeType = Match.type<SingleType>().pipe(
  Match.when(Match.string, (s) => s as UcodeType),
  Match.when({ type: 'objectKind' as const }, () => UcodeType.OBJECT),
  Match.when({ type: UcodeType.ARRAY }, () => UcodeType.ARRAY),
  Match.orElse((t) => {
    // ModuleType: { type: 'object', moduleName: string }
    if (typeof t === 'object' && t !== null && 'moduleName' in t) {
      return UcodeType.OBJECT;
    }
    return UcodeType.UNKNOWN;
  })
);

// --- Union type utilities ---

export function createUnionType(types: SingleType[]): UcodeDataType {
  // Deduplicate: use string representation for comparison
  const seen = new Set<string>();
  const uniqueTypes: SingleType[] = [];
  for (const t of types) {
    const key = singleTypeKey(t);
    if (!seen.has(key)) {
      seen.add(key);
      uniqueTypes.push(t);
    }
  }

  if (uniqueTypes.length === 0) {
    return UcodeType.UNKNOWN;
  }

  if (uniqueTypes.length === 1) {
    return uniqueTypes[0] as UcodeDataType;
  }

  return {
    type: UcodeType.UNION,
    types: uniqueTypes
  };
}

/** String key for deduplication */
function singleTypeKey(t: SingleType): string {
  if (typeof t === 'string') return t;
  if (isObjectType(t)) return `objectKind:${t.name}`;
  if (isArrayType(t)) return `array:${JSON.stringify(t.elementType)}`;
  return 'unknown';
}

export function isUnionType(type: UcodeDataType): type is UnionType {
  return typeof type === 'object' && (type as any).type === UcodeType.UNION;
}

export function getUnionTypes(type: UcodeDataType): SingleType[] {
  if (isUnionType(type)) {
    return type.types;
  }
  // ArrayType and ObjectType are single refined types
  if (isArrayType(type)) {
    return [type];
  }
  if (isObjectType(type)) {
    return [type];
  }
  return [type as UcodeType];
}

export function isArrayType(type: UcodeDataType): type is ArrayType {
  return typeof type === 'object' && type !== null && (type as any).type === UcodeType.ARRAY && 'elementType' in type;
}

export function createArrayType(elementType: UcodeDataType): ArrayType {
  return { type: UcodeType.ARRAY, elementType };
}

export function getArrayElementType(type: UcodeDataType): UcodeDataType {
  if (isArrayType(type)) return type.elementType;
  return UcodeType.UNKNOWN;
}

/**
 * Collapse any UcodeDataType (including the rich CheckResult shapes) down to a
 * single base UcodeType enum. This is the explicit, blessed way to consume a
 * rich type when you only care about its base kind — `result === UcodeType.X`
 * is WRONG on a rich result (an ArrayType object is never === 'array'), so use
 * `dataTypeToBase(result) === UcodeType.X` instead.
 *
 * Unions collapse to UNKNOWN (no single base); arrays → ARRAY; object shapes
 * and module types → OBJECT; bare enums pass through.
 */
export function dataTypeToBase(type: UcodeDataType): UcodeType {
  if (typeof type === 'string') return type as UcodeType;
  if (isArrayType(type)) return UcodeType.ARRAY;
  if (isObjectType(type)) return UcodeType.OBJECT;
  if (isUnionType(type)) return UcodeType.UNKNOWN;
  if (extractModuleType(type)) return UcodeType.OBJECT;
  const t = (type as any).type;
  return typeof t === 'string' ? (t as UcodeType) : UcodeType.UNKNOWN;
}

/** The effective type of a symbol at a source position: the SSA-tracked
 *  `currentType` when it is active at the position (i.e. after the assignment
 *  that set it), otherwise the declared `dataType`. This is THE single source for
 *  "what type does this variable hold here" that the narrowing machinery builds
 *  on — declared-vs-current divergence here was the root of several narrowing
 *  bugs (a `let c; c = f();` has declared type null but an effective string|null). */
export function effectiveSymbolType(symbol: Symbol, position: number): UcodeDataType {
  if (symbol.currentType !== undefined && symbol.currentTypeEffectiveFrom !== undefined
      && position >= symbol.currentTypeEffectiveFrom) {
    return symbol.currentType;
  }
  return symbol.dataType;
}

/** Convert a SingleType to its display string */
export const singleTypeToString: (t: SingleType) => string = Match.type<SingleType>().pipe(
  Match.when(Match.string, (s) => s),
  Match.when({ type: 'objectKind' as const }, (o) => o.name),
  Match.when({ type: UcodeType.ARRAY }, (a) => `array<${typeToString(a.elementType)}>`),
  Match.orElse((t) => {
    // ModuleType: { type: 'object', moduleName: string } — appears as union member
    // when type checker creates e.g. io.handle | null
    if (typeof t === 'object' && t !== null && 'moduleName' in t) {
      return (t as any).moduleName as string;
    }
    return 'unknown';
  })
);

export function typeToString(type: UcodeDataType): string {
  if (isUnionType(type)) {
    return type.types.map(singleTypeToString).join(' | ');
  }

  if (isObjectType(type)) {
    return type.name;
  }

  if (isArrayType(type)) {
    return `array<${typeToString(type.elementType)}>`;
  }

  // Handle object types (ModuleType, DefaultImportType, etc.)
  if (typeof type === 'object') {
    // ModuleType — only bare ModuleType reaches here (unions caught above)
    if ('moduleName' in type) {
      const moduleType = type as ModuleType;
      // For actual fs objects, return the specific type (fs.file, fs.dir, fs.proc)
      if (moduleType.moduleName.startsWith('fs.') || moduleType.moduleName.startsWith('uci.') || moduleType.moduleName.startsWith('io.')) {
        return moduleType.moduleName;
      }
      // For module references, return a more descriptive format
      return `${moduleType.moduleName} module`;
    }

    // DefaultImportType
    if ('isDefaultImport' in type) {
      return 'object'; // Default imports are objects
    }

    // Generic object with 'type' property - return the type value
    // Cast to any to avoid TypeScript narrowing issues
    const objType = type as any;
    if ('type' in objType && typeof objType.type === 'string') {
      return objType.type; // e.g., 'object', 'array', etc.
    }
  }

  // Plain UcodeType enum value (string)
  return type as string;
}

export function isTypeCompatible(actual: UcodeDataType, expected: UcodeDataType): boolean {
  // ArrayType is compatible with UcodeType.ARRAY and vice versa
  if (isArrayType(actual) && (expected === UcodeType.ARRAY || isArrayType(expected))) return true;
  if (isArrayType(expected) && actual === UcodeType.ARRAY) return true;

  const actualTypes = getUnionTypes(actual);
  const expectedTypes = getUnionTypes(expected);

  // Check if any actual type is compatible with any expected type
  return actualTypes.some(actualType =>
    expectedTypes.some(expectedType =>
      actualType === expectedType ||
      expectedType === UcodeType.UNKNOWN ||
      actualType === UcodeType.UNKNOWN ||
      // Allow integer to double conversion
      (actualType === UcodeType.INTEGER && expectedType === UcodeType.DOUBLE)
    )
  );
}

/** One parameter of a user function's signature, captured at declaration time
 *  for call-site argument checking. `type` is the declared/inferred type (JSDoc
 *  `@param {T}` or `unknown`); `isRest` marks a `...spread` parameter (variadic). */
export interface ParamInfo {
  name: string;
  type: UcodeDataType;
  isRest: boolean;
}

export interface Symbol {
  name: string;
  type: SymbolType;
  dataType: UcodeDataType;
  scope: number;
  declared: boolean;
  used: boolean;
  node: AstNode;
  declaredAt: number; // position in source
  usedAt: number[];   // positions where used
  // Function-specific fields
  returnType?: UcodeDataType;   // Return type for functions (when dataType is FUNCTION)
  parameters?: ParamInfo[];     // Ordered parameter signature for user functions (for call-site argument checking)
  // Import-specific fields
  importedFrom?: string;        // File path where this symbol is imported from
  importSpecifier?: string;     // Original name if aliased (e.g., 'run_command' for 'import { run_command as cmd }')
  definitionLocation?: {        // Location of the actual definition
    uri: string;
    range: { start: number; end: number };
  };
    propertyTypes?: Map<string, UcodeDataType>; // Known property types for object-like symbols (e.g., global)
    nestedPropertyTypes?: Map<string, Map<string, UcodeDataType>>; // Nested property types (propName → sub-property types)
    returnPropertyTypes?: Map<string, UcodeDataType>; // Property types of objects returned by this function
    valuePropertyTypes?: Map<string, UcodeDataType>; // For a dictionary-like object (Record<string,T>): the inferred shape of its VALUES, derived from computed assignments `O[k] = {…}` (directly or one setter hop). Copied to `propertyTypes` of `let v = O[k]` bindings.
    propertyFunctionReturnTypes?: Map<string, string>; // Return type hints for function-typed properties (e.g., "uci_ctx" -> "uci.cursor")
    propertyDefinitionLocations?: Map<string, { uri: string; start: number; end: number }>; // Cross-file source location of each member (e.g. factory-returned methods) for go-to-definition
    returnPropertyDefinitionLocations?: Map<string, { uri: string; start: number; end: number }>; // For a factory FUNCTION: source location of each member of its returned object. Copied to `propertyDefinitionLocations` of `let v = factory()` bindings so go-to-def on `v.member` lands in the factory's source.
    closedPropertyShape?: boolean; // True when propertyTypes is the COMPLETE set of members (object/typedef shapes) — enables "unknown member" diagnostics. NOT set for factory returns (intersection-merged, possibly incomplete).
    initNode?: AstNode; // Initial value node for SSA type protection
    initialLiteralType?: UcodeDataType | undefined; // Initial literal type, if declared with a literal
    currentType?: UcodeDataType | undefined; // Current type after assignments (for SSA)
    currentTypeEffectiveFrom?: number | undefined; // Source offset where currentType becomes active
    neverReturns?: boolean; // True if function always terminates (die/exit/throw on all paths)
    scopeEnd?: number; // End offset of the scope this symbol was declared in (set when scope exits)
    jsdocDescription?: string; // Description from @param JSDoc tag
    isRestParam?: boolean; // True if this parameter was declared with ...spread syntax
    isExceptionParam?: boolean; // True if this is a catch-clause parameter (exception object)
    /** When set, this variable's value is provably a key of the named object —
     *  i.e. it came from `keys(NAME)`, from iterating NAME via for-in, or was
     *  derived from such a value by an operation that preserves key existence
     *  (currently: passthrough only — `int(x)` etc. are NOT considered
     *  preserving). Used by checkMemberExpression to type `NAME[this]` as the
     *  union of NAME's property values rather than `unknown`. */
    keysOfSymbol?: string;
    /** Source offset before which this symbol should be invisible to
     *  identifier completion. Used for for-in iterator variables: declared
     *  parser-side at `for (k in …)` but conceptually only meaningful from
     *  the body onwards, so we don't offer `k` as a completion while the
     *  user is still typing the iterable expression. Hover/definition are
     *  unaffected — they still see the symbol normally. */
    visibleFrom?: number;
}

export class SymbolTable {
  private scopes: Map<string, Symbol>[] = [];
  private currentScope = 0;
  private globalScope: Map<string, Symbol> = new Map();
  // Keep track of all symbols ever declared (including in exited scopes) for position-based lookup
  private allSymbols: Symbol[] = [];
  // Builtin names a user re-declared at a scope where the builtin already lives (so
  // declare() rejected it and the builtin entry survives). ucode allows shadowing a
  // builtin with a user function, so consumers that special-case a builtin by name
  // (e.g. string-contract narrowing) must NOT treat these as the builtin.
  public readonly shadowedBuiltins: Set<string> = new Set();

  constructor() {
    // Initialize global scope
    this.scopes.push(this.globalScope);
    this.initializeBuiltins();
  }

  private initializeBuiltins(): void {
    // Add built-in functions from builtins.ts
    const builtins = [
      { name: 'print', returnType: UcodeType.INTEGER, params: [UcodeType.UNKNOWN] },
      { name: 'printf', returnType: UcodeType.INTEGER, params: [UcodeType.STRING, UcodeType.UNKNOWN] },
      { name: 'sprintf', returnType: UcodeType.STRING, params: [UcodeType.STRING, UcodeType.UNKNOWN] },
      { name: 'length', returnType: UcodeType.INTEGER, params: [UcodeType.UNKNOWN] },
      { name: 'substr', returnType: UcodeType.STRING, params: [UcodeType.STRING, UcodeType.INTEGER, UcodeType.INTEGER] },
      { name: 'split', returnType: UcodeType.ARRAY, params: [UcodeType.STRING, UcodeType.STRING] },
      { name: 'join', returnType: UcodeType.STRING, params: [UcodeType.STRING, UcodeType.ARRAY] },
      { name: 'trim', returnType: UcodeType.STRING, params: [UcodeType.STRING] },
      { name: 'ltrim', returnType: UcodeType.STRING, params: [UcodeType.STRING, UcodeType.STRING] },
      { name: 'rtrim', returnType: UcodeType.STRING, params: [UcodeType.STRING, UcodeType.STRING] },
      { name: 'chr', returnType: UcodeType.STRING, params: [UcodeType.INTEGER] },
      { name: 'ord', returnType: UcodeType.INTEGER, params: [UcodeType.STRING] },
      { name: 'uc', returnType: UcodeType.STRING, params: [UcodeType.STRING] },
      { name: 'lc', returnType: UcodeType.STRING, params: [UcodeType.STRING] },
      { name: 'type', returnType: UcodeType.STRING, params: [UcodeType.UNKNOWN] },
      { name: 'keys', returnType: UcodeType.ARRAY, params: [UcodeType.OBJECT] },
      { name: 'values', returnType: UcodeType.ARRAY, params: [UcodeType.OBJECT] },
      { name: 'push', returnType: UcodeType.INTEGER, params: [UcodeType.ARRAY, UcodeType.UNKNOWN] },
      { name: 'pop', returnType: UcodeType.UNKNOWN, params: [UcodeType.ARRAY] },
      { name: 'shift', returnType: UcodeType.UNKNOWN, params: [UcodeType.ARRAY] },
      { name: 'unshift', returnType: UcodeType.INTEGER, params: [UcodeType.ARRAY, UcodeType.UNKNOWN] },
      { name: 'index', returnType: UcodeType.INTEGER, params: [UcodeType.UNKNOWN, UcodeType.UNKNOWN] },
      { name: 'require', returnType: UcodeType.UNKNOWN, params: [UcodeType.STRING] },
      { name: 'include', returnType: UcodeType.UNKNOWN, params: [UcodeType.STRING] },
      { name: 'json', returnType: UcodeType.UNKNOWN, params: [UcodeType.UNKNOWN] },
      { name: 'match', returnType: UcodeType.ARRAY, params: [UcodeType.STRING, UcodeType.REGEX] },
      { name: 'replace', returnType: UcodeType.STRING, params: [UcodeType.STRING, UcodeType.STRING, UcodeType.STRING] },
      { name: 'system', returnType: UcodeType.INTEGER, params: [UcodeType.STRING] },
      { name: 'time', returnType: UcodeType.INTEGER, params: [] },
      { name: 'sleep', returnType: UcodeType.NULL, params: [UcodeType.INTEGER] },
      { name: 'localtime', returnType: UcodeType.OBJECT, params: [UcodeType.INTEGER] },
      { name: 'gmtime', returnType: UcodeType.OBJECT, params: [UcodeType.INTEGER] },
      { name: 'timelocal', returnType: UcodeType.INTEGER, params: [UcodeType.OBJECT] },
      { name: 'timegm', returnType: UcodeType.INTEGER, params: [UcodeType.OBJECT] },
      { name: 'min', returnType: UcodeType.INTEGER, params: [UcodeType.INTEGER] },
      { name: 'max', returnType: UcodeType.INTEGER, params: [UcodeType.INTEGER] },
      { name: 'uniq', returnType: UcodeType.ARRAY, params: [UcodeType.ARRAY] },
      { name: 'b64enc', returnType: UcodeType.STRING, params: [UcodeType.STRING] },
      { name: 'b64dec', returnType: UcodeType.STRING, params: [UcodeType.STRING] },
      { name: 'hexenc', returnType: UcodeType.STRING, params: [UcodeType.STRING] },
      { name: 'hexdec', returnType: UcodeType.STRING, params: [UcodeType.STRING, UcodeType.STRING] },
      { name: 'hex', returnType: UcodeType.INTEGER, params: [UcodeType.STRING] },
      { name: 'uchr', returnType: UcodeType.STRING, params: [UcodeType.INTEGER] },
      { name: 'iptoarr', returnType: UcodeType.ARRAY, params: [UcodeType.STRING] },
      { name: 'arrtoip', returnType: UcodeType.STRING, params: [UcodeType.ARRAY] },
      { name: 'int', returnType: UcodeType.INTEGER, params: [UcodeType.UNKNOWN] },
      { name: 'loadstring', returnType: UcodeType.FUNCTION, params: [UcodeType.STRING] },
      { name: 'loadfile', returnType: UcodeType.FUNCTION, params: [UcodeType.STRING] },
      { name: 'wildcard', returnType: UcodeType.BOOLEAN, params: [UcodeType.STRING, UcodeType.STRING] },
      { name: 'regexp', returnType: UcodeType.REGEX, params: [UcodeType.STRING, UcodeType.STRING] },
      { name: 'assert', returnType: UcodeType.NULL, params: [UcodeType.UNKNOWN, UcodeType.STRING] },
      { name: 'call', returnType: UcodeType.UNKNOWN, params: [UcodeType.FUNCTION, UcodeType.UNKNOWN] },
      { name: 'signal', returnType: UcodeType.UNKNOWN, params: [UcodeType.INTEGER, UcodeType.FUNCTION] },
      { name: 'clock', returnType: UcodeType.DOUBLE, params: [] },
      { name: 'sourcepath', returnType: UcodeType.STRING, params: [UcodeType.INTEGER, UcodeType.BOOLEAN] },
      { name: 'gc', returnType: UcodeType.NULL, params: [] }
    ];

    for (const builtin of builtins) {
      this.globalScope.set(builtin.name, {
        name: builtin.name,
        type: SymbolType.BUILTIN,
        dataType: UcodeType.FUNCTION, // Builtin functions should be typed as FUNCTION, not their return type
        returnType: builtin.returnType, // Store the actual return type separately
        scope: 0,
        declared: true,
        used: false,
        node: {
          type: 'Identifier',
          start: 0,
          end: 0,
          name: builtin.name
        } as IdentifierNode,
        declaredAt: 0,
        usedAt: []
      });
    }
    
    // Add global variables
    this.globalScope.set('ARGV', {
      name: 'ARGV',
      type: SymbolType.VARIABLE,
      dataType: createArrayType(UcodeType.STRING),
      scope: 0,
      declared: true,
      used: false,
      node: {
        type: 'Identifier',
        start: 0,
        end: 0,
        name: 'ARGV'
      } as IdentifierNode,
      declaredAt: 0,
      usedAt: []
    });

    // Add global constants
    this.globalScope.set('NaN', {
      name: 'NaN',
      type: SymbolType.VARIABLE,
      dataType: UcodeType.DOUBLE as UcodeDataType,
      scope: 0,
      declared: true,
      used: false,
      node: {
        type: 'Identifier',
        start: 0,
        end: 0,
        name: 'NaN'
      } as IdentifierNode,
      declaredAt: 0,
      usedAt: []
    });

    this.globalScope.set('Infinity', {
      name: 'Infinity',
      type: SymbolType.VARIABLE,
      dataType: UcodeType.DOUBLE as UcodeDataType,
      scope: 0,
      declared: true,
      used: false,
      node: {
        type: 'Identifier',
        start: 0,
        end: 0,
        name: 'Infinity'
      } as IdentifierNode,
      declaredAt: 0,
      usedAt: []
    });

    this.globalScope.set('REQUIRE_SEARCH_PATH', {
      name: 'REQUIRE_SEARCH_PATH',
      type: SymbolType.VARIABLE,
      // Every element is a search-path string (verified vs the interpreter), so type it
      // as array<string> like ARGV — a bare `array` left the for-in element `unknown`.
      dataType: createArrayType(UcodeType.STRING),
      scope: 0,
      declared: true,
      used: false,
      node: {
        type: 'Identifier',
        start: 0,
        end: 0,
        name: 'REQUIRE_SEARCH_PATH'
      } as IdentifierNode,
      declaredAt: 0,
      usedAt: []
    });

    this.globalScope.set('modules', {
      name: 'modules',
      type: SymbolType.VARIABLE,
      dataType: UcodeType.OBJECT as UcodeDataType,
      scope: 0,
      declared: true,
      used: false,
      node: {
        type: 'Identifier',
        start: 0,
        end: 0,
        name: 'modules'
      } as IdentifierNode,
      declaredAt: 0,
      usedAt: []
    });

    this.globalScope.set('global', {
      name: 'global',
      type: SymbolType.VARIABLE,
      dataType: UcodeType.OBJECT as UcodeDataType,
      scope: 0,
      declared: true,
      used: false,
      node: {
        type: 'Identifier',
        start: 0,
        end: 0,
        name: 'global'
      } as IdentifierNode,
      declaredAt: 0,
      usedAt: [],
      propertyTypes: new Map()
    });
  }

  enterScope(): void {
    this.scopes.push(new Map());
    this.currentScope++;
  }

  exitScope(endOffset?: number): void {
    if (this.scopes.length > 1) {
      // Stamp scopeEnd on all symbols in the exiting scope so lookupAtPosition
      // can determine if a position falls within a symbol's scope
      if (endOffset !== undefined) {
        const exitingScope = this.scopes[this.scopes.length - 1];
        if (exitingScope) {
          for (const symbol of exitingScope.values()) {
            symbol.scopeEnd = endOffset;
          }
        }
      }
      this.scopes.pop();
      this.currentScope--;
    }
  }

  declare(name: string, type: SymbolType, dataType: UcodeDataType, node: AstNode, initNode?: AstNode): boolean {
    const currentScopeMap = this.scopes[this.scopes.length - 1];
    if (!currentScopeMap) {
      return false;
    }
    
    // Check if already declared in current scope
    if (currentScopeMap.has(name)) {
      // A user declaration colliding with a seeded builtin (rejected here, builtin
      // survives) — record it so builtin-by-name consumers know it's shadowed.
      if (currentScopeMap.get(name)?.type === SymbolType.BUILTIN && type !== SymbolType.BUILTIN) {
        this.shadowedBuiltins.add(name);
        // An import OR a function declaration legally shadows a builtin in module scope
        // (verified vs the interpreter: `function split(s){…}` runs, shadowing the
        // builtin), and that binding — not the builtin — must win for member/call
        // resolution. So let it replace the seeded builtin (and succeed), instead of
        // falsely failing with UC3001 / UC1007. The `let`/`const` (VARIABLE) path keeps
        // its prior behavior (builtin survives the map; handled in visitVariableDeclarator).
        if (type === SymbolType.IMPORTED || type === SymbolType.FUNCTION) {
          // fall through to the declaration below, overwriting the builtin entry
        } else {
          return false;
        }
      } else {
        return false; // Already declared in current scope
      }
    }

    const symbol: Symbol = {
      name,
      type,
      dataType,
      scope: this.currentScope,
      declared: true,
      used: false,
      node,
      declaredAt: node.start,
      usedAt: [],
      ...(initNode && { initNode })
    };

    currentScopeMap.set(name, symbol);
    // Also add to allSymbols for position-based lookup after scope exits
    this.allSymbols.push(symbol);
    return true;
  }

  lookupInCurrentScope(name: string): Symbol | null {
    const currentScopeMap = this.scopes[this.scopes.length - 1];
    if (!currentScopeMap) {
      return null;
    }
    return currentScopeMap.get(name) || null;
  }

  getScopeCount(): number {
    return this.scopes.length;
  }

  lookup(name: string): Symbol | null {
    // Search from current scope to global scope
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const scope = this.scopes[i];
      if (scope) {
        const symbol = scope.get(name);
        if (symbol) {
          return symbol;
        }
      }
    }
    return null;
  }

  // Position-aware lookup that searches all scopes for symbols that contain the given position
  lookupAtPosition(name: string, position: number): Symbol | null {
    // Search allSymbols which includes both active and exited scopes.
    // Pick the innermost scope that contains the position.
    let bestMatch: Symbol | null = null;
    for (const symbol of this.allSymbols) {
      if (symbol.name === name && symbol.declaredAt !== undefined && symbol.declaredAt <= position) {
        // If scopeEnd is set, the symbol's scope has exited — check position is within range
        if (symbol.scopeEnd !== undefined && position > symbol.scopeEnd) {
          continue; // Position is outside this symbol's scope
        }
        // Prefer the symbol with the closest (most recent) declaredAt — innermost scope wins
        if (!bestMatch || symbol.declaredAt > bestMatch.declaredAt) {
          bestMatch = symbol;
        }
      }
    }

    // Fall back to active scopes if allSymbols didn't find anything
    if (!bestMatch) {
      for (let i = this.scopes.length - 1; i >= 0; i--) {
        const scope = this.scopes[i];
        if (scope) {
          const symbol = scope.get(name);
          if (symbol) {
            if (symbol.declaredAt !== undefined && symbol.declaredAt <= position) {
              return symbol;
            }
          }
        }
      }
    }
    return bestMatch;
  }

  // Debug method to see all symbols in all scopes
  debugLookup(name: string): void {
    console.log(`[SYMBOL_DEBUG] Looking up '${name}' in ${this.scopes.length} scopes:`);
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const scope = this.scopes[i];
      if (scope) {
        const symbol = scope.get(name);
        const allSymbols = Array.from(scope.keys());
        console.log(`[SYMBOL_DEBUG] Scope ${i}: ${allSymbols.length} symbols [${allSymbols.join(', ')}] - ${name}: ${symbol ? 'FOUND' : 'NOT FOUND'}`);
        if (symbol) {
          console.log(`[SYMBOL_DEBUG] Symbol details: type=${symbol.type}, dataType=${JSON.stringify(symbol.dataType)}`);
        }
      }
    }
  }

  // Force update a symbol's type across all scopes
  updateSymbolType(name: string, newDataType: UcodeDataType): boolean {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const scope = this.scopes[i];
      if (scope) {
        const symbol = scope.get(name);
        if (symbol) {
          symbol.dataType = newDataType;
          symbol.currentType = undefined;
          symbol.currentTypeEffectiveFrom = undefined;
          // console.log(`[SYMBOL_UPDATE] Updated ${name} to type ${JSON.stringify(newDataType)} in scope ${i}`);
          return true;
        }
      }
    }
    return false;
  }

  // Force declare a symbol in global scope - ALWAYS ensures symbol exists in global scope
  forceGlobalDeclaration(name: string, type: SymbolType, dataType: UcodeDataType): void {
    // Always ensure the symbol exists in global scope (scope 0) for completion access
    const globalScope = this.scopes[0];
    if (!globalScope) {
      //console.log(`[SYMBOL_FORCE] ERROR: No global scope available for ${name}`);
      return;
    }
    
    // Check if symbol already exists in global scope
    const globalSymbol = globalScope.get(name);
    if (globalSymbol) {
      // Update existing global symbol via SSA — preserve original dataType
      // so hover shows the declared type at positions before the assignment
      globalSymbol.currentType = dataType;
      return;
    }
    
    // Look for existing symbol in other scopes to preserve position information
    const existingSymbol = this.lookup(name);
    let nodeToUse: AstNode;
    let declaredAtPos: number;
    
    if (existingSymbol) {
      // Preserve the original node and position information
      nodeToUse = existingSymbol.node;
      declaredAtPos = existingSymbol.declaredAt;
      //console.log(`[SYMBOL_FORCE] Preserving position info from existing symbol: start=${nodeToUse.start}, declaredAt=${declaredAtPos}`);
    } else {
      // Fallback to fake node only if no existing symbol found
      nodeToUse = {
        type: 'Identifier',
        start: 0,
        end: 0,
        name: name
      } as IdentifierNode;
      declaredAtPos = 0;
    }
    
    // Create new symbol in global scope
    const symbol: Symbol = {
      name,
      type,
      dataType,
      scope: 0,
      declared: true,
      used: existingSymbol ? existingSymbol.used : false, // Preserve usage state
      node: nodeToUse,
      declaredAt: declaredAtPos,
      usedAt: existingSymbol ? existingSymbol.usedAt : [] // Preserve usage positions
    };
    globalScope.set(name, symbol);
    //console.log(`[SYMBOL_FORCE] Created ${name} in global scope with type ${JSON.stringify(dataType)}, preserving position ${declaredAtPos}`);
    
    // Also update any existing symbols in other scopes
    if (existingSymbol && existingSymbol.scope !== 0) {
      existingSymbol.dataType = dataType;
      //console.log(`[SYMBOL_FORCE] Also updated existing ${name} in scope ${existingSymbol.scope} to type ${JSON.stringify(dataType)}`);
    }
  }

  markUsed(name: string, position: number): boolean {
    let foundAny = false;

    // Mark ALL symbols with this name as used across all scopes
    // This handles cases where the same variable exists in multiple scopes
    // (e.g., declared in function scope and force-declared in global scope)
    for (const scopeMap of this.scopes) {
      const symbol = scopeMap.get(name);
      if (symbol) {
        symbol.used = true;
        symbol.usedAt.push(position);
        foundAny = true;
      }
    }

    return foundAny;
  }

  // Check for variable shadowing
  checkShadowing(name: string): Symbol | null {
    // Look for the same name in outer scopes
    for (let i = this.scopes.length - 2; i >= 0; i--) {
      const scope = this.scopes[i];
      if (scope) {
        const symbol = scope.get(name);
        if (symbol) {
          return symbol;
        }
      }
    }
    return null;
  }

  // Get all unused variables in current scope
  getUnusedVariables(): Symbol[] {
    const unused: Symbol[] = [];
    for (const scopeMap of this.scopes) {
      for (const symbol of scopeMap.values()) {
        if (!symbol.used && symbol.type !== SymbolType.BUILTIN) {
          unused.push(symbol);
        }
      }
    }
    return unused;
  }

  // Get current scope level
  getCurrentScope(): number {
    return this.currentScope;
  }

  // Get all symbols in current scope
  getCurrentScopeSymbols(): Map<string, Symbol> {
    const currentScope = this.scopes[this.scopes.length - 1];
    return currentScope || new Map();
  }

  // Get all symbols across all scopes
  getAllSymbols(): Symbol[] {
    const allSymbols: Symbol[] = [];
    for (const scopeMap of this.scopes) {
      for (const symbol of scopeMap.values()) {
        allSymbols.push(symbol);
      }
    }
    return allSymbols;
  }

  // Get all symbols visible at a specific position (includes exited scopes)
  getSymbolsAtPosition(position: number): Symbol[] {
    const seen = new Map<string, Symbol>();

    // Active scopes (innermost wins)
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const scope = this.scopes[i];
      if (scope) {
        for (const symbol of scope.values()) {
          if (symbol.declaredAt <= position && !seen.has(symbol.name)) {
            seen.set(symbol.name, symbol);
          }
        }
      }
    }

    // Exited scopes — only if the position falls within the symbol's scope range
    for (const symbol of this.allSymbols) {
      if (seen.has(symbol.name)) continue;
      if (symbol.declaredAt <= position) {
        if (symbol.scopeEnd === undefined || position <= symbol.scopeEnd) {
          // Prefer the innermost (latest declaredAt)
          const existing = seen.get(symbol.name);
          if (!existing || symbol.declaredAt > existing.declaredAt) {
            seen.set(symbol.name, symbol);
          }
        }
      }
    }

    return Array.from(seen.values());
  }
}
