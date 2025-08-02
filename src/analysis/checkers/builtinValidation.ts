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

  validateSplitFunction(node: CallExpressionNode): boolean {
    if (node.arguments.length < 2 || node.arguments.length > 3) {
      this.errors.push({
        message: `Function 'split' expects 2-3 arguments, got ${node.arguments.length}`,
        start: node.start,
        end: node.end,
        severity: 'error'
      });
      return true;
    }

    const textArg = node.arguments[0];
    const separatorArg = node.arguments[1];
    
    if (textArg) {
      const textType = this.getNodeType(textArg);
      
      if (textType !== UcodeType.STRING && textType !== UcodeType.UNKNOWN) {
        this.errors.push({
          message: `Function 'split' expects string as first argument, got ${textType}`,
          start: textArg.start,
          end: textArg.end,
          severity: 'error'
        });
      }
    }

    if (separatorArg) {
      const separatorType = this.getNodeType(separatorArg);
      
      // In ucode, split() can accept string or regex pattern as separator
      if (separatorType !== UcodeType.STRING && separatorType !== UcodeType.OBJECT && separatorType !== UcodeType.UNKNOWN) {
        this.errors.push({
          message: `Function 'split' expects string or regex pattern as second argument, got ${separatorType}`,
          start: separatorArg.start,
          end: separatorArg.end,
          severity: 'error'
        });
      }
    }

    // Optional third argument (limit) should be a number
    if (node.arguments.length === 3) {
      const limitArg = node.arguments[2];
      if (limitArg) {
        const limitType = this.getNodeType(limitArg);
        
        if (limitType !== UcodeType.INTEGER && limitType !== UcodeType.UNKNOWN) {
          this.errors.push({
            message: `Function 'split' expects integer as third argument, got ${limitType}`,
            start: limitArg.start,
            end: limitArg.end,
            severity: 'error'
          });
        }
      }
    }

    return true;
  }

  validateReplaceFunction(node: CallExpressionNode): boolean {
    if (node.arguments.length !== 3) {
      this.errors.push({
        message: `Function 'replace' expects 3 arguments, got ${node.arguments.length}`,
        start: node.start,
        end: node.end,
        severity: 'error'
      });
      return true;
    }

    const textArg = node.arguments[0];
    const searchArg = node.arguments[1];
    const replacementArg = node.arguments[2];
    
    if (textArg) {
      const textType = this.getNodeType(textArg);
      
      if (textType !== UcodeType.STRING && textType !== UcodeType.UNKNOWN) {
        this.errors.push({
          message: `Function 'replace' expects string as first argument, got ${textType}`,
          start: textArg.start,
          end: textArg.end,
          severity: 'error'
        });
      }
    }

    if (searchArg) {
      const searchType = this.getNodeType(searchArg);
      
      // In ucode, replace() can accept string or regex pattern as search parameter
      if (searchType !== UcodeType.STRING && searchType !== UcodeType.OBJECT && searchType !== UcodeType.UNKNOWN) {
        this.errors.push({
          message: `Function 'replace' expects string or regex pattern as second argument, got ${searchType}`,
          start: searchArg.start,
          end: searchArg.end,
          severity: 'error'
        });
      }
    }

    if (replacementArg) {
      const replacementType = this.getNodeType(replacementArg);
      
      // Third argument should be string or function
      if (replacementType !== UcodeType.STRING && replacementType !== UcodeType.FUNCTION && replacementType !== UcodeType.UNKNOWN) {
        this.errors.push({
          message: `Function 'replace' expects string or function as third argument, got ${replacementType}`,
          start: replacementArg.start,
          end: replacementArg.end,
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