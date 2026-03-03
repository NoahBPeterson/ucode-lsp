/**
 * TypeState - A snapshot of variable types at a specific point in the CFG
 *
 * TypeState is similar to SymbolTable but represents a point-in-time snapshot
 * of type information at a specific location in the control flow graph.
 */

import {
  UcodeDataType,
  UcodeType,
  createUnionType,
  getUnionTypes,
  isUnionType,
  typeToString,
} from '../symbolTable';

/**
 * TypeState represents the type information for all variables at a specific
 * point in the control flow graph.
 *
 * Unlike the SymbolTable which manages scopes and declarations, TypeState
 * is a lightweight snapshot focused solely on the current types of variables.
 */
export class TypeState {
  /** Map from variable name to its current type */
  private types: Map<string, UcodeDataType> = new Map();

  /**
   * Creates a deep copy of this TypeState.
   * This is essential for data flow analysis where we need independent copies
   * at different CFG locations.
   */
  clone(): TypeState {
    const newState = new TypeState();
    newState.types = new Map(this.types);
    return newState;
  }

  /**
   * Gets the type of a variable at this point in the CFG.
   * Returns undefined if the variable has no known type.
   */
  get(name: string): UcodeDataType | undefined {
    return this.types.get(name);
  }

  /**
   * Sets the type of a variable at this point in the CFG.
   */
  set(name: string, type: UcodeDataType): void {
    this.types.set(name, type);
  }

  /**
   * Checks if this TypeState has type information for a variable.
   */
  has(name: string): boolean {
    return this.types.has(name);
  }

  /**
   * Removes type information for a variable.
   * This is useful for modeling delete operations or scope exits.
   */
  delete(name: string): boolean {
    return this.types.delete(name);
  }

  /**
   * Gets all variable names tracked in this TypeState.
   */
  getAllKeys(): string[] {
    return Array.from(this.types.keys());
  }

  /**
   * Merges another TypeState into this one.
   *
   * This is used at control-flow join points (e.g., after an if/else statement)
   * where we need to combine type information from multiple incoming paths.
   *
   * For each variable:
   * - If only one path has the variable, use that type
   * - If both paths have the variable with the same type, use that type
   * - If both paths have the variable with different types, create a union type
   *
   * @param other The TypeState to merge into this one
   */
  merge(other: TypeState): void {
    // Get all variables from both states
    const allKeys = new Set([...this.types.keys(), ...other.types.keys()]);

    for (const key of allKeys) {
      const type1 = this.types.get(key);
      const type2 = other.types.get(key);

      // Compute the union of the two types
      const mergedType = this.computeUnion(type1, type2);
      this.types.set(key, mergedType);
    }
  }

  /**
   * Computes the union of two types.
   *
   * This reuses the logic from symbolTable.ts to ensure consistency
   * across the type system.
   *
   * Examples:
   * - union(string, string) = string
   * - union(string, integer) = string | integer
   * - union(string, unknown) = string | unknown
   * - union(undefined, string) = string
   * - union(string | integer, boolean) = string | integer | boolean
   *
   * @param type1 First type (may be undefined)
   * @param type2 Second type (may be undefined)
   * @returns The union of the two types
   */
  private computeUnion(
    type1: UcodeDataType | undefined,
    type2: UcodeDataType | undefined
  ): UcodeDataType {
    // If one type is undefined, return the other
    if (!type1) return type2 || UcodeType.UNKNOWN;
    if (!type2) return type1;

    // If types are equal, return one of them
    if (this.typesEqual(type1, type2)) {
      return type1;
    }

    // Get the constituent types from both (handling unions)
    const types1 = getUnionTypes(type1);
    const types2 = getUnionTypes(type2);

    // Combine and deduplicate
    const allTypes = [...types1, ...types2];
    return createUnionType(allTypes);
  }

