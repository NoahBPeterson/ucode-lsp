/**
 * Logical operator type inference based on actual ucode runtime behavior
 * 
 * Key findings from runtime analysis:
 * - OR (||): returns left operand if truthy, otherwise right operand
 * - AND (&&): returns left operand if falsy, otherwise right operand
 * - Both preserve the exact type of the returned operand
 */

import { UcodeType, type UcodeDataType, type SingleType, createUnionType, getUnionTypes, singleTypeToBase } from './symbolTable';

export class LogicalTypeInference {

  /**
   * Determine if a type is definitely always falsy
   */
  private isDefinitelyFalsy(type: SingleType): boolean {
    // null is the only type that can only ever be falsy.
    return singleTypeToBase(type) === UcodeType.NULL;
  }

  /**
   * Determine if a type is definitely always truthy
   */
  private isDefinitelyTruthy(type: SingleType): boolean {
    // arrays, objects, functions and regexes are always truthy in ucode — even
    // when empty (`[] || x` returns the array). Compare the *base* type so the
    // refined forms (ArrayType `array<T>`, ObjectType, ModuleType) are caught too,
    // not just the bare enum values.
    const base = singleTypeToBase(type);
    return base === UcodeType.ARRAY ||
           base === UcodeType.OBJECT ||
           base === UcodeType.FUNCTION ||
           base === UcodeType.REGEX;
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
    const rightTypes = getUnionTypes(rightFullType);
    const resultTypes: SingleType[] = [];

    for (const lt of getUnionTypes(leftFullType)) {
      if (this.isDefinitelyTruthy(lt)) {
        // Always truthy → || always returns the left operand.
        resultTypes.push(lt);
      } else if (this.isDefinitelyFalsy(lt)) {
        // Always falsy → || always returns the right operand.
        resultTypes.push(...rightTypes);
      } else {
        // Could be either → either operand may be returned.
        resultTypes.push(lt, ...rightTypes);
      }
    }

    // createUnionType deduplicates, collapses to the bare type for a single
    // member, and to UNKNOWN when empty — so no further special-casing here.
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
    const rightTypes = getUnionTypes(rightFullType);
    const resultTypes: SingleType[] = [];

    for (const lt of getUnionTypes(leftFullType)) {
      if (this.isDefinitelyFalsy(lt)) {
        // Always falsy → && always returns the left operand.
        resultTypes.push(lt);
      } else if (this.isDefinitelyTruthy(lt)) {
        // Always truthy → && always returns the right operand.
        resultTypes.push(...rightTypes);
      } else {
        // Could be either → either operand may be returned.
        resultTypes.push(lt, ...rightTypes);
      }
    }

    // createUnionType deduplicates, collapses to the bare type for a single
    // member, and to UNKNOWN when empty — so no further special-casing here.
    return createUnionType(resultTypes);
  }
}

export const logicalTypeInference = new LogicalTypeInference();