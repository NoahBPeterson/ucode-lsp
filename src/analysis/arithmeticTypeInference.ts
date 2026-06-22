/**
 * Enhanced arithmetic type inference based on actual ucode runtime behavior
 * 
 * Key findings from runtime analysis:
 * - Addition with any string → string (concatenation)
 * - Numeric operations follow promotion rules: int + double → double
 * - Booleans coerce to integers (true=1, false=0) 
 * - null coerces to 0 in arithmetic, "null" in string concatenation
 * - Invalid operations produce NaN (double) or Infinity (double)
 */

import {
  UcodeType,
  type UcodeDataType,
  type SingleType,
  createUnionType,
  getUnionTypes,
  singleTypeToBase,
} from './symbolTable';

export class ArithmeticTypeInference {

  /**
   * Union-aware addition. Distributes `+` over every combination of the
   * operands' union members and collapses the distinct results. For example
   * `(integer | string) + integer` → `integer | string` (int+int=int,
   * string+int=string), rather than the coarse `double` the base-type-only
   * path produces by falling through to the unknown/union catch-all.
   */
  inferAdditionFullType(leftFullType: UcodeDataType, rightFullType: UcodeDataType): UcodeDataType {
    return this.distribute(leftFullType, rightFullType, (l, r) => this.inferAdditionType(l, r));
  }

  /**
   * Union-aware subtraction/multiplication/division/modulo, distributed the
   * same way as inferAdditionFullType.
   */
  inferArithmeticFullType(leftFullType: UcodeDataType, rightFullType: UcodeDataType, operator: string): UcodeDataType {
    return this.distribute(leftFullType, rightFullType, (l, r) => this.inferArithmeticType(l, r, operator));
  }

  /**
   * Apply a base-type binary operation across the cartesian product of two
   * operands' union members, returning the collapsed result (a single type
   * when all combinations agree, otherwise a union).
   */
  private distribute(
    leftFullType: UcodeDataType,
    rightFullType: UcodeDataType,
    op: (l: UcodeType, r: UcodeType) => UcodeType
  ): UcodeDataType {
    const results: SingleType[] = [];
    for (const l of getUnionTypes(leftFullType)) {
      for (const r of getUnionTypes(rightFullType)) {
        results.push(op(singleTypeToBase(l), singleTypeToBase(r)));
      }
    }
    // createUnionType deduplicates and collapses a single member to that type.
    return createUnionType(results);
  }

  /**
   * Infer the result type of addition (+) operation
   * Addition has special string concatenation behavior
   */
  inferAdditionType(leftType: UcodeType, rightType: UcodeType): UcodeType {
    // Rule 1: Any operation with string becomes string concatenation
    if (leftType === UcodeType.STRING || rightType === UcodeType.STRING) {
      return UcodeType.STRING;
    }
    
    // Rule 2: Pure numeric addition follows promotion rules
    return this.inferNumericResultType(leftType, rightType);
  }
  
  /**
   * Infer the result type of arithmetic operations (-, *, /, %)
   * These operations always attempt numeric conversion
   */
  inferArithmeticType(leftType: UcodeType, rightType: UcodeType, operator: string): UcodeType {
    // Division/modulo by null: a null divisor coerces to 0, so the operation is
    // always division-by-zero — ucode yields Infinity/NaN, both typed `double`
    // (verified against the runtime). This holds for every left operand, so it
    // must be checked before the integer-promotion rules in inferNumericResultType.
    if ((operator === '/' || operator === '%') && rightType === UcodeType.NULL) {
      return UcodeType.DOUBLE;
    }

    // All other non-addition arithmetic operations follow numeric promotion rules
    return this.inferNumericResultType(leftType, rightType);
  }
  
  /**
   * Determine the numeric result type based on operand types
   */
  private inferNumericResultType(leftType: UcodeType, rightType: UcodeType): UcodeType {
    // Rule 1: If either operand is double, result is double
    if (leftType === UcodeType.DOUBLE || rightType === UcodeType.DOUBLE) {
      return UcodeType.DOUBLE;
    }

    // Rule 2: Operations that can produce NaN or Infinity result in double
    if (this.canProduceFloatingPointSpecial(leftType, rightType)) {
      return UcodeType.DOUBLE;
    }

    // Rule 3: Valid integer operations result in integer
    if (this.areValidIntegerOperands(leftType, rightType)) {
      return UcodeType.INTEGER;
    }

    // Rule 4 (final): an UNKNOWN operand — or any combination not matched above
    // — propagates as UNKNOWN rather than guessing. Unions never reach here:
    // inferArithmeticFullType distributes them over their members first, mapping
    // each to a base type, so there is no bare-union case left to coerce to double.
    return UcodeType.UNKNOWN;
  }
  
  /**
   * Check if operands can produce NaN or Infinity (double result)
   */
  private canProduceFloatingPointSpecial(leftType: UcodeType, rightType: UcodeType): boolean {
    // String operands (except in pure addition) often produce NaN
    if (leftType === UcodeType.STRING || rightType === UcodeType.STRING) {
      return true;
    }
    
    // Array and object operands produce NaN
    if (leftType === UcodeType.ARRAY || rightType === UcodeType.ARRAY ||
        leftType === UcodeType.OBJECT || rightType === UcodeType.OBJECT) {
      return true;
    }
    
    // Function and regex operands would produce NaN
    if (leftType === UcodeType.FUNCTION || rightType === UcodeType.FUNCTION ||
        leftType === UcodeType.REGEX || rightType === UcodeType.REGEX) {
      return true;
    }
    
    return false;
  }
  
  /**
   * Check if both operands are valid for integer arithmetic
   */
  private areValidIntegerOperands(leftType: UcodeType, rightType: UcodeType): boolean {
    const validIntegerTypes = new Set([
      UcodeType.INTEGER,
      UcodeType.BOOLEAN,  // Coerces to 0/1
      UcodeType.NULL      // Coerces to 0
    ]);
    
    return validIntegerTypes.has(leftType) && validIntegerTypes.has(rightType);
  }
}

export const arithmeticTypeInference = new ArithmeticTypeInference();