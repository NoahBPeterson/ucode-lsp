/**
 * Symbol Table for ucode semantic analysis
 * Manages variable scoping and symbol resolution
 */

import { AstNode, IdentifierNode } from '../ast/nodes';

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
  NULL = 'null',
  UNKNOWN = 'unknown',
  UNION = 'union'
}

export interface UnionType {
  type: UcodeType.UNION;
  types: UcodeType[];
}

export interface ModuleType {
  type: UcodeType.OBJECT;
  moduleName: string;
}

export type UcodeDataType = UcodeType | UnionType | ModuleType;

// Utility functions for working with union types
export function createUnionType(types: UcodeType[]): UcodeDataType {
  // Remove duplicates but preserve UNKNOWN types (they represent valid unknown return types)
  const uniqueTypes = [...new Set(types)];
  
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

export function isUnionType(type: UcodeDataType): type is UnionType {
  return typeof type === 'object' && type.type === UcodeType.UNION;
}

export function getUnionTypes(type: UcodeDataType): UcodeType[] {
  if (isUnionType(type)) {
    return type.types;
  }
  return [type as UcodeType];
}

export function typeToString(type: UcodeDataType): string {
  if (isUnionType(type)) {
    return type.types.join(' | ');
  }
  return type as string;
}

export function isTypeCompatible(actual: UcodeDataType, expected: UcodeDataType): boolean {
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
  // Import-specific fields
  importedFrom?: string;        // File path where this symbol is imported from
  importSpecifier?: string;     // Original name if aliased (e.g., 'run_command' for 'import { run_command as cmd }')
  definitionLocation?: {        // Location of the actual definition
    uri: string;
    range: { start: number; end: number };
  };
}

export class SymbolTable {
  private scopes: Map<string, Symbol>[] = [];
  private currentScope = 0;
  private globalScope: Map<string, Symbol> = new Map();

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
      { name: 'ltrim', returnType: UcodeType.STRING, params: [UcodeType.STRING] },
      { name: 'rtrim', returnType: UcodeType.STRING, params: [UcodeType.STRING] },
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
      { name: 'match', returnType: UcodeType.ARRAY, params: [UcodeType.STRING, UcodeType.STRING] },
      { name: 'replace', returnType: UcodeType.STRING, params: [UcodeType.STRING, UcodeType.STRING, UcodeType.STRING] },
      { name: 'system', returnType: UcodeType.INTEGER, params: [UcodeType.STRING] },
      { name: 'time', returnType: UcodeType.INTEGER, params: [] },
      { name: 'sleep', returnType: UcodeType.NULL, params: [UcodeType.INTEGER] },
      { name: 'localtime', returnType: UcodeType.ARRAY, params: [UcodeType.INTEGER] },
      { name: 'gmtime', returnType: UcodeType.ARRAY, params: [UcodeType.INTEGER] },
      { name: 'timelocal', returnType: UcodeType.INTEGER, params: [UcodeType.ARRAY] },
      { name: 'timegm', returnType: UcodeType.INTEGER, params: [UcodeType.ARRAY] },
      { name: 'min', returnType: UcodeType.INTEGER, params: [UcodeType.INTEGER] },
      { name: 'max', returnType: UcodeType.INTEGER, params: [UcodeType.INTEGER] },
      { name: 'uniq', returnType: UcodeType.ARRAY, params: [UcodeType.ARRAY] },
      { name: 'b64enc', returnType: UcodeType.STRING, params: [UcodeType.STRING] },
      { name: 'b64dec', returnType: UcodeType.STRING, params: [UcodeType.STRING] },
      { name: 'hexenc', returnType: UcodeType.STRING, params: [UcodeType.STRING] },
      { name: 'hexdec', returnType: UcodeType.STRING, params: [UcodeType.STRING] },
      { name: 'hex', returnType: UcodeType.STRING, params: [UcodeType.INTEGER] },
      { name: 'uchr', returnType: UcodeType.STRING, params: [UcodeType.INTEGER] },
      { name: 'iptoarr', returnType: UcodeType.ARRAY, params: [UcodeType.STRING] },
      { name: 'arrtoip', returnType: UcodeType.STRING, params: [UcodeType.ARRAY] },
      { name: 'int', returnType: UcodeType.INTEGER, params: [UcodeType.UNKNOWN] },
      { name: 'loadstring', returnType: UcodeType.FUNCTION, params: [UcodeType.STRING] },
      { name: 'loadfile', returnType: UcodeType.FUNCTION, params: [UcodeType.STRING] },
      { name: 'wildcard', returnType: UcodeType.BOOLEAN, params: [UcodeType.STRING, UcodeType.STRING] },
      { name: 'regexp', returnType: UcodeType.OBJECT, params: [UcodeType.STRING, UcodeType.STRING] },
      { name: 'assert', returnType: UcodeType.UNKNOWN, params: [UcodeType.UNKNOWN, UcodeType.STRING] },
      { name: 'call', returnType: UcodeType.UNKNOWN, params: [UcodeType.FUNCTION, UcodeType.UNKNOWN] },
      { name: 'signal', returnType: UcodeType.UNKNOWN, params: [UcodeType.INTEGER, UcodeType.FUNCTION] },
      { name: 'clock', returnType: UcodeType.DOUBLE, params: [] },
      { name: 'sourcepath', returnType: UcodeType.STRING, params: [] },
      { name: 'gc', returnType: UcodeType.NULL, params: [] }
    ];

    for (const builtin of builtins) {
      this.globalScope.set(builtin.name, {
        name: builtin.name,
        type: SymbolType.BUILTIN,
        dataType: builtin.returnType,
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
  }

  enterScope(): void {
    this.scopes.push(new Map());
    this.currentScope++;
  }

  exitScope(): void {
    if (this.scopes.length > 1) {
      this.scopes.pop();
      this.currentScope--;
    }
  }

  declare(name: string, type: SymbolType, dataType: UcodeDataType, node: AstNode): boolean {
    const currentScopeMap = this.scopes[this.scopes.length - 1];
    if (!currentScopeMap) {
      return false;
    }
    
    // Check if already declared in current scope
    if (currentScopeMap.has(name)) {
      return false; // Already declared in current scope
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
      usedAt: []
    };

    currentScopeMap.set(name, symbol);
    return true;
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

  markUsed(name: string, position: number): boolean {
    const symbol = this.lookup(name);
    if (symbol) {
      symbol.used = true;
      symbol.usedAt.push(position);
      return true;
    }
    return false;
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
}