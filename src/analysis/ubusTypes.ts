/**
 * ubus module type definitions and function signatures
 * Based on ucode/lib/ubus.c global_fns[]
 */

import type { FunctionSignature } from './moduleTypes';
import type { ModuleDefinition, ConstantDefinition } from './registryFactory';
import { formatFunctionDoc, formatFunctionSignature } from './registryFactory';

const functions = new Map<string, FunctionSignature>([
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
    description: `Create a ubus channel connection using an existing file descriptor. Used for bidirectional communication over established connections.

**Example:**
\`\`\`ucode
import { open_channel } from 'ubus';

let chan = open_channel(fd, function(msg) {
    printf("Received: %J\\n", msg);
});
\`\`\``
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

// Backwards-compat exports
export { functions as ubusFunctions };
export type UbusFunctionSignature = FunctionSignature;
export type UbusConstantSignature = ConstantDefinition;

export const ubusConstants: Map<string, ConstantDefinition> = new Map([
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

export const ubusModule: ModuleDefinition = {
  name: 'ubus',
  functions,
  constants: ubusConstants,
  documentation: `## ubus Module

**OpenWrt unified bus communication for ucode scripts**

The ubus module provides comprehensive access to the OpenWrt unified bus (ubus) system, enabling communication with system services and daemons.

### Usage

**Named import syntax:**
\`\`\`ucode
import { connect, error } from 'ubus';

let conn = connect();
let result = conn.call('system', 'info');
if (!result) {
    print('ubus error: ', error(), '\\n');
}
\`\`\`

**Namespace import syntax:**
\`\`\`ucode
import * as ubus from 'ubus';

let conn = ubus.connect();
let result = conn.call('system', 'info');
\`\`\`

### Available Functions

- **\`error()\`** - Retrieve the last ubus error
- **\`connect()\`** - Establish connection to ubus daemon
- **\`open_channel()\`** - Create ubus channel from file descriptor
- **\`guard()\`** - Set/get global ubus exception handler

### Status Constants

STATUS_OK, STATUS_INVALID_COMMAND, STATUS_INVALID_ARGUMENT, STATUS_METHOD_NOT_FOUND, STATUS_NOT_FOUND, STATUS_NO_DATA, STATUS_PERMISSION_DENIED, STATUS_TIMEOUT, STATUS_NOT_SUPPORTED, STATUS_UNKNOWN_ERROR, STATUS_CONNECTION_FAILED, STATUS_NO_MEMORY, STATUS_PARSE_ERROR, STATUS_SYSTEM_ERROR, STATUS_CONTINUE

*Hover over individual function names for detailed parameter and return type information.*`,
};

// Backwards compatibility
export const ubusTypeRegistry = {
  getFunctionNames: () => Array.from(functions.keys()),
  getFunction: (name: string) => functions.get(name),
  isUbusFunction: (name: string) => functions.has(name),
  formatFunctionSignature: (name: string) => {
    const func = functions.get(name);
    if (!func) return '';
    return formatFunctionSignature('ubus', func);
  },
  getFunctionDocumentation: (name: string) => {
    const func = functions.get(name);
    if (!func) return '';
    return formatFunctionDoc('ubus', func);
  },
  getConstantNames: () => Array.from(ubusConstants.keys()),
  getConstant: (name: string) => ubusConstants.get(name),
  isUbusConstant: (name: string) => ubusConstants.has(name),
  getConstantDocumentation: (name: string) => {
    const constant = ubusConstants.get(name);
    if (!constant) return '';
    return `**${constant.name}** = \`${constant.value}\`\n\n*${constant.type}*\n\n${constant.description}`;
  },
  isValidImport: (name: string) => functions.has(name) || ubusConstants.has(name),
  getValidImports: () => [...Array.from(functions.keys()), ...Array.from(ubusConstants.keys())],
};
