/**
 * Type compatibility checker for ucode
 */

import { UcodeType, UcodeDataType, createUnionType } from '../symbolTable';

export class TypeCompatibilityChecker {
  
  isNumericType(type: UcodeType): boolean {
    return type === UcodeType.INTEGER || type === UcodeType.DOUBLE;
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

  isTypeCompatible(actual: UcodeType, expected: UcodeType): boolean {
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
    // Addition: numbers or string concatenation
    if (this.isNumericType(leftType) && this.isNumericType(rightType)) {
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
    // Allow arithmetic if both types are numeric OR if either type is unknown (dynamic typing)
    const leftOk = this.isNumericType(leftType) || leftType === UcodeType.UNKNOWN;
    const rightOk = this.isNumericType(rightType) || rightType === UcodeType.UNKNOWN;
    return leftOk && rightOk;
  }

  canPerformBitwiseOp(_leftType: UcodeType, _rightType: UcodeType): boolean {
    // ucode allows bitwise operations on any types with implicit conversion
    // Examples: true ^ false → 1, "lol" ^ 5 → 5
    return true;
  }

  canUseInOperator(_leftType: UcodeType, rightType: UcodeType): boolean {
    return rightType === UcodeType.OBJECT || rightType === UcodeType.ARRAY;
  }

  getArithmeticResultType(leftType: UcodeType, rightType: UcodeType, operator: string): UcodeType {
    if (operator === '+') {
      if (leftType === UcodeType.STRING || rightType === UcodeType.STRING) {
        return UcodeType.STRING;
      }
    }
    
    if (this.isNumericType(leftType) && this.isNumericType(rightType)) {
      return this.getNumericResultType(leftType, rightType);
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
        return this.isNumericType(operandType) ? operandType : UcodeType.UNKNOWN;
      case '!':
        // Logical NOT can be applied to any type (truthy/falsy evaluation)
        return UcodeType.BOOLEAN;
      case '~':
        // If operand is unknown, assume it might be integer and allow the operation
        if (operandType === UcodeType.UNKNOWN) return UcodeType.UNKNOWN;
        return this.isIntegerType(operandType) ? UcodeType.INTEGER : UcodeType.UNKNOWN;
      case '++':
      case '--':
        // If operand is unknown, assume it might be numeric and allow the operation
        if (operandType === UcodeType.UNKNOWN) return UcodeType.UNKNOWN;
        return this.isNumericType(operandType) ? operandType : UcodeType.UNKNOWN;
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

  getTernaryResultType(consequentType: UcodeType, alternateType: UcodeType): UcodeType {
    if (consequentType === alternateType) {
      return consequentType;
    }
    return UcodeType.UNKNOWN;
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