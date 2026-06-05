/**
 * Struct module type definitions and function signatures
 * Based on ucode/lib/struct.c
 */

import type { FunctionSignature } from './moduleTypes';
import type { ModuleDefinition, ObjectTypeDefinition } from './registryFactory';
import { formatFunctionDoc, formatFunctionSignature } from './registryFactory';

// struct.new() instance — mirrors ucode/lib/struct.c struct_inst_fns[].
const structInstanceMethods = new Map<string, FunctionSignature>([
  ['pack', { name: 'pack', parameters: [
      { name: 'values', type: 'any', optional: false },
    ], returnType: 'string', description: "Pack the given values into a binary string according to this struct's format." }],
  ['unpack', { name: 'unpack', parameters: [
      { name: 'input', type: 'string', optional: false },
      { name: 'offset', type: 'integer', optional: true },
    ], returnType: 'array | null', description: "Unpack values from a binary string according to this struct's format. Returns an array of values, or null on error." }],
]);

/** The compiled struct returned by struct.new(). */
export const structInstanceObjectType: ObjectTypeDefinition = {
  typeName: 'struct.instance',
  methods: structInstanceMethods,
  formatDoc: (_name: string, sig: FunctionSignature) =>
    `**struct.instance.${sig.name}()**: \`${sig.returnType}\`\n\n${sig.description}`,
};

// struct.buffer() format buffer — mirrors ucode/lib/struct.c buffer_inst_fns[].
const structBufferMethods = new Map<string, FunctionSignature>([
  ['pos', { name: 'pos', parameters: [{ name: 'offset', type: 'integer', optional: true }], returnType: 'integer | struct.buffer', description: 'Get the current read/write position, or set it when an offset is given.' }],
  ['length', { name: 'length', parameters: [], returnType: 'integer', description: 'Return the total number of bytes in the buffer.' }],
  ['start', { name: 'start', parameters: [], returnType: 'struct.buffer', description: 'Reset the position to the start of the buffer.' }],
  ['end', { name: 'end', parameters: [], returnType: 'struct.buffer', description: 'Move the position to the end of the buffer.' }],
  ['set', { name: 'set', parameters: [{ name: 'format', type: 'string', optional: false }, { name: 'values', type: 'any', optional: false }], returnType: 'struct.buffer', description: 'Write values at the current position per the format, without advancing.' }],
  ['put', { name: 'put', parameters: [{ name: 'format', type: 'string', optional: false }, { name: 'values', type: 'any', optional: false }], returnType: 'struct.buffer', description: 'Write values at the current position per the format and advance.' }],
  ['get', { name: 'get', parameters: [{ name: 'format', type: 'string', optional: false }], returnType: 'any', description: 'Read values at the current position per the format, without advancing.' }],
  ['read', { name: 'read', parameters: [{ name: 'format', type: 'string', optional: false }], returnType: 'array', description: 'Read values at the current position per the format and advance.' }],
  ['slice', { name: 'slice', parameters: [{ name: 'from', type: 'integer', optional: true }, { name: 'to', type: 'integer', optional: true }], returnType: 'string', description: 'Return a substring of the buffer between the given byte offsets.' }],
  ['pull', { name: 'pull', parameters: [{ name: 'length', type: 'integer', optional: true }], returnType: 'string', description: 'Read and return raw bytes from the current position, advancing it.' }],
]);

/** The format buffer returned by struct.buffer(). */
export const structBufferObjectType: ObjectTypeDefinition = {
  typeName: 'struct.buffer',
  methods: structBufferMethods,
  formatDoc: (_name: string, sig: FunctionSignature) =>
    `**struct.buffer.${sig.name}()**: \`${sig.returnType}\`\n\n${sig.description}`,
};

const functions = new Map<string, FunctionSignature>([
  ["pack", {
    name: "pack",
    parameters: [
      { name: "format", type: "string", optional: false },
      { name: "values", type: "any", optional: false }
    ],
    returnType: "string | null",
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
    returnType: "array | null",
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
    returnType: "struct.instance | null",
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
    returnType: "struct.buffer | null",
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
