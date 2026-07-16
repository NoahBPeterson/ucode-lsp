/**
 * Type Narrowing Engine for ucode semantic analysis
 * Handles union type narrowing and flow-sensitive typing
 */

import { UcodeType, type UcodeDataType, type SingleType, isUnionType, getUnionTypes, createUnionType, singleTypeToBase, isObjectType, isArrayType, NEVER_TYPE } from './symbolTable';

/** Base types that are ALWAYS truthy in ucode (`ucv_is_truish`'s `default: return
 *  true` — objects, arrays, functions, regexes, resources). Everything else
 *  (integer 0, double 0/NaN, boolean false, string "", null) has a falsy inhabitant,
 *  so on the FALSY edge of a truthiness test only these are eliminated. */
const ALWAYS_TRUTHY_BASES: ReadonlySet<UcodeType> = new Set([
  UcodeType.OBJECT, UcodeType.ARRAY, UcodeType.FUNCTION, UcodeType.REGEX,
]);

/** Is a single (possibly refined) type always truthy — so it cannot appear on the
 *  falsy edge of `if (x)`? Refined object/array shapes and module/handle objects
 *  all collapse to OBJECT/ARRAY, i.e. always truthy. */
function isAlwaysTruthy(t: SingleType): boolean {
  return ALWAYS_TRUTHY_BASES.has(singleTypeToBase(t));
}

/** Check if a SingleType matches any entry in a list (by base type for refined types) */
function singleTypeIn(t: SingleType, list: SingleType[]): boolean {
  const base = singleTypeToBase(t);
  return list.some(item => {
    if (typeof item === 'string' && typeof t === 'string') return item === t;
    // For refined types, match by base type
    return singleTypeToBase(item) === base;
  });
}

export interface TypeNarrowingResult {
  narrowedType: UcodeDataType;
  excludedTypes: SingleType[];
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
  removeTypesFromUnion(type: UcodeDataType, typesToRemove: SingleType[]): TypeNarrowingResult {
    if (!isUnionType(type)) {
      // Single type - check if it should be removed
      if (singleTypeIn(type as SingleType, typesToRemove)) {
        return {
          narrowedType: UcodeType.UNKNOWN, // Completely narrowed away
          excludedTypes: [type as SingleType]
        };
      }
      return {
        narrowedType: type,
        excludedTypes: []
      };
    }

    const unionTypes = getUnionTypes(type);
    const remainingTypes = unionTypes.filter(t => !singleTypeIn(t, typesToRemove));
    const excludedTypes = unionTypes.filter(t => singleTypeIn(t, typesToRemove));

    return {
      narrowedType: createUnionType(remainingTypes),
      excludedTypes
    };
  }

  /**
   * Keeps only specific types from a union type (inverse of removeTypesFromUnion)
   */
  keepOnlyTypes(type: UcodeDataType, typesToKeep: SingleType[]): TypeNarrowingResult {
    if (!isUnionType(type)) {
      // Single type - check if it should be kept
      if (singleTypeIn(type as SingleType, typesToKeep)) {
        return {
          narrowedType: type,
          excludedTypes: []
        };
      }
      // UNKNOWN (or the display-only ANY sentinel — json()/call() contract-any,
      // which behaves exactly like UNKNOWN in every check) means "could be
      // anything" — a type guard narrows it to the tested type.
      if ((type === UcodeType.UNKNOWN || type === UcodeType.ANY) && typesToKeep.length > 0) {
        return {
          narrowedType: typesToKeep.length === 1 ? typesToKeep[0]! as UcodeDataType : createUnionType(typesToKeep),
          excludedTypes: []
        };
      }
      return {
        narrowedType: UcodeType.UNKNOWN, // Completely narrowed away
        excludedTypes: [type as SingleType]
      };
    }

    const unionTypes = getUnionTypes(type);
    const keptTypes = unionTypes.filter(t => singleTypeIn(t, typesToKeep));
    const excludedTypes = unionTypes.filter(t => !singleTypeIn(t, typesToKeep));

    return {
      narrowedType: createUnionType(keptTypes),
      excludedTypes
    };
  }

  /**
   * Narrow a type to its FALSY-capable subset — the type on the false/else edge of
   * a bare truthiness test `if (x)`. Per ucode's `ucv_is_truish`, only null, false
   * (boolean), 0 (integer), 0.0/NaN (double) and "" (string) are falsy, so a scalar
   * base keeps its type (`boolean → boolean`, `integer → integer`, …) while the
   * ALWAYS-truthy bases (object/array/function/regex) are eliminated — they can
   * NEVER be reached on the falsy edge. When every member is always-truthy (`if
   * (obj) …` for a non-null object), the falsy edge is impossible → BOTTOM/`never`,
   * which the join treats as the identity so it doesn't poison the merge.
   *
   * `unknown` (TOP) carries no member info and includes falsy possibilities, so it
   * is returned unchanged (never refined away).
   */
  narrowToFalsy(type: UcodeDataType): TypeNarrowingResult {
    if (type === UcodeType.UNKNOWN) {
      return { narrowedType: type, excludedTypes: [] };
    }
    const members = getUnionTypes(type);
    const kept = members.filter(t => !isAlwaysTruthy(t));
    const excluded = members.filter(isAlwaysTruthy);
    if (kept.length === 0) {
      // Every member is always-truthy → the falsy edge is unreachable → BOTTOM.
      return { narrowedType: NEVER_TYPE, excludedTypes: excluded };
    }
    return { narrowedType: createUnionType(kept), excludedTypes: excluded };
  }

  /**
   * Get the types that are incompatible with a given expected type
   */
  getIncompatibleTypes(actualType: UcodeDataType, expectedType: UcodeType): SingleType[] {
    const actualTypes = getUnionTypes(actualType);
    return actualTypes.filter(type => !this.isTypeCompatible(type, expectedType));
  }

  /**
   * Check if an actual type is assignable to an expected type
   */
  isSubtype(actualType: UcodeDataType, expectedType: UcodeType): boolean {
    const actualTypes = getUnionTypes(actualType);
    return actualTypes.every(t => this.isTypeCompatible(t, expectedType));
  }

  /**
   * Check if an actual type is assignable to any of the expected union types
   */
  isSubtypeOfUnion(actualType: UcodeDataType, expectedTypes: SingleType[]): boolean {
    if (!expectedTypes || expectedTypes.length === 0) {
      return false;
    }

    const actualTypes = getUnionTypes(actualType);
    // Compare base types so a refined member (ArrayType `array<integer>`) still
    // counts as a subtype of the bare expected type ("array").
    const allowedBases = new Set(expectedTypes.map(singleTypeToBase));

    return actualTypes.every(actual => allowedBases.has(singleTypeToBase(actual)));
  }

  /**
   * Check if a single type is compatible with an expected type
   */
  private isTypeCompatible(actualType: SingleType, expectedType: UcodeType): boolean {
    // Resolve refined types (ObjectType, ArrayType) to their base UcodeType
    const actualBase = singleTypeToBase(actualType);

    if (actualBase === expectedType) return true;
    if (expectedType === UcodeType.UNKNOWN) return true;
    if (actualBase === UcodeType.UNKNOWN) return true;
    // ANY is never produced as a DECLARED/expected type in practice (only json()/
    // call() return VALUES are ANY), but treat it symmetrically with UNKNOWN here
    // too — it's the same top type for check purposes, just display-distinct.
    if (expectedType === UcodeType.ANY) return true;

    // Allow integer to double conversion
    if (actualBase === UcodeType.INTEGER && expectedType === UcodeType.DOUBLE) return true;

    // NOTE: array and object are NOT interchangeable here. The `in` operator
    // (the only context where either is acceptable) checks both types explicitly
    // via `isSubtype(x, OBJECT) || isSubtype(x, ARRAY)`, so it doesn't need this
    // to be lenient. Treating them as compatible would suppress real type errors
    // like `keys([1,2,3])` / `push({}, 1)` (the runtime returns null for those).

    return false;
  }

  /**
   * Check if a union type contains null
   */
  containsNull(type: UcodeDataType): boolean {
    const types = getUnionTypes(type);
    return types.some(t => singleTypeToBase(t) === UcodeType.NULL);
  }

  /**
   * Check if a union type contains a specific type
   */
  containsType(type: UcodeDataType, searchType: UcodeType): boolean {
    const types = getUnionTypes(type);
    return types.some(t => singleTypeToBase(t) === searchType);
  }

  /**
   * Get human-readable description of type incompatibility
   */
  getIncompatibilityDescription(actualType: UcodeDataType, expectedType: UcodeType): string {
    const incompatibleTypes = this.getIncompatibleTypes(actualType, expectedType);

    if (incompatibleTypes.length === 0) {
      return ''; // No incompatibility
    }

    // Convert SingleType values to display strings
    const typeNames = incompatibleTypes.map(t => {
      if (typeof t === 'string') return t;
      if (isObjectType(t)) return t.name;
      if (isArrayType(t)) return 'array';
      return 'unknown';
    });

    if (typeNames.length === 1) {
      return `Argument is possibly '${typeNames[0]}', expected '${expectedType}'`;
    }

    return `Argument is possibly '${typeNames.join("' or '")}', expected '${expectedType}'`;
  }

  /**
   * Check if type requires null checking before use with operators
   */
  requiresNullCheck(type: UcodeDataType, operation: 'in' | 'dot' | 'call'): boolean {
    // The `in` operator is null-safe: `'x' in null` → false (no throw), so a nullable right
    // side never needs a guard. Only `.`/call throw on null. (Verified vs the interpreter.)
    if (operation === 'in') {
      return false;
    }
    if (!this.containsNull(type)) {
      return false;
    }

    // If the type is ONLY null, don't suggest null check (it's always null)
    const types = getUnionTypes(type);
    return types.length > 1; // Only suggest null check if there are other types too
  }

}
