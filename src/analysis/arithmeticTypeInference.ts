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

import { UcodeType } from './symbolTable';

export class ArithmeticTypeInference {
  
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
  inferArithmeticType(leftType: UcodeType, rightType: UcodeType, _operator: string): UcodeType {
    // All non-addition arithmetic operations follow numeric promotion rules
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

    // Rule 4: If one operand is UNKNOWN, treat the result as UNKNOWN
    // Don't assume it's a double - let it propagate as unknown
    if (leftType === UcodeType.UNKNOWN || rightType === UcodeType.UNKNOWN) {
      return UcodeType.UNKNOWN;
    }

    // Rule 5: Operations with mixed or invalid types often produce double (NaN)
    return UcodeType.DOUBLE;
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
  
  /**
   * Check if arithmetic operation is valid (won't throw error)
   */
  isValidArithmeticOperation(_leftType: UcodeType, _rightType: UcodeType, _operator: string): boolean {
    // ucode is very permissive - most operations don't throw errors, they just produce NaN
    // Only completely invalid operations (like regex arithmetic) might cause issues
    
    // For now, assume all operations are "valid" (they execute, even if producing NaN)
    return true;
  }
  
  /**
   * Get detailed explanation of arithmetic behavior
   */
  getArithmeticExplanation(leftType: UcodeType, rightType: UcodeType, operator: string): string {
    if (operator === '+') {
      if (leftType === UcodeType.STRING || rightType === UcodeType.STRING) {
        return `String concatenation: converts both operands to strings`;
      }
    }
    
    // Check for type promotions
    if (leftType === UcodeType.DOUBLE || rightType === UcodeType.DOUBLE) {
      return `Numeric promotion: result promoted to double`;
    }
    
    // Check for coercions
    const coercions = [];
    if (leftType === UcodeType.BOOLEAN) coercions.push('boolean → 0/1');
    if (rightType === UcodeType.BOOLEAN) coercions.push('boolean → 0/1');
    if (leftType === UcodeType.NULL) coercions.push('null → 0');
    if (rightType === UcodeType.NULL) coercions.push('null → 0');
    
    if (coercions.length > 0) {
      return `Type coercion: ${coercions.join(', ')}`;
    }
    
    // Check for potential NaN results
    if (this.canProduceFloatingPointSpecial(leftType, rightType)) {
      return `May produce NaN due to invalid numeric conversion`;
    }
    
    return `Standard arithmetic operation`;
  }
  
  /**
   * Get examples of arithmetic type inference
   */
  getArithmeticExamples(): Array<{
    leftType: UcodeType;
    rightType: UcodeType;
    operator: string;
    resultType: UcodeType;
    example: string;
    explanation: string;
  }> {
    return [
      // Addition examples
      {
        leftType: UcodeType.STRING,
        rightType: UcodeType.INTEGER,
        operator: '+',
        resultType: UcodeType.STRING,
        example: '"hello" + 42 → "hello42"',
        explanation: 'String concatenation'
      },
      {
        leftType: UcodeType.INTEGER,
        rightType: UcodeType.DOUBLE,
        operator: '+',
        resultType: UcodeType.DOUBLE,
        example: '42 + 3.14 → 45.14',
        explanation: 'Numeric promotion to double'
      },
      {
        leftType: UcodeType.NULL,
        rightType: UcodeType.INTEGER,
        operator: '+',
        resultType: UcodeType.INTEGER,
        example: 'null + 42 → 42',
        explanation: 'null coerces to 0'
      },
      
      // Arithmetic examples
      {
        leftType: UcodeType.STRING,
        rightType: UcodeType.INTEGER,
        operator: '-',
        resultType: UcodeType.DOUBLE,
        example: '"abc" - 5 → NaN',
        explanation: 'Invalid string conversion produces NaN'
      },
      {
        leftType: UcodeType.BOOLEAN,
        rightType: UcodeType.INTEGER,
        operator: '*',
        resultType: UcodeType.INTEGER,
        example: 'true * 5 → 5',
        explanation: 'Boolean coerces to 1'
      },
      {
        leftType: UcodeType.ARRAY,
        rightType: UcodeType.INTEGER,
        operator: '/',
        resultType: UcodeType.DOUBLE,
        example: '[1,2,3] / 2 → NaN',
        explanation: 'Array cannot convert to number'
      }
    ];
  }
}

export const arithmeticTypeInference = new ArithmeticTypeInference();