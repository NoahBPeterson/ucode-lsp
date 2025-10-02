/**
 * Type Narrowing Engine for ucode semantic analysis
 * Handles union type narrowing and flow-sensitive typing
 */

import { UcodeType, UcodeDataType, isUnionType, getUnionTypes, createUnionType } from './symbolTable';

export interface TypeNarrowingResult {
  narrowedType: UcodeDataType;
  excludedTypes: UcodeType[];
}

export class TypeNarrowingEngine {
  
  /**
   * Removes null from a union type or returns the type unchanged if it doesn't contain null
   */
  removeNullFromType(type: UcodeDataType): TypeNarrowingResult {
    if (!isUnionType(type)) {
      // Single type - only narrow if it's null
      if (type === UcodeType.NULL) {
        return {
          narrowedType: UcodeType.UNKNOWN, // null narrowed to unknown (empty)
          excludedTypes: [UcodeType.NULL]
        };
      }
      return {
        narrowedType: type,
        excludedTypes: []
      };
    }

    const unionTypes = getUnionTypes(type);
    const nonNullTypes = unionTypes.filter(t => t !== UcodeType.NULL);
    const hasNull = unionTypes.includes(UcodeType.NULL);

    if (!hasNull) {
      // No null in the union, return as-is
      return {
        narrowedType: type,
        excludedTypes: []
      };
    }

    return {
      narrowedType: createUnionType(nonNullTypes),
      excludedTypes: [UcodeType.NULL]
    };
  }

  /**
   * Removes specific types from a union type
   */
  removeTypesFromUnion(type: UcodeDataType, typesToRemove: UcodeType[]): TypeNarrowingResult {
    if (!isUnionType(type)) {
      // Single type - check if it should be removed
      if (typesToRemove.includes(type as UcodeType)) {
        return {
          narrowedType: UcodeType.UNKNOWN, // Completely narrowed away
          excludedTypes: [type as UcodeType]
        };
      }
      return {
        narrowedType: type,
        excludedTypes: []
      };
    }

    const unionTypes = getUnionTypes(type);
    const remainingTypes = unionTypes.filter(t => !typesToRemove.includes(t));
    const excludedTypes = unionTypes.filter(t => typesToRemove.includes(t));

    return {
      narrowedType: createUnionType(remainingTypes),
      excludedTypes
    };
  }

  /**
   * Keeps only specific types from a union type (inverse of removeTypesFromUnion)
   */
  keepOnlyTypes(type: UcodeDataType, typesToKeep: UcodeType[]): TypeNarrowingResult {
    if (!isUnionType(type)) {
      // Single type - check if it should be kept
      if (typesToKeep.includes(type as UcodeType)) {
        return {
          narrowedType: type,
          excludedTypes: []
        };
      }
      return {
        narrowedType: UcodeType.UNKNOWN, // Completely narrowed away
        excludedTypes: [type as UcodeType]
      };
    }

    const unionTypes = getUnionTypes(type);
    const keptTypes = unionTypes.filter(t => typesToKeep.includes(t));
    const excludedTypes = unionTypes.filter(t => !typesToKeep.includes(t));

    return {
      narrowedType: createUnionType(keptTypes),
      excludedTypes
    };
  }

  /**
   * Get the types that are incompatible with a given expected type
   */
  getIncompatibleTypes(actualType: UcodeDataType, expectedType: UcodeType): UcodeType[] {
    const actualTypes = getUnionTypes(actualType);
    return actualTypes.filter(type => !this.isTypeCompatible(type, expectedType));
  }

  /**
   * Check if an actual type is assignable to an expected type
   */
  isSubtype(actualType: UcodeDataType, expectedType: UcodeType): boolean {
    const actualTypes = getUnionTypes(actualType);
    return actualTypes.every(type => this.isTypeCompatible(type, expectedType));
  }

  /**
   * Get the portion of a union type that is NOT assignable to an expected type
   */
  getUnassignablePortion(actualType: UcodeDataType, expectedType: UcodeType): UcodeDataType {
    const incompatibleTypes = this.getIncompatibleTypes(actualType, expectedType);
    return createUnionType(incompatibleTypes);
  }

  /**
   * Check if a single type is compatible with an expected type
   */
  private isTypeCompatible(actualType: UcodeType, expectedType: UcodeType): boolean {
    if (actualType === expectedType) return true;
    if (expectedType === UcodeType.UNKNOWN) return true;
    if (actualType === UcodeType.UNKNOWN) return true;
    
    // Allow integer to double conversion
    if (actualType === UcodeType.INTEGER && expectedType === UcodeType.DOUBLE) return true;
    
    // For 'in' operator: both array and object are compatible
    if (expectedType === UcodeType.OBJECT && actualType === UcodeType.ARRAY) return true;
    if (expectedType === UcodeType.ARRAY && actualType === UcodeType.OBJECT) return true;
    
    return false;
  }

  /**
   * Check if a union type contains null
   */
  containsNull(type: UcodeDataType): boolean {
    const types = getUnionTypes(type);
    return types.includes(UcodeType.NULL);
  }

  /**
   * Check if a union type contains a specific type
   */
  containsType(type: UcodeDataType, searchType: UcodeType): boolean {
    const types = getUnionTypes(type);
    return types.includes(searchType);
  }

  /**
   * Get human-readable description of type incompatibility
   */
  getIncompatibilityDescription(actualType: UcodeDataType, expectedType: UcodeType): string {
    const incompatibleTypes = this.getIncompatibleTypes(actualType, expectedType);
    
    if (incompatibleTypes.length === 0) {
      return ''; // No incompatibility
    }

    if (incompatibleTypes.length === 1) {
      return `Argument is possibly '${incompatibleTypes[0]}', expected '${expectedType}'`;
    }

    return `Argument is possibly '${incompatibleTypes.join("' or '")}', expected '${expectedType}'`;
  }

  /**
   * Check if type requires null checking before use with operators
   */
  requiresNullCheck(type: UcodeDataType, _operation: 'in' | 'dot' | 'call'): boolean {
    if (!this.containsNull(type)) {
      return false;
    }

    // If the type is ONLY null, don't suggest null check (it's always null)
    const types = getUnionTypes(type);
    return types.length > 1; // Only suggest null check if there are other types too
  }

  /**
   * Check if type requires type guard before use with specific expected type
   */
  requiresTypeGuard(actualType: UcodeDataType, expectedType: UcodeType): boolean {
    return !this.isSubtype(actualType, expectedType) && 
           this.getIncompatibleTypes(actualType, expectedType).length > 0;
  }

  /**
   * Generate type guard condition for narrowing to expected type
   */
  generateTypeGuardCondition(variableName: string, expectedType: UcodeType): string {
    switch (expectedType) {
      case UcodeType.ARRAY:
        return `type(${variableName}) == 'array'`;
      case UcodeType.OBJECT:
        return `type(${variableName}) == 'object'`;
      case UcodeType.STRING:
        return `type(${variableName}) == 'string'`;
      case UcodeType.INTEGER:
        return `type(${variableName}) == 'int'`;
      case UcodeType.DOUBLE:
        return `type(${variableName}) == 'double'`;
      case UcodeType.BOOLEAN:
        return `type(${variableName}) == 'bool'`;
      case UcodeType.NULL:
        return `${variableName} == null`;
      case UcodeType.FUNCTION:
        return `type(${variableName}) == 'function'`;
      default:
        return `type(${variableName}) == '${expectedType}'`;
    }
  }

  /**
   * Generate null guard condition
   */
  generateNullGuardCondition(variableName: string): string {
    return `${variableName} != null`;
  }
}