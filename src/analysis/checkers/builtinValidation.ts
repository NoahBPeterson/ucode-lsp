/**
 * Built-in function validation for ucode semantic analysis
 */

import { CallExpressionNode } from '../../ast/nodes';
import { UcodeType } from '../symbolTable';
import { TypeError } from '../types';

export class BuiltinValidator {
  private errors: TypeError[] = [];

  constructor() {}

  validateLengthFunction(node: CallExpressionNode): boolean {
    if (node.arguments.length !== 1) {
      this.errors.push({
        message: `Function 'length' expects 1 argument, got ${node.arguments.length}`,
        start: node.start,
        end: node.end,
        severity: 'error'
      });
      return true;
    }

    const arg = node.arguments[0];
    if (!arg) return true;

    const actualType = this.getNodeType(arg);
    
    if (actualType !== UcodeType.STRING && actualType !== UcodeType.ARRAY && actualType !== UcodeType.OBJECT && actualType !== UcodeType.UNKNOWN) {
      this.errors.push({
        message: `Function 'length' expects string, array, or object, got ${actualType}`,
        start: arg.start,
        end: arg.end,
        severity: 'error'
      });
    }

    return true;
  }

  validateIndexFunction(node: CallExpressionNode): boolean {
    if (node.arguments.length !== 2) {
      this.errors.push({
        message: `Function 'index' expects 2 arguments, got ${node.arguments.length}`,
        start: node.start,
        end: node.end,
        severity: 'error'
      });
      return true;
    }

    const haystackArg = node.arguments[0];
    const needleArg = node.arguments[1];
    
    if (haystackArg) {
      const haystackType = this.getNodeType(haystackArg);
      
      if (haystackType !== UcodeType.STRING && haystackType !== UcodeType.ARRAY && haystackType !== UcodeType.UNKNOWN) {
        this.errors.push({
          message: `Function 'index' expects string or array as first argument, got ${haystackType}`,
          start: haystackArg.start,
          end: haystackArg.end,
          severity: 'error'
        });
      }
    }

    if (needleArg) {
      // Second argument (needle) can be any type
      this.getNodeType(needleArg);
    }

    return true;
  }

  validateRindexFunction(node: CallExpressionNode): boolean {
    if (node.arguments.length !== 2) {
      this.errors.push({
        message: `Function 'rindex' expects 2 arguments, got ${node.arguments.length}`,
        start: node.start,
        end: node.end,
        severity: 'error'
      });
      return true;
    }

    const haystackArg = node.arguments[0];
    const needleArg = node.arguments[1];
    
    if (haystackArg) {
      const haystackType = this.getNodeType(haystackArg);
      
      if (haystackType !== UcodeType.STRING && haystackType !== UcodeType.UNKNOWN) {
        this.errors.push({
          message: `Function 'rindex' expects string as first argument, got ${haystackType}`,
          start: haystackArg.start,
          end: haystackArg.end,
          severity: 'error'
        });
      }
    }

    if (needleArg) {
      // Second argument (needle) can be any type
      this.getNodeType(needleArg);
    }

    return true;
  }

  validateMatchFunction(node: CallExpressionNode): boolean {
    if (node.arguments.length !== 2) {
      this.errors.push({
        message: `Function 'match' expects 2 arguments, got ${node.arguments.length}`,
        start: node.start,
        end: node.end,
        severity: 'error'
      });
      return true;
    }

    const textArg = node.arguments[0];
    const patternArg = node.arguments[1];
    
    if (textArg) {
      const textType = this.getNodeType(textArg);
      
      if (textType !== UcodeType.STRING && textType !== UcodeType.UNKNOWN) {
        this.errors.push({
          message: `Function 'match' expects string as first argument, got ${textType}`,
          start: textArg.start,
          end: textArg.end,
          severity: 'error'
        });
      }
    }

    if (patternArg) {
      const patternType = this.getNodeType(patternArg);
      
      // In ucode, match() can accept string or regex pattern
      if (patternType !== UcodeType.STRING && patternType !== UcodeType.OBJECT && patternType !== UcodeType.UNKNOWN) {
        this.errors.push({
          message: `Function 'match' expects string or regex pattern as second argument, got ${patternType}`,
          start: patternArg.start,
          end: patternArg.end,
          severity: 'error'
        });
      }
    }

    return true;
  }

  getErrors(): TypeError[] {
    return this.errors;
  }

  resetErrors(): void {
    this.errors = [];
  }

  // This method should be implemented by the type checker that uses this validator
  private getNodeType(_node: any): UcodeType {
    // This will be injected by the main type checker
    return UcodeType.UNKNOWN;
  }

  // Method to inject the type checker
  setTypeChecker(typeChecker: (node: any) => UcodeType): void {
    this.getNodeType = typeChecker;
  }
}