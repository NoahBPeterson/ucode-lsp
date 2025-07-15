/**
 * Type compatibility checker for ucode
 */

import { UcodeType } from '../symbolTable';

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
    return false;
  }

  canPerformArithmetic(leftType: UcodeType, rightType: UcodeType): boolean {
    return this.isNumericType(leftType) && this.isNumericType(rightType);
  }

  canPerformBitwiseOp(leftType: UcodeType, rightType: UcodeType): boolean {
    return this.isIntegerType(leftType) && this.isIntegerType(rightType);
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
        return this.isNumericType(operandType) ? operandType : UcodeType.UNKNOWN;
      case '!':
        return UcodeType.BOOLEAN;
      case '~':
        return this.isIntegerType(operandType) ? UcodeType.INTEGER : UcodeType.UNKNOWN;
      case '++':
      case '--':
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

  getStringPropertyType(propertyName: string): UcodeType {
    if (propertyName === 'length') {
      return UcodeType.INTEGER;
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
}