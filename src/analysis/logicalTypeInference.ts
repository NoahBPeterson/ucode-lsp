/**
 * Logical operator type inference based on actual ucode runtime behavior
 * 
 * Key findings from runtime analysis:
 * - OR (||): returns left operand if truthy, otherwise right operand
 * - AND (&&): returns left operand if falsy, otherwise right operand
 * - Both preserve the exact type of the returned operand
 */

import { UcodeType, UcodeDataType, createUnionType, getUnionTypes } from './symbolTable';

export class LogicalTypeInference {
  
  /**
   * Determine if a type is definitely always falsy
   */
  private isDefinitelyFalsy(type: UcodeType): boolean {
    // These types can only have falsy values
    return type === UcodeType.NULL;
  }
  
  /**
   * Determine if a type is definitely always truthy
   */
  private isDefinitelyTruthy(type: UcodeType): boolean {
    // These types are always truthy in ucode
    return type === UcodeType.ARRAY ||
           type === UcodeType.OBJECT ||
           type === UcodeType.FUNCTION ||
           type === UcodeType.REGEX;
  }
  
  
  /**
   * Infer the result type of a logical OR (||) operation
   * 
   * Logic:
   * - If left is definitely truthy → returns left type
   * - If left is definitely falsy → returns right type  
   * - If left can be either → returns union of left and right types
   */
  inferLogicalOrType(leftType: UcodeType, rightType: UcodeType): UcodeDataType {
    if (this.isDefinitelyTruthy(leftType)) {
      // Left is always truthy, so always returns left operand
      return leftType as UcodeDataType;
    }

    if (this.isDefinitelyFalsy(leftType)) {
      // Left is always falsy, so always returns right operand
      return rightType as UcodeDataType;
    }

    // If left is unknown but right is known, the result is at least the right type
    // Common pattern: `expr || ''` guarantees a string fallback
    if (leftType === UcodeType.UNKNOWN && rightType !== UcodeType.UNKNOWN) {
      return rightType as UcodeDataType;
    }

    // Left can be either truthy or falsy
    if (leftType === rightType) {
      // Same types, so result is that type
      return leftType as UcodeDataType;
    }

    // Different types, could return either based on left's truthiness
    return createUnionType([leftType, rightType]);
  }
  
  /**
   * Infer the result type of a logical AND (&&) operation
   * 
   * Logic:
   * - If left is definitely falsy → returns left type
   * - If left is definitely truthy → returns right type
   * - If left can be either → returns union of left and right types
   */
  inferLogicalAndType(leftType: UcodeType, rightType: UcodeType): UcodeDataType {
    if (this.isDefinitelyFalsy(leftType)) {
      // Left is always falsy, so always returns left operand
      return leftType as UcodeDataType;
    }
    
    if (this.isDefinitelyTruthy(leftType)) {
      // Left is always truthy, so always returns right operand  
      return rightType as UcodeDataType;
    }
    
    // Left can be either truthy or falsy
    if (leftType === rightType) {
      // Same types, so result is that type
      return leftType as UcodeDataType;
    }
    
    // Different types, could return either based on left's truthiness
    return createUnionType([leftType, rightType]);
  }
  
  /**
   * Union-aware logical OR inference.
   * For `(string | string[] | null) || ''`:
   *   - null is falsy → eliminated, falls to right (string)
   *   - string can be falsy (empty) → could return left (string) or right (string)
   *   - string[] (array) is always truthy → returns left (array)
   * Result: string | array
   */
  inferLogicalOrFullType(leftFullType: UcodeDataType, rightFullType: UcodeDataType): UcodeDataType {
    // Short-circuit: if both sides are the same complex type (e.g., same module), preserve it
    if (typeof leftFullType === 'object' && typeof rightFullType === 'object' &&
        'moduleName' in leftFullType && 'moduleName' in rightFullType &&
        leftFullType.moduleName === rightFullType.moduleName) {
      return leftFullType;
    }

    const leftTypes = getUnionTypes(leftFullType);
    const rightTypes = getUnionTypes(rightFullType);

    const resultTypes: UcodeType[] = [];

    for (const lt of leftTypes) {
      if (this.isDefinitelyTruthy(lt)) {
        // Always returns left operand — add left type
        if (!resultTypes.includes(lt)) resultTypes.push(lt);
      } else if (this.isDefinitelyFalsy(lt)) {
        // Always returns right operand — add right types
        for (const rt of rightTypes) {
          if (!resultTypes.includes(rt)) resultTypes.push(rt);
        }
      } else {
        // Could be truthy or falsy — add both left and right types
        if (!resultTypes.includes(lt)) resultTypes.push(lt);
        for (const rt of rightTypes) {
          if (!resultTypes.includes(rt)) resultTypes.push(rt);
        }
      }
    }

    if (resultTypes.length === 0) return UcodeType.UNKNOWN;
    if (resultTypes.length === 1) return resultTypes[0] as UcodeDataType;
    return createUnionType(resultTypes);
  }