  /**
   * Checks if two types are equal.
   *
   * This handles:
   * - Simple type equality (integer === integer)
   * - Union type equality (string | integer === integer | string)
   * - Module type equality
   * - Default import type equality
   */
  private typesEqual(type1: UcodeDataType, type2: UcodeDataType): boolean {
    // If both are simple types (strings), direct comparison works
    if (typeof type1 === 'string' && typeof type2 === 'string') {
      return type1 === type2;
    }

    // If both are union types, check if they contain the same types
    if (isUnionType(type1) && isUnionType(type2)) {
      const types1 = new Set(type1.types);
      const types2 = new Set(type2.types);

      if (types1.size !== types2.size) return false;

      for (const t of types1) {
        if (!types2.has(t)) return false;
      }

      return true;
    }

    // If both are objects (ModuleType, DefaultImportType, etc.)
    if (typeof type1 === 'object' && typeof type2 === 'object') {
      // Check for ModuleType
      if ('moduleName' in type1 && 'moduleName' in type2) {
        return type1.moduleName === type2.moduleName;
      }

      // Check for DefaultImportType
      if (
        'isDefaultImport' in type1 &&
        'isDefaultImport' in type2 &&
        'type' in type1 &&
        'type' in type2
      ) {
        return (
          type1.isDefaultImport === type2.isDefaultImport &&
          type1.type === type2.type
        );
      }

      // Generic object comparison
      return JSON.stringify(type1) === JSON.stringify(type2);
    }

    return false;
  }

  /**
   * Narrows the type of a variable based on a type guard.
   *
   * For example, after `typeof x === 'string'`, we can narrow x to 'string'.
   *
   * @param name Variable name to narrow
   * @param narrowedType The narrowed type
   */
  narrow(name: string, narrowedType: UcodeDataType): void {
    const currentType = this.types.get(name);

    if (!currentType) {
      // Variable not in scope, add it with the narrowed type
      this.types.set(name, narrowedType);
      return;
    }

    // If current type is a union, intersect with the narrowed type
    if (isUnionType(currentType)) {
      const narrowedTypes = getUnionTypes(narrowedType);
      const remainingTypes = currentType.types.filter((t) =>
        narrowedTypes.includes(t)
      );

      if (remainingTypes.length > 0) {
        this.types.set(name, createUnionType(remainingTypes));
      } else {
        // No intersection, keep the narrowed type (type guard is more specific)
        this.types.set(name, narrowedType);
      }
    } else {
      // Replace with narrowed type
      this.types.set(name, narrowedType);
    }
  }

  /**
   * Excludes a type from a variable's type.
   *
   * For example, after `typeof x !== 'string'`, we can exclude 'string' from x's type.
   * If x was 'string | integer', it becomes 'integer'.
   *
   * @param name Variable name
   * @param excludedType The type to exclude
   */
  exclude(name: string, excludedType: UcodeDataType): void {
    const currentType = this.types.get(name);

    if (!currentType) {
      // Variable not in scope, nothing to exclude
      return;
    }

    const excludedTypes = getUnionTypes(excludedType);

    if (isUnionType(currentType)) {
      // Remove excluded types from the union
      const remainingTypes = currentType.types.filter(
        (t) => !excludedTypes.includes(t)
      );

      if (remainingTypes.length > 0) {
        this.types.set(name, createUnionType(remainingTypes));
      } else {
        // All types excluded, set to unknown
        this.types.set(name, UcodeType.UNKNOWN);
      }
    } else {
      // Check if current type is in excluded types
      if (excludedTypes.includes(currentType as UcodeType)) {
        // Type is excluded, set to unknown
        this.types.set(name, UcodeType.UNKNOWN);
      }
      // Otherwise, keep current type
    }
  }

  /**
   * Returns a human-readable string representation of this TypeState.
   * Useful for debugging and visualization.
   */
  toString(): string {
    const entries = Array.from(this.types.entries())
      .map(([name, type]) => `${name}: ${typeToString(type)}`)
      .sort()
      .join(', ');

    return `{ ${entries} }`;
  }

  /**
   * Checks if this TypeState is equal to another.
   * Used by the data flow analyzer to detect when a fixed point is reached.
   */
  equals(other: TypeState): boolean {
    const thisKeys = this.getAllKeys();
    const otherKeys = other.getAllKeys();

    // Different number of variables
    if (thisKeys.length !== otherKeys.length) return false;

    // Check each variable
    for (const key of thisKeys) {
      const thisType = this.types.get(key)!;
      const otherType = other.types.get(key);

      if (!otherType || !this.typesEqual(thisType, otherType)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Returns the number of variables tracked in this TypeState.
   */
  size(): number {
    return this.types.size;
  }

  /**
   * Clears all type information from this TypeState.
   */
  clear(): void {
    this.types.clear();
  }
}
