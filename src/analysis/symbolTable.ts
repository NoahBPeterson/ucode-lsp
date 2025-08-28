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
  REGEX = 'regex',
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
  
  // Handle module types (ModuleType)
  if (typeof type === 'object' && type.type === UcodeType.OBJECT && 'moduleName' in type) {
    const moduleType = type as ModuleType;
    // For actual fs objects, return the specific type (fs.file, fs.dir, fs.proc)
    if (moduleType.moduleName.startsWith('fs.') || moduleType.moduleName.startsWith('uci.')) {
      return moduleType.moduleName;
    }
    // For module references, return a more descriptive format
    return `${moduleType.moduleName} module`;
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
      { name: 'hexdec', returnType: UcodeType.STRING, params: [UcodeType.STRING, UcodeType.STRING] },
      { name: 'hex', returnType: UcodeType.STRING, params: [UcodeType.INTEGER] },
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
      dataType: UcodeType.ARRAY as UcodeDataType,
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
      dataType: UcodeType.ARRAY as UcodeDataType,
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
      usedAt: []
    });
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

  // Position-aware lookup that searches all scopes for symbols that contain the given position
  lookupAtPosition(name: string, position: number): Symbol | null {
    // Search all scopes for symbols with the given name
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const scope = this.scopes[i];
      if (scope) {
        const symbol = scope.get(name);
        if (symbol) {
          // Check if the symbol is accessible from this position (symbol was declared before this position)
          if (symbol.declaredAt !== undefined && symbol.declaredAt <= position) {
            return symbol;
          }
        }
      }
    }
    return null;
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
          console.log(`[SYMBOL_UPDATE] Updated ${name} to type ${JSON.stringify(newDataType)} in scope ${i}`);
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
      console.log(`[SYMBOL_FORCE] ERROR: No global scope available for ${name}`);
      return;
    }
    
    // Check if symbol already exists in global scope
    const globalSymbol = globalScope.get(name);
    if (globalSymbol) {
      // Update existing global symbol
      globalSymbol.dataType = dataType;
      console.log(`[SYMBOL_FORCE] Updated existing global ${name} to type ${JSON.stringify(dataType)}`);
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
      console.log(`[SYMBOL_FORCE] Preserving position info from existing symbol: start=${nodeToUse.start}, declaredAt=${declaredAtPos}`);
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
    console.log(`[SYMBOL_FORCE] Created ${name} in global scope with type ${JSON.stringify(dataType)}, preserving position ${declaredAtPos}`);
    
    // Also update any existing symbols in other scopes
    if (existingSymbol && existingSymbol.scope !== 0) {
      existingSymbol.dataType = dataType;
      console.log(`[SYMBOL_FORCE] Also updated existing ${name} in scope ${existingSymbol.scope} to type ${JSON.stringify(dataType)}`);
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
}