  /**
   * Union-aware logical AND inference.
   * For `(string | null) && expr`:
   *   - null is falsy → returns left (null)
   *   - string can be falsy → could return left (string) or right
   * Result: string | null | rightType
   */
  inferLogicalAndFullType(leftFullType: UcodeDataType, rightFullType: UcodeDataType): UcodeDataType {
    const leftTypes = getUnionTypes(leftFullType);
    const rightTypes = getUnionTypes(rightFullType);

    const resultTypes: UcodeType[] = [];

    for (const lt of leftTypes) {
      if (this.isDefinitelyFalsy(lt)) {
        // Always returns left operand — add left type
        if (!resultTypes.includes(lt)) resultTypes.push(lt);
      } else if (this.isDefinitelyTruthy(lt)) {
        // Always returns right operand — add right types
        for (const rt of rightTypes) {
          if (!resultTypes.includes(rt)) resultTypes.push(rt);
        }
      } else {
        // Could be truthy or falsy — add both left and right types
        if (!resultTypes.includes(lt)) resultTypes.push(lt);
        for (const rt of rightTypes) {
          if (!resultTypes.includes(rt)) resultTypes.push(rt);
        }
      }
    }

    if (resultTypes.length === 0) return UcodeType.UNKNOWN;
    if (resultTypes.length === 1) return resultTypes[0] as UcodeDataType;
    return createUnionType(resultTypes);
  }

  /**
   * Get common patterns for logical operator results
   */
  getLogicalOperatorExamples(): Array<{
    operation: string;
    leftType: UcodeType;
    rightType: UcodeType;
    resultType: UcodeDataType;
    explanation: string;
  }> {
    return [
      // OR examples
      {
        operation: '||',
        leftType: UcodeType.NULL,
        rightType: UcodeType.INTEGER,
        resultType: UcodeType.INTEGER,
        explanation: 'null || 42 → always returns 42 (integer)'
      },
      {
        operation: '||',
        leftType: UcodeType.ARRAY,
        rightType: UcodeType.STRING,
        resultType: UcodeType.ARRAY,
        explanation: '[] || "hello" → always returns [] (array)'
      },
      {
        operation: '||',
        leftType: UcodeType.INTEGER,
        rightType: UcodeType.STRING,
        resultType: createUnionType([UcodeType.INTEGER, UcodeType.STRING]),
        explanation: '42 || "hello" → could return either based on integer value'
      },
      
      // AND examples
      {
        operation: '&&',
        leftType: UcodeType.NULL,
        rightType: UcodeType.INTEGER,
        resultType: UcodeType.NULL,
        explanation: 'null && 42 → always returns null'
      },
      {
        operation: '&&',
        leftType: UcodeType.ARRAY,
        rightType: UcodeType.STRING,
        resultType: UcodeType.STRING,
        explanation: '[] && "hello" → always returns "hello" (string)'
      },
      {
        operation: '&&',
        leftType: UcodeType.INTEGER,
        rightType: UcodeType.STRING,
        resultType: createUnionType([UcodeType.INTEGER, UcodeType.STRING]),
        explanation: '42 && "hello" → could return either based on integer value'
      }
    ];
  }
}

export const logicalTypeInference = new LogicalTypeInference();