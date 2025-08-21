/**
 * Type compatibility checker for ucode
 */

import { UcodeType, UcodeDataType, createUnionType, isUnionType, getUnionTypes } from '../symbolTable';

export class TypeCompatibilityChecker {
  
  // Union type utility methods
  private isUnionTypeCompatibleWith(unionType: UcodeDataType, targetType: UcodeType): boolean {
    if (!isUnionType(unionType)) {
      return this.isTypeCompatible(unionType as UcodeType, targetType);
    }
    
    // Union type is compatible with target if ANY member type is compatible
    const unionTypes = getUnionTypes(unionType);
    return unionTypes.some(memberType => this.isTypeCompatible(memberType, targetType));
  }

  private isTypeCompatibleWithUnion(sourceType: UcodeType, unionType: UcodeDataType): boolean {
    if (!isUnionType(unionType)) {
      return this.isTypeCompatible(sourceType, unionType as UcodeType);
    }
    
    // Source type is compatible with union if it's compatible with ANY member type
    const unionTypes = getUnionTypes(unionType);
    return unionTypes.some(memberType => this.isTypeCompatible(sourceType, memberType));
  }

  private areUnionTypesCompatible(sourceUnion: UcodeDataType, targetUnion: UcodeDataType): boolean {
    if (!isUnionType(sourceUnion) || !isUnionType(targetUnion)) {
      return false;
    }
    
    // All source types must be assignable to at least one target type
    const sourceTypes = getUnionTypes(sourceUnion);
    const targetTypes = getUnionTypes(targetUnion);
    
    return sourceTypes.every(sourceType =>
      targetTypes.some(targetType => this.isTypeCompatible(sourceType, targetType))
    );
  }
  
  isNumericType(type: UcodeType): boolean {
    return type === UcodeType.INTEGER || type === UcodeType.DOUBLE;
  }

  // Check if type can be used in arithmetic operations (includes boolean coercion to integer)
  isArithmeticType(type: UcodeType): boolean {
    return type === UcodeType.INTEGER || type === UcodeType.DOUBLE || type === UcodeType.BOOLEAN;
  }

  isIntegerType(type: UcodeType): boolean {
    return type === UcodeType.INTEGER;
  }

  getNumericResultType(left: UcodeType, right: UcodeType): UcodeType {
    if (left === UcodeType.DOUBLE || right === UcodeType.DOUBLE) {
      return UcodeType.DOUBLE;
    }
    return UcodeType.INTEGER;
  }

  // Enhanced type compatibility with union type support
  isTypeCompatible(actual: UcodeType | UcodeDataType, expected: UcodeType | UcodeDataType): boolean {
    // Handle union types
    if (isUnionType(actual) && isUnionType(expected)) {
      return this.areUnionTypesCompatible(actual, expected);
    }
    
    if (isUnionType(actual)) {
      return this.isUnionTypeCompatibleWith(actual, expected as UcodeType);
    }
    
    if (isUnionType(expected)) {
      return this.isTypeCompatibleWithUnion(actual as UcodeType, expected);
    }
    
    // Convert to simple types for compatibility check
    const actualType = actual as UcodeType;
    const expectedType = expected as UcodeType;
    
    if (actualType === expectedType) return true;
    if (expectedType === UcodeType.UNKNOWN) return true;
    if (actualType === UcodeType.UNKNOWN) return true;
    
    // Allow integer to double conversion
    if (actualType === UcodeType.INTEGER && expectedType === UcodeType.DOUBLE) return true;
    
    return false;
  }

  // Legacy method for simple UcodeType compatibility
  isSimpleTypeCompatible(actual: UcodeType, expected: UcodeType): boolean {
    if (actual === expected) return true;
    if (expected === UcodeType.UNKNOWN) return true;
    if (actual === UcodeType.UNKNOWN) return true;
    
    // Allow integer to double conversion
    if (actual === UcodeType.INTEGER && expected === UcodeType.DOUBLE) return true;
    
    return false;
  }

  canAssign(leftType: UcodeType, rightType: UcodeType): boolean {
    return this.isTypeCompatible(rightType, leftType);
  }

  canAddTypes(leftType: UcodeType, rightType: UcodeType): boolean {
    // Addition: numbers (including boolean coercion) or string concatenation
    if (this.isArithmeticType(leftType) && this.isArithmeticType(rightType)) {
      return true;
    }
    if (leftType === UcodeType.STRING || rightType === UcodeType.STRING) {
      return true;
    }
    // Allow addition with unknown types (could be numeric or string concatenation)
    if (leftType === UcodeType.UNKNOWN || rightType === UcodeType.UNKNOWN) {
      return true;
    }
    return false;
  }

  canPerformArithmetic(leftType: UcodeType, rightType: UcodeType): boolean {
    // Allow arithmetic if both types are arithmetic-compatible (includes boolean coercion) OR if either type is unknown (dynamic typing)
    const leftOk = this.isArithmeticType(leftType) || leftType === UcodeType.UNKNOWN;
    const rightOk = this.isArithmeticType(rightType) || rightType === UcodeType.UNKNOWN;
    return leftOk && rightOk;
  }

  canPerformBitwiseOp(_leftType: UcodeType, _rightType: UcodeType): boolean {
    // ucode allows bitwise operations on any types with implicit conversion
    // Examples: true ^ false → 1, "lol" ^ 5 → 5
    return true;
  }

  canUseInOperator(_leftType: UcodeType, rightType: UcodeType): boolean {
    return rightType === UcodeType.OBJECT || rightType === UcodeType.ARRAY || rightType === UcodeType.UNKNOWN;
  }

  getArithmeticResultType(leftType: UcodeType, rightType: UcodeType, operator: string): UcodeType {
    if (operator === '+') {
      if (leftType === UcodeType.STRING || rightType === UcodeType.STRING) {
        return UcodeType.STRING;
      }
    }
    
    // Handle arithmetic operations with boolean coercion
    if (this.isArithmeticType(leftType) && this.isArithmeticType(rightType)) {
      // Boolean values are coerced to integers (true = 1, false = 0)
      // If either operand is a double, result is double
      // If either operand is boolean, it's treated as integer
      // So boolean + integer = integer, boolean + double = double
      if (leftType === UcodeType.DOUBLE || rightType === UcodeType.DOUBLE) {
        return UcodeType.DOUBLE;
      }
      // All other combinations (integer + integer, boolean + integer, boolean + boolean) = integer
      return UcodeType.INTEGER;
    }
    
    return UcodeType.UNKNOWN;
  }

  getComparisonResultType(): UcodeType {
    return UcodeType.BOOLEAN;
  }

  getLogicalResultType(): UcodeType {
    return UcodeType.BOOLEAN;
  }

  getBitwiseResultType(): UcodeType {
    return UcodeType.INTEGER;
  }

  getUnaryResultType(operandType: UcodeType, operator: string): UcodeType {
    switch (operator) {
      case '+':
      case '-':
        // If operand is unknown, assume it might be numeric and allow the operation
        if (operandType === UcodeType.UNKNOWN) return UcodeType.UNKNOWN;
        // Allow unary arithmetic on numeric types and booleans (booleans coerce to integers)
        if (this.isArithmeticType(operandType)) {
          // Boolean operand becomes integer, others stay the same
          return operandType === UcodeType.BOOLEAN ? UcodeType.INTEGER : operandType;
        }
        return UcodeType.UNKNOWN;
      case '!':
        // Logical NOT can be applied to any type (truthy/falsy evaluation)
        return UcodeType.BOOLEAN;
      case '~':
        // If operand is unknown, assume it might be integer and allow the operation
        if (operandType === UcodeType.UNKNOWN) return UcodeType.UNKNOWN;
        // Allow bitwise complement on integers and booleans (booleans coerce to integers)
        if (operandType === UcodeType.INTEGER || operandType === UcodeType.BOOLEAN) {
          return UcodeType.INTEGER;
        }
        return UcodeType.UNKNOWN;
      case '++':
      case '--':
        // If operand is unknown, assume it might be numeric and allow the operation
        if (operandType === UcodeType.UNKNOWN) return UcodeType.UNKNOWN;
        // Allow increment/decrement on numeric types and booleans (booleans coerce to integers)
        if (this.isArithmeticType(operandType)) {
          // Boolean operand becomes integer, others stay the same
          return operandType === UcodeType.BOOLEAN ? UcodeType.INTEGER : operandType;
        }
        return UcodeType.UNKNOWN;
      default:
        return UcodeType.UNKNOWN;
    }
  }

  isValidAssignmentTarget(nodeType: string): boolean {
    return nodeType === 'Identifier' || nodeType === 'MemberExpression';
  }

  isValidCallTarget(type: UcodeType): boolean {
    return type === UcodeType.FUNCTION || type === UcodeType.UNKNOWN;
  }

  getArrayElementType(arrayType: UcodeType): UcodeType {
    if (arrayType === UcodeType.ARRAY) {
      return UcodeType.UNKNOWN; // Array elements can be any type
    }
    return UcodeType.UNKNOWN;
  }

  getObjectPropertyType(objectType: UcodeType): UcodeType {
    if (objectType === UcodeType.OBJECT) {
      return UcodeType.UNKNOWN; // Object properties can be any type
    }
    return UcodeType.UNKNOWN;
  }

  isIterableType(type: UcodeType): boolean {
    return type === UcodeType.ARRAY || type === UcodeType.OBJECT || type === UcodeType.STRING;
  }

  getTernaryResultType(consequentType: UcodeType, alternateType: UcodeType): UcodeDataType {
    if (consequentType === alternateType) {
      return consequentType;
    }
    
    // Create union type for different types
    return createUnionType([consequentType, alternateType]);
  }

  getCommonType(types: UcodeType[]): UcodeDataType {
    if (types.length === 0) {
      return UcodeType.NULL; // No return statement means the function returns null.
    }

    // Filter out undefined types
    const validTypes = types.filter(t => t !== undefined);
    
    if (validTypes.length === 0) {
      return UcodeType.NULL;
    }

    if (validTypes.length === 1) {
      return validTypes[0] as UcodeDataType;
    }

    // For dynamic languages like ucode, we want to preserve type information
    // rather than defaulting to UNKNOWN for mixed types
    
    // Check if all types are numeric - if so, promote to the widest numeric type
    const allNumeric = validTypes.every(t => this.isNumericType(t));
    if (allNumeric) {
      return validTypes.some(t => t === UcodeType.DOUBLE) ? UcodeType.DOUBLE : UcodeType.INTEGER;
    }

    // For truly mixed types, create a union type
    return createUnionType(validTypes);
  }
}