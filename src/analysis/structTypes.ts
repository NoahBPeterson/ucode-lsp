/**
 * Struct module type definitions and function signatures
 * Based on ucode/lib/struct.c
 */

import type { FunctionSignature } from './moduleTypes';
import type { ModuleDefinition } from './registryFactory';
import { formatFunctionDoc, formatFunctionSignature } from './registryFactory';

const functions = new Map<string, FunctionSignature>([
  ["pack", {
    name: "pack",
    parameters: [
      { name: "format", type: "string", optional: false },
      { name: "values", type: "any", optional: false }
    ],
    returnType: "string",
    description: `Pack given values according to specified format. Creates a byte string containing the argument values packed according to the given format string.

**Examples:**
\`\`\`ucode
// Pack three integers as network byte order
let data = pack('!III', 1, 2, 3);

// Pack string and integer
let buffer = pack('10sI', 'hello', 12345);
\`\`\`

**Format Characters:**
- \`b\` - signed char (-128 to 127)
- \`B\` - unsigned char (0 to 255)
- \`h\` - short (2 bytes)
- \`H\` - unsigned short (2 bytes)
- \`i\` - int (4 bytes)
- \`I\` - unsigned int (4 bytes)
- \`l\` - long (4 bytes)
- \`L\` - unsigned long (4 bytes)
- \`q\` - long long (8 bytes)
- \`Q\` - unsigned long long (8 bytes)
- \`f\` - float (4 bytes)
- \`d\` - double (8 bytes)
- \`s\` - string
- \`p\` - Pascal string
- \`?\` - bool

**Byte Order:**
- \`@\` - native (default)
- \`<\` - little-endian
- \`>\` - big-endian
- \`!\` - network (big-endian)`
  }],
  ["unpack", {
    name: "unpack",
    parameters: [
      { name: "format", type: "string", optional: false },
      { name: "input", type: "string", optional: false },
      { name: "offset", type: "number", optional: true, defaultValue: 0 }
    ],
    returnType: "array",
    description: `Unpack given byte string according to specified format. Interprets a byte string according to the given format string and returns the resulting values.

**Examples:**
\`\`\`ucode
// Unpack three integers from network byte order
let values = unpack('!III', data);
print(values); // [1, 2, 3]

// Unpack with offset
let result = unpack('I', buffer, 4);
\`\`\``
  }],
  ["new", {
    name: "new",
    parameters: [
      { name: "format", type: "string", optional: false }
    ],
    returnType: "struct.instance",
    description: `Precompile format string. Returns a struct object instance useful for packing and unpacking multiple items without having to recompute the internal format each time.

**Examples:**
\`\`\`ucode
// Create reusable format
let fmt = struct.new('!III');
let data = fmt.pack(1, 2, 3);
let values = fmt.unpack(data);
\`\`\``
  }],
  ["buffer", {
    name: "buffer",
    parameters: [
      { name: "initialData", type: "string", optional: true }
    ],
    returnType: "struct.buffer",
    description: `Creates a new struct buffer instance for incremental packing and unpacking of binary data. If initial data is provided, the buffer is initialized with this content.

**Examples:**
\`\`\`ucode
// Create empty buffer
let buf = struct.buffer();
buf.put('I', 1234);
let value = buf.get('I');

// Create buffer with initial data
let buf2 = struct.buffer("\\x01\\x02\\x03\\x04");
let num = buf2.get('I');
\`\`\``
  }]
]);

export const structModule: ModuleDefinition = {
  name: 'struct',
  functions,
  documentation: `## Struct Module

**Binary data packing/unpacking module for ucode scripts**

The struct module provides routines for interpreting byte strings as packed binary data, similar to Python's struct module.

### Usage

**Named import syntax:**
\`\`\`ucode
import { pack, unpack } from 'struct';

let buffer = pack('bhl', -13, 1234, 444555666);
let values = unpack('bhl', buffer);
\`\`\`

**Namespace import syntax:**
\`\`\`ucode
import * as struct from 'struct';

let buffer = struct.pack('bhl', -13, 1234, 444555666);
let values = struct.unpack('bhl', buffer);
\`\`\`

### Available Functions

**Core functions:**
- **\`pack()\`** - Pack values into binary string according to format
- **\`unpack()\`** - Unpack binary string into values according to format
- **\`new()\`** - Create precompiled format instance for efficiency
- **\`buffer()\`** - Create struct buffer for incremental operations

### Format String Syntax

**Format characters:**
- **\`b/B\`** - signed/unsigned char (1 byte)
- **\`h/H\`** - signed/unsigned short (2 bytes)
- **\`i/I\`** - signed/unsigned int (4 bytes)
- **\`l/L\`** - signed/unsigned long (4 bytes)
- **\`q/Q\`** - signed/unsigned long long (8 bytes)
- **\`f\`** - float (4 bytes)
- **\`d\`** - double (8 bytes)
- **\`s\`** - string
- **\`?\`** - boolean

**Byte order prefixes:**
- **\`@\`** - native (default)
- **\`<\`** - little-endian
- **\`>\`** - big-endian
- **\`!\`** - network (big-endian)

*Hover over individual function names for detailed parameter and return type information.*`,
};

// Backwards compatibility
export const structTypeRegistry = {
  getFunctionNames: () => Array.from(functions.keys()),
  getFunction: (name: string) => functions.get(name),
  isStructFunction: (name: string) => functions.has(name),
  isValidImport: (name: string) => functions.has(name),
  getValidImports: () => Array.from(functions.keys()),
  formatFunctionSignature: (name: string) => {
    const func = functions.get(name);
    if (!func) return '';
    return formatFunctionSignature('struct', func);
  },
  getFunctionDocumentation: (name: string) => {
    const func = functions.get(name);
    if (!func) return '';
    return formatFunctionDoc('struct', func);
  },
};
