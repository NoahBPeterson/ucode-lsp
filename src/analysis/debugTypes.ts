/**
 * Debug module type definitions and function signatures
 * Based on ucode/lib/debug.c
 */

import type { FunctionSignature } from './moduleTypes';
import type { ModuleDefinition } from './registryFactory';
import { formatFunctionDoc, formatFunctionSignature } from './registryFactory';

const functions = new Map<string, FunctionSignature>([
  ["memdump", {
    name: "memdump",
    parameters: [
      { name: "file", type: "string | module:fs.file | module:fs.proc", optional: false }
    ],
    returnType: "boolean | null",
    description: "Write a memory dump report to the given file. Returns `true` if the report has been written, `null` if the file could not be opened or if the handle was invalid."
  }],
  ["traceback", {
    name: "traceback",
    parameters: [
      { name: "level", type: "number", optional: true, defaultValue: 1 }
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
      { name: "value", type: "any", optional: false }
    ],
    returnType: "module:debug.ValueInformation | null",
    description: "Obtain information about the given value. Allows querying internal information about the given ucode value, such as the current reference count, the mark bit state etc. Returns a dictionary with value type specific details."
  }],
  ["getlocal", {
    name: "getlocal",
    parameters: [
      { name: "level", type: "number", optional: true, defaultValue: 1 },
      { name: "variable", type: "string | number", optional: false }
    ],
    returnType: "module:debug.LocalInfo | null",
    description: "Obtain local variable. Retrieves information about the specified local variable at the given call stack depth. The variable to query might be either specified by name or by its index."
  }],
  ["setlocal", {
    name: "setlocal",
    parameters: [
      { name: "level", type: "number", optional: true, defaultValue: 1 },
      { name: "variable", type: "string | number", optional: false },
      { name: "value", type: "any", optional: true, defaultValue: null }
    ],
    returnType: "module:debug.LocalInfo | null",
    description: "Set local variable. Manipulates the value of the specified local variable at the given call stack depth. The variable to update might be either specified by name or by its index."
  }],
  ["getupval", {
    name: "getupval",
    parameters: [
      { name: "target", type: "function | number", optional: false },
      { name: "variable", type: "string | number", optional: false }
    ],
    returnType: "module:debug.UpvalInfo | null",
    description: "Obtain captured variable (upvalue). Retrieves information about the specified captured variable associated with the given function value or the invoked function at the given call stack depth."
  }],
  ["setupval", {
    name: "setupval",
    parameters: [
      { name: "target", type: "function | number", optional: false },
      { name: "variable", type: "string | number", optional: false },
      { name: "value", type: "any", optional: false }
    ],
    returnType: "module:debug.UpvalInfo | null",
    description: "Set upvalue. Manipulates the value of the specified captured variable associated with the given function value or the invoked function at the given call stack depth."
  }]
]);

export const debugModule: ModuleDefinition = {
  name: 'debug',
  functions,
  documentation: `## Debug Module

**Runtime debug functionality for ucode scripts**

The debug module provides comprehensive debugging and introspection capabilities for ucode applications.

### Usage

**Named import syntax:**
\`\`\`ucode
import { memdump, traceback } from 'debug';

let stacktrace = traceback(1);
memdump("/tmp/dump.txt");
\`\`\`

**Namespace import syntax:**
\`\`\`ucode
import * as debug from 'debug';

let stacktrace = debug.traceback(1);
debug.memdump("/tmp/dump.txt");
\`\`\`

### Available Functions

- **\`memdump()\`** - Write memory dump report to file
- **\`traceback()\`** - Generate stack trace from execution point
- **\`sourcepos()\`** - Get current source position information
- **\`getinfo()\`** - Get detailed information about a value
- **\`getlocal()\`** - Get the value of a local variable
- **\`setlocal()\`** - Set the value of a local variable
- **\`getupval()\`** - Get the value of an upvalue (closure variable)
- **\`setupval()\`** - Set the value of an upvalue (closure variable)

### Environment Variables

- **\`UCODE_DEBUG_MEMDUMP_ENABLED\`** - Enable/disable automatic memory dumps (default: enabled)
- **\`UCODE_DEBUG_MEMDUMP_SIGNAL\`** - Signal for triggering memory dumps (default: SIGUSR2)
- **\`UCODE_DEBUG_MEMDUMP_PATH\`** - Output directory for memory dumps (default: /tmp)

*Hover over individual function names for detailed parameter and return type information.*`,
  importValidation: {
    isValid: () => true,
    getValidImports: () => Array.from(functions.keys()),
  },
};

// Backwards compatibility
export const debugTypeRegistry = {
  getFunctionNames: () => Array.from(functions.keys()),
  getFunction: (name: string) => functions.get(name),
  isDebugFunction: (name: string) => functions.has(name),
  formatFunctionSignature: (name: string) => {
    const func = functions.get(name);
    if (!func) return '';
    return formatFunctionSignature('debug', func);
  },
  getFunctionDocumentation: (name: string) => {
    const func = functions.get(name);
    if (!func) return '';
    return formatFunctionDoc('debug', func);
  },
};
