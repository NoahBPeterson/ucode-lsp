/**
 * ubus module type definitions and function signatures
 * Based on ucode/lib/ubus.c global_fns[]
 */

export interface UbusFunctionSignature {
  name: string;
  parameters: Array<{
    name: string;
    type: string;
    optional: boolean;
    defaultValue?: any;
  }>;
  returnType: string;
  description: string;
}

export interface UbusConstantSignature {
  name: string;
  value: string | number;
  type: string;
  description: string;
}

export const ubusFunctions: Map<string, UbusFunctionSignature> = new Map([
  ["error", {
    name: "error",
    parameters: [
      { name: "numeric", type: "boolean", optional: true }
    ],
    returnType: "integer | string | null",
    description: "Retrieve the last ubus error. Returns error code as integer if numeric is true, otherwise returns formatted error message as string. Returns null if no error occurred."
  }],
  ["connect", {
    name: "connect",
    parameters: [
      { name: "socket", type: "string", optional: true },
      { name: "timeout", type: "integer", optional: true, defaultValue: 30 }
    ],
    returnType: "object",
    description: "Establish a connection to the ubus daemon. Returns a connection object that can be used for further ubus operations."
  }],
  ["open_channel", {
    name: "open_channel",
    parameters: [
      { name: "fd", type: "integer", optional: false },
      { name: "cb", type: "function", optional: true },
      { name: "disconnect_cb", type: "function", optional: true },
      { name: "timeout", type: "integer", optional: true, defaultValue: 30 }
    ],
    returnType: "object",
    description: "Create a ubus channel connection using an existing file descriptor. Used for bidirectional communication over established connections."
  }],
  ["guard", {
    name: "guard",
    parameters: [
      { name: "handler", type: "function", optional: true }
    ],
    returnType: "function | boolean",
    description: "Set or get the global ubus exception handler. If called without arguments, returns current handler. If called with a handler function, sets it as the exception handler."
  }]
]);

export const ubusConstants: Map<string, UbusConstantSignature> = new Map([
  ["STATUS_OK", {
    name: "STATUS_OK",
    value: 0,
    type: "integer",
    description: "Operation completed successfully"
  }],
  ["STATUS_INVALID_COMMAND", {
    name: "STATUS_INVALID_COMMAND",
    value: 1,
    type: "integer",
    description: "Invalid or unknown command"
  }],
  ["STATUS_INVALID_ARGUMENT", {
    name: "STATUS_INVALID_ARGUMENT",
    value: 2,
    type: "integer",
    description: "Invalid argument provided to function"
  }],
  ["STATUS_METHOD_NOT_FOUND", {
    name: "STATUS_METHOD_NOT_FOUND",
    value: 3,
    type: "integer",
    description: "Requested method not found on object"
  }],
  ["STATUS_NOT_FOUND", {
    name: "STATUS_NOT_FOUND",
    value: 4,
    type: "integer",
    description: "Requested object or resource not found"
  }],
  ["STATUS_NO_DATA", {
    name: "STATUS_NO_DATA",
    value: 5,
    type: "integer",
    description: "No data available or returned"
  }],
  ["STATUS_PERMISSION_DENIED", {
    name: "STATUS_PERMISSION_DENIED",
    value: 6,
    type: "integer",
    description: "Access denied due to insufficient permissions"
  }],
  ["STATUS_TIMEOUT", {
    name: "STATUS_TIMEOUT",
    value: 7,
    type: "integer",
    description: "Operation timed out"
  }],
  ["STATUS_NOT_SUPPORTED", {
    name: "STATUS_NOT_SUPPORTED",
    value: 8,
    type: "integer",
    description: "Operation or feature not supported"
  }],
  ["STATUS_UNKNOWN_ERROR", {
    name: "STATUS_UNKNOWN_ERROR",
    value: 9,
    type: "integer",
    description: "Unknown or unspecified error occurred"
  }],
  ["STATUS_CONNECTION_FAILED", {
    name: "STATUS_CONNECTION_FAILED",
    value: 10,
    type: "integer",
    description: "Failed to establish connection"
  }],
  ["STATUS_NO_MEMORY", {
    name: "STATUS_NO_MEMORY",
    value: 11,
    type: "integer",
    description: "Insufficient memory available"
  }],
  ["STATUS_PARSE_ERROR", {
    name: "STATUS_PARSE_ERROR",
    value: 12,
    type: "integer",
    description: "Error parsing data or message"
  }],
  ["STATUS_SYSTEM_ERROR", {
    name: "STATUS_SYSTEM_ERROR",
    value: 13,
    type: "integer",
    description: "System-level error occurred"
  }],
  ["STATUS_CONTINUE", {
    name: "STATUS_CONTINUE",
    value: -1,
    type: "integer",
    description: "Virtual status code for continuing multi-part replies"
  }],
  ["SYSTEM_OBJECT_ACL", {
    name: "SYSTEM_OBJECT_ACL",
    value: 1,
    type: "integer",
    description: "System object access control list identifier"
  }]
]);

export class UbusTypeRegistry {
  getFunctionNames(): string[] {
    return Array.from(ubusFunctions.keys());
  }

  getFunction(name: string): UbusFunctionSignature | undefined {
    return ubusFunctions.get(name);
  }

  isUbusFunction(name: string): boolean {
    return ubusFunctions.has(name);
  }

  formatFunctionSignature(name: string): string {
    const func = this.getFunction(name);
    if (!func) return '';
    
    const params = func.parameters.map(p => {
      if (p.optional && p.defaultValue !== undefined) {
        return `[${p.name}: ${p.type}] = ${p.defaultValue}`;
      } else if (p.optional) {
        return `[${p.name}: ${p.type}]`;
      } else {
        return `${p.name}: ${p.type}`;
      }
    }).join(', ');
    
    return `${name}(${params}): ${func.returnType}`;
  }

  getFunctionDocumentation(name: string): string {
    const func = this.getFunction(name);
    if (!func) return '';
    
    const signature = this.formatFunctionSignature(name);
    let doc = `**${signature}**\n\n${func.description}\n\n`;
    
    if (func.parameters.length > 0) {
      doc += '**Parameters:**\n';
      func.parameters.forEach(param => {
        const optional = param.optional ? ' (optional)' : '';
        const defaultVal = param.defaultValue !== undefined ? ` (default: ${param.defaultValue})` : '';
        doc += `- \`${param.name}\` (${param.type}${optional}${defaultVal})\n`;
      });
      doc += '\n';
    }
    
    doc += `**Returns:** \`${func.returnType}\`\n\n`;
    doc += `**Example:**\n\`\`\`ucode\nimport { ${name} } from 'ubus';\n${name}();\n\`\`\``;
    return doc;
  }

  // Constants support
  getConstantNames(): string[] {
    return Array.from(ubusConstants.keys());
  }

  getConstant(name: string): UbusConstantSignature | undefined {
    return ubusConstants.get(name);
  }

  isUbusConstant(name: string): boolean {
    return ubusConstants.has(name);
  }

  getConstantDocumentation(name: string): string {
    const constant = this.getConstant(name);
    if (!constant) return '';
    
    return `**${constant.name}** = \`${constant.value}\`\n\n*${constant.type}*\n\n${constant.description}`;
  }

  // Import validation methods
  isValidImport(name: string): boolean {
    return this.isUbusFunction(name) || this.isUbusConstant(name);
  }

  getValidImports(): string[] {
    return [...this.getFunctionNames(), ...this.getConstantNames()];
  }
}

export const ubusTypeRegistry = new UbusTypeRegistry();