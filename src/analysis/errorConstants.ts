/**
 * Centralized error codes and messages for ucode LSP diagnostics
 * Provides consistent error handling and messaging across the system
 */

export enum UcodeErrorCode {
  // Variable and identifier errors (1000-1999)
  UNDEFINED_VARIABLE = 'UC1001',
  UNDEFINED_FUNCTION = 'UC1002', 
  VARIABLE_REDECLARATION = 'UC1003',
  PARAMETER_REDECLARATION = 'UC1004',
  VARIABLE_SHADOWING = 'UC1005',
  UNUSED_VARIABLE = 'UC1006',

  // Type checking errors (2000-2999)
  TYPE_MISMATCH = 'UC2001',
  INVALID_OPERATION = 'UC2002',
  INVALID_PARAMETER_COUNT = 'UC2003',
  INVALID_PARAMETER_TYPE = 'UC2004',
  INVALID_RETURN_TYPE = 'UC2005',

  // Import/Export errors (3000-3999)
  INVALID_IMPORT = 'UC3001',
  MODULE_NOT_FOUND = 'UC3002',
  INVALID_EXPORT = 'UC3003',
  CIRCULAR_DEPENDENCY = 'UC3004',

  // Control flow errors (4000-4999)
  UNREACHABLE_CODE = 'UC4001',
  INVALID_BREAK = 'UC4002',
  INVALID_CONTINUE = 'UC4003',
  INVALID_RETURN = 'UC4004',

  // Object and property errors (5000-5999)
  INVALID_PROPERTY_ACCESS = 'UC5001',
  INVALID_METHOD_CALL = 'UC5002',
  PROPERTY_NOT_FOUND = 'UC5003',
  METHOD_NOT_FOUND = 'UC5004',

  // Syntax and parsing errors (6000-6999)
  SYNTAX_ERROR = 'UC6001',
  UNEXPECTED_TOKEN = 'UC6002',
  MISSING_SEMICOLON = 'UC6003',

  // System and internal errors (9000-9999)
  INTERNAL_ERROR = 'UC9001',
  ANALYSIS_ERROR = 'UC9002'
}

export interface ErrorDefinition {
  code: UcodeErrorCode;
  message: string;
  category: 'error' | 'warning' | 'info';
  description: string;
}

export const ERROR_DEFINITIONS: Map<UcodeErrorCode, ErrorDefinition> = new Map([
  // Variable and identifier errors
  [UcodeErrorCode.UNDEFINED_VARIABLE, {
    code: UcodeErrorCode.UNDEFINED_VARIABLE,
    message: "Undefined variable '{0}'",
    category: 'error',
    description: 'Variable is used but not declared in the current scope'
  }],
  [UcodeErrorCode.UNDEFINED_FUNCTION, {
    code: UcodeErrorCode.UNDEFINED_FUNCTION,
    message: "Undefined function '{0}'",
    category: 'error', 
    description: 'Function is called but not declared or imported'
  }],
  [UcodeErrorCode.VARIABLE_REDECLARATION, {
    code: UcodeErrorCode.VARIABLE_REDECLARATION,
    message: "Variable '{0}' is already declared in this scope",
    category: 'error',
    description: 'Variable name is already used in the current scope'
  }],
  [UcodeErrorCode.PARAMETER_REDECLARATION, {
    code: UcodeErrorCode.PARAMETER_REDECLARATION,
    message: "Parameter '{0}' is already declared in this scope", 
    category: 'error',
    description: 'Function parameter name conflicts with existing declaration'
  }],
  [UcodeErrorCode.VARIABLE_SHADOWING, {
    code: UcodeErrorCode.VARIABLE_SHADOWING,
    message: "Variable '{0}' shadows a variable from an outer scope",
    category: 'warning',
    description: 'Variable name hides a variable from a parent scope'
  }],
  [UcodeErrorCode.UNUSED_VARIABLE, {
    code: UcodeErrorCode.UNUSED_VARIABLE,
    message: "Variable '{0}' is declared but never used",
    category: 'warning',
    description: 'Variable is declared but not referenced anywhere'
  }],

  // Type checking errors  
  [UcodeErrorCode.TYPE_MISMATCH, {
    code: UcodeErrorCode.TYPE_MISMATCH,
    message: "Type mismatch: expected '{0}', got '{1}'",
    category: 'error',
    description: 'Value type does not match expected type'
  }],
  [UcodeErrorCode.INVALID_PARAMETER_COUNT, {
    code: UcodeErrorCode.INVALID_PARAMETER_COUNT,
    message: "Invalid parameter count: expected {0}, got {1}",
    category: 'error',
    description: 'Function called with wrong number of parameters'
  }],
  [UcodeErrorCode.INVALID_PARAMETER_TYPE, {
    code: UcodeErrorCode.INVALID_PARAMETER_TYPE,
    message: "Invalid parameter type for '{0}': expected '{1}', got '{2}'",
    category: 'error',
    description: 'Function parameter has incorrect type'
  }],

  // Import/Export errors
  [UcodeErrorCode.INVALID_IMPORT, {
    code: UcodeErrorCode.INVALID_IMPORT,
    message: "'{0}' is not exported by the {1} module. Available exports: {2}",
    category: 'error',
    description: 'Import name does not exist in the target module'
  }],

  // Property and method errors
  [UcodeErrorCode.INVALID_PROPERTY_ACCESS, {
    code: UcodeErrorCode.INVALID_PROPERTY_ACCESS,
    message: "Property '{0}' does not exist on type '{1}'",
    category: 'error',
    description: 'Accessing a property that does not exist on the object type'
  }],
  [UcodeErrorCode.INVALID_METHOD_CALL, {
    code: UcodeErrorCode.INVALID_METHOD_CALL,
    message: "'{0}' is not a function or method available on '{1}' type",
    category: 'error', 
    description: 'Calling a method that does not exist on the object type'
  }],

  // Control flow errors
  [UcodeErrorCode.INVALID_BREAK, {
    code: UcodeErrorCode.INVALID_BREAK,
    message: "'break' statement not within a loop or switch statement",
    category: 'error',
    description: 'Break statement used outside of valid context'
  }],
  [UcodeErrorCode.INVALID_CONTINUE, {
    code: UcodeErrorCode.INVALID_CONTINUE,
    message: "'continue' statement not within a loop statement", 
    category: 'error',
    description: 'Continue statement used outside of loop context'
  }],

  // System errors
  [UcodeErrorCode.ANALYSIS_ERROR, {
    code: UcodeErrorCode.ANALYSIS_ERROR,
    message: "Semantic analysis error: {0}",
    category: 'error',
    description: 'Internal error during semantic analysis'
  }]
]);

export class UcodeErrorConstants {
  /**
   * Get error definition by code
   */
  static getErrorDefinition(code: UcodeErrorCode): ErrorDefinition | undefined {
    return ERROR_DEFINITIONS.get(code);
  }

  /**
   * Format error message with parameters
   */
  static formatMessage(code: UcodeErrorCode, ...params: string[]): string {
    const definition = this.getErrorDefinition(code);
    if (!definition) {
      return `Unknown error: ${code}`;
    }

    let message = definition.message;
    params.forEach((param, index) => {
      message = message.replace(`{${index}}`, param);
    });
    
    return message;
  }

  /**
   * Get error code from message (for migration/compatibility)
   */
  static getCodeFromMessage(message: string): UcodeErrorCode | undefined {
    for (const [code, definition] of ERROR_DEFINITIONS.entries()) {
      // Simple check - could be made more sophisticated
      const messageParts = definition.message.split('{');
      if (messageParts.length > 0 && messageParts[0] && message.includes(messageParts[0].trim())) {
        return code;
      }
    }
    return undefined;
  }

  /**
   * Get all error codes by category
   */
  static getErrorsByCategory(category: 'error' | 'warning' | 'info'): UcodeErrorCode[] {
    return Array.from(ERROR_DEFINITIONS.entries())
      .filter(([_, def]) => def.category === category)
      .map(([code, _]) => code);
  }

  /**
   * Check if an error code represents a warning
   */
  static isWarning(code: UcodeErrorCode): boolean {
    const definition = this.getErrorDefinition(code);
    return definition?.category === 'warning' || false;
  }

  /**
   * Check if an error code represents an error
   */
  static isError(code: UcodeErrorCode): boolean {
    const definition = this.getErrorDefinition(code);
    return definition?.category === 'error' || false;
  }
}