/**
 * Debug module type definitions and function signatures
 * Based on ucode/lib/debug.c
 */

export interface DebugFunctionSignature {
  name: string;
  parameters: Array<{
    name: string;
    type: string;
    optional?: boolean;
    defaultValue?: any;
  }>;
  returnType: string;
  description: string;
}

export const debugFunctions: Map<string, DebugFunctionSignature> = new Map([
  ["memdump", {
    name: "memdump",
    parameters: [
      {
        name: "file",
        type: "string | module:fs.file | module:fs.proc",
        optional: false
      }
    ],
    returnType: "boolean | null",
    description: "Write a memory dump report to the given file. Returns `true` if the report has been written, `null` if the file could not be opened or if the handle was invalid."
  }],
  
  ["traceback", {
    name: "traceback",
    parameters: [
      {
        name: "level",
        type: "number",
        optional: true,
        defaultValue: 1
      }
    ],
    returnType: "module:debug.StackTraceEntry[]",
    description: "Capture call stack trace. The optional level parameter controls how many calls up the trace should start. Returns an array of stack trace entries describing the function invocations up to the point where `traceback()` is called."
  }],
  
  ["sourcepos", {
    name: "sourcepos",
    parameters: [],
    returnType: "module:debug.SourcePosition | null",
    description: "Obtain information about the current source position. Returns a dictionary containing the filename, line number and line byte offset of the call site. Returns `null` if this function was invoked from C code."
  }],
  
  ["getinfo", {
    name: "getinfo",
    parameters: [
      {
        name: "value",
        type: "any",
        optional: false
      }
    ],
    returnType: "module:debug.ValueInformation | null",
    description: "Obtain information about the given value. Allows querying internal information about the given ucode value, such as the current reference count, the mark bit state etc. Returns a dictionary with value type specific details."
  }],
  
  ["getlocal", {
    name: "getlocal",
    parameters: [
      {
        name: "level",
        type: "number",
        optional: true,
        defaultValue: 1
      },
      {
        name: "variable",
        type: "string | number",
        optional: false
      }
    ],
    returnType: "module:debug.LocalInfo | null",
    description: "Obtain local variable. Retrieves information about the specified local variable at the given call stack depth. The variable to query might be either specified by name or by its index."
  }],
  
  ["setlocal", {
    name: "setlocal",
    parameters: [
      {
        name: "level",
        type: "number",
        optional: true,
        defaultValue: 1
      },
      {
        name: "variable",
        type: "string | number",
        optional: false
      },
      {
        name: "value",
        type: "any",
        optional: true,
        defaultValue: null
      }
    ],
    returnType: "module:debug.LocalInfo | null",
    description: "Set local variable. Manipulates the value of the specified local variable at the given call stack depth. The variable to update might be either specified by name or by its index."
  }],
  
  ["getupval", {
    name: "getupval",
    parameters: [
      {
        name: "target",
        type: "function | number",
        optional: false
      },
      {
        name: "variable",
        type: "string | number",
        optional: false
      }
    ],
    returnType: "module:debug.UpvalInfo | null",
    description: "Obtain captured variable (upvalue). Retrieves information about the specified captured variable associated with the given function value or the invoked function at the given call stack depth."
  }],
  
  ["setupval", {
    name: "setupval",
    parameters: [
      {
        name: "target",
        type: "function | number",
        optional: false
      },
      {
        name: "variable",
        type: "string | number",
        optional: false
      },
      {
        name: "value",
        type: "any",
        optional: false
      }
    ],
    returnType: "module:debug.UpvalInfo | null",
    description: "Set upvalue. Manipulates the value of the specified captured variable associated with the given function value or the invoked function at the given call stack depth."
  }]
]);

export class DebugTypeRegistry {
  /**
   * Get function signature for a debug function
   */
  getFunction(name: string): DebugFunctionSignature | undefined {
    return debugFunctions.get(name);
  }

  /**
   * Get all available debug function names
   */
  getFunctionNames(): string[] {
    return Array.from(debugFunctions.keys());
  }

  /**
   * Check if a function name is a debug function
   */
  isDebugFunction(name: string): boolean {
    return debugFunctions.has(name);
  }

  /**
   * Format function signature for hover display
   */
  formatFunctionSignature(name: string): string {
    const func = this.getFunction(name);
    if (!func) return name;

    const params = func.parameters.map(param => {
      let paramStr = `${param.name}: ${param.type}`;
      if (param.optional) {
        paramStr = `[${paramStr}]`;
        if (param.defaultValue !== undefined) {
          paramStr += ` = ${param.defaultValue}`;
        }
      }
      return paramStr;
    }).join(', ');

    return `${name}(${params}): ${func.returnType}`;
  }

  /**
   * Get function documentation for hover display
   */
  getFunctionDocumentation(name: string): string {
    const func = this.getFunction(name);
    if (!func) return `Debug function: ${name}`;

    let doc = `**${this.formatFunctionSignature(name)}**\n\n`;
    doc += func.description;

    if (func.parameters.length > 0) {
      doc += '\n\n**Parameters:**\n';
      func.parameters.forEach(param => {
        doc += `- \`${param.name}\` (${param.type})`;
        if (param.optional) doc += ' *optional*';
        if (param.defaultValue !== undefined) doc += ` *default: ${param.defaultValue}*`;
        doc += '\n';
      });
    }

    return doc;
  }
}

export const debugTypeRegistry = new DebugTypeRegistry();