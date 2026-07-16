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
    op: (l: UcodeType, r: UcodeType) => UcodeDataType
  ): UcodeDataType {
    const results: SingleType[] = [];
    for (const l of getUnionTypes(leftFullType)) {
      for (const r of getUnionTypes(rightFullType)) {
        // op's result may itself be a union (Rule 4 below can now return
        // `integer | double` for a genuinely-unknown operand) — flatten rather
        // than pushing a UnionType object into a SingleType[]. getUnionTypes on
        // a plain SingleType is a no-op ([type]), so this is a no-op for every
        // pre-existing single-type result.
        results.push(...getUnionTypes(op(singleTypeToBase(l), singleTypeToBase(r))));
      }
    }
    // createUnionType deduplicates and collapses a single member to that type.
    return createUnionType(results);
  }

  /**
   * Infer the result type of addition (+) operation
   * Addition has special string concatenation behavior
   */
  inferAdditionType(leftType: UcodeType, rightType: UcodeType): UcodeDataType {
    // Rule 1: Any operation with string becomes string concatenation
    if (leftType === UcodeType.STRING || rightType === UcodeType.STRING) {
      return UcodeType.STRING;
    }

    // Rule 2: Pure numeric addition follows promotion rules. `+` keeps the
    // UNKNOWN-propagates-as-UNKNOWN behavior for a genuinely unknown operand
    // (string concatenation is still a live possibility the checker can't rule
    // out) — see docs/tc-arith-unknown-operand-numeric.md, "Decide separately".
    return this.inferNumericResultType(leftType, rightType, true);
  }

  /**
   * Infer the result type of arithmetic operations (-, *, /, %)
   * These operations always attempt numeric conversion
   */
  inferArithmeticType(leftType: UcodeType, rightType: UcodeType, operator: string): UcodeDataType {
    // Division/modulo by null: a null divisor coerces to 0, so the operation is
    // always division-by-zero — ucode yields Infinity/NaN, both typed `double`
    // (verified against the runtime). This holds for every left operand, so it
    // must be checked before the integer-promotion rules in inferNumericResultType.
    if ((operator === '/' || operator === '%') && rightType === UcodeType.NULL) {
      return UcodeType.DOUBLE;
    }

    // All other non-addition arithmetic operations follow numeric promotion
    // rules. These operators have NO string-concatenation escape hatch — vm.c's
    // uc_vm_value_arith only special-cases I_ADD; every other opcode runs both
    // operands through ucv_to_number() and returns a numeric (int or double)
    // result unconditionally (vm.c ~1627-1702). So an unknown operand here is
    // NOT a guess: the runtime is guaranteed to produce integer|double.
    return this.inferNumericResultType(leftType, rightType, false);
  }

  /**
   * Determine the numeric result type based on operand types.
   * `additionMayConcat` distinguishes `+` (where a genuinely unknown operand
   * could still turn out to be a string that concatenates, so Rule 4 must
   * stay UNKNOWN) from every other arithmetic operator (where the runtime
   * guarantees a numeric result regardless of operand type, so Rule 4 can
   * soundly narrow to `integer | double`).
   */
  private inferNumericResultType(leftType: UcodeType, rightType: UcodeType, additionMayConcat: boolean): UcodeDataType {
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

    // Rule 4 (final): reaching here means at least one operand is UNKNOWN (every
    // other UcodeType is fully covered by Rules 1-3 above). Unions never reach
    // here either: inferArithmeticFullType distributes them over their members
    // first, mapping each to a base type, so there is no bare-union case left.
    //
    // For `+`, an unknown operand might still be a string (concatenation), so it
    // stays UNKNOWN (a guess would be unsound). For every other operator, vm.c
    // guarantees a numeric result no matter what the operand is (see
    // inferArithmeticType) — `integer | double` is sound and strictly more
    // useful than UNKNOWN. (docs/tc-arith-unknown-operand-numeric.md)
    if (additionMayConcat) return UcodeType.UNKNOWN;
    return createUnionType([UcodeType.INTEGER, UcodeType.DOUBLE]);
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