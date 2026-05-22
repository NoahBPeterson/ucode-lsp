/**
 * Type compatibility checker for ucode
 */

import { UcodeType, UcodeDataType, createUnionType, getUnionTypes } from '../symbolTable';

export class TypeCompatibilityChecker {
  
  isNumericType(type: UcodeType): boolean {
    return type === UcodeType.INTEGER || type === UcodeType.DOUBLE;
  }

  // Check if type can be used in arithmetic operations (includes boolean coercion to integer)
  isArithmeticType(type: UcodeType): boolean {
    return type === UcodeType.INTEGER || type === UcodeType.DOUBLE || type === UcodeType.BOOLEAN;
  }

  getComparisonResultType(): UcodeType {
    return UcodeType.BOOLEAN;
  }

  getBitwiseResultType(): UcodeType {
    return UcodeType.INTEGER;
  }

  getUnaryResultType(operandType: UcodeType, operator: string): UcodeType {
    switch (operator) {
      case '+':
      case '-':
      case '++':
      case '--':
        // Numeric conversion (verified against the runtime — none of these throw,
        // and ++/-- coerce identically to unary +/-):
        //   unknown → unknown; int/double keep their kind; bool → int (0/1);
        //   null → int (coerces to 0); string → numeric (int for "42", double for
        //   "abc" — approximated as double); array/object/etc → NaN → double.
        if (operandType === UcodeType.UNKNOWN) return UcodeType.UNKNOWN;
        if (this.isArithmeticType(operandType)) {
          return operandType === UcodeType.BOOLEAN ? UcodeType.INTEGER : operandType;
        }
        if (operandType === UcodeType.NULL) return UcodeType.INTEGER;
        // string / array / object / function / regex all convert to a number
        // (NaN for the non-string ones); the result is always a numeric type.
        return UcodeType.DOUBLE;
      case '!':
        // Logical NOT can be applied to any type (truthy/falsy evaluation)
        return UcodeType.BOOLEAN;
      case '~':
        // Bitwise complement forces an integer conversion for EVERY operand type
        // (~null, ~"x", ~[1], ~{} all yield an integer at runtime), so the result
        // is always integer. Only a genuinely unknown operand stays unknown.
        if (operandType === UcodeType.UNKNOWN) return UcodeType.UNKNOWN;
        return UcodeType.INTEGER;
      default:
        return UcodeType.UNKNOWN;
    }
  }

  isValidCallTarget(type: UcodeType): boolean {
    return type === UcodeType.FUNCTION || type === UcodeType.UNKNOWN;
  }

  getObjectPropertyType(objectType: UcodeType): UcodeType {
    if (objectType === UcodeType.OBJECT) {
      return UcodeType.UNKNOWN; // Object properties can be any type
    }
    return UcodeType.UNKNOWN;
  }

  getTernaryResultType(consequentType: UcodeType, alternateType: UcodeType): UcodeDataType {
    if (consequentType === alternateType) {
      return consequentType;
    }
    
    // Create union type for different types
    return createUnionType([consequentType, alternateType]);
  }

  getCommonType(types: UcodeDataType[]): UcodeDataType {
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
    const allNumeric = validTypes.every(t => this.isNumericType(t as UcodeType));
    if (allNumeric) {
      return validTypes.some(t => t === UcodeType.DOUBLE) ? UcodeType.DOUBLE : UcodeType.INTEGER;
    }

    // For truly mixed types, create a union — flattening any union inputs into
    // their members so a branch that itself returns a union (e.g. `int | null`)
    // doesn't produce a nested union.
    return createUnionType(validTypes.flatMap(t => getUnionTypes(t)));
  }
}