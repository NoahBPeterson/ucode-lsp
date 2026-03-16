/**
 * Zlib module type definitions and function signatures
 * Based on ucode/lib/zlib.c
 */

import type { FunctionSignature } from './moduleTypes';
import type { ModuleDefinition, ConstantDefinition } from './registryFactory';
import { formatFunctionDoc, formatFunctionSignature } from './registryFactory';

const functions = new Map<string, FunctionSignature>([
  ["deflate", {
    name: "deflate",
    parameters: [
      { name: "str_or_resource", type: "string | object", optional: false },
      { name: "gzip", type: "boolean", optional: true, defaultValue: false },
      { name: "level", type: "number", optional: true, defaultValue: "Z_DEFAULT_COMPRESSION" }
    ],
    returnType: "string | null",
    description: `Compresses data in Zlib or gzip format. If the input is a string, it is directly compressed. If an object/resource with a read() method is given, it will be read in chunks for incremental compression.

**Example:**
\`\`\`ucode
// deflate content using default compression
const deflated = deflate(content);

// deflate content with gzip format and fastest compression
const deflated = deflate(content, true, Z_BEST_SPEED);
\`\`\``
  }],
  ["inflate", {
    name: "inflate",
    parameters: [
      { name: "str_or_resource", type: "string | object", optional: false }
    ],
    returnType: "string | null",
    description: `Decompresses data in Zlib or gzip format. If the input is a string, it is directly decompressed. If an object/resource with a read() method is given, it will be read in chunks for incremental decompression.

**Example:**
\`\`\`ucode
// inflate compressed data
const inflated = inflate(compressed_data);
\`\`\``
  }],
  ["deflater", {
    name: "deflater",
    parameters: [
      { name: "gzip", type: "boolean", optional: true, defaultValue: false },
      { name: "level", type: "number", optional: true, defaultValue: "Z_DEFAULT_COMPRESSION" }
    ],
    returnType: "zlib.deflate | null",
    description: `Initializes a deflate stream for streaming compression. Returns a stream handle that can be used with write() and read() methods.

**Example:**
\`\`\`ucode
// create streaming deflate
const zstrmd = deflater(true, Z_BEST_SPEED);
zstrmd.write("data", Z_NO_FLUSH);
const compressed = zstrmd.read();
\`\`\``
  }],
  ["inflater", {
    name: "inflater",
    parameters: [],
    returnType: "zlib.inflate | null",
    description: `Initializes an inflate stream for streaming decompression. Can process either Zlib or gzip data. Returns a stream handle that can be used with write() and read() methods.

**Example:**
\`\`\`ucode
// create streaming inflate
const zstrmi = inflater();
zstrmi.write(compressed_data, Z_NO_FLUSH);
const decompressed = zstrmi.read();
\`\`\``
  }]
]);

// Backwards-compat exports
export { functions as zlibFunctions };
export type ZlibFunctionSignature = FunctionSignature;
export type ZlibConstantSignature = ConstantDefinition;

export const zlibConstants: Map<string, ConstantDefinition> = new Map([
  // Compression levels
  ["Z_NO_COMPRESSION", {
    name: "Z_NO_COMPRESSION",
    value: 0,
    type: "number",
    description: "No compression level - store data without compression"
  }],
  ["Z_BEST_SPEED", {
    name: "Z_BEST_SPEED",
    value: 1,
    type: "number",
    description: "Fastest compression level with minimal compression ratio"
  }],
  ["Z_BEST_COMPRESSION", {
    name: "Z_BEST_COMPRESSION",
    value: 9,
    type: "number",
    description: "Highest compression level with maximum compression ratio but slowest speed"
  }],
  ["Z_DEFAULT_COMPRESSION", {
    name: "Z_DEFAULT_COMPRESSION",
    value: -1,
    type: "number",
    description: "Default compromise between speed and compression (currently equivalent to level 6)"
  }],

  // Flush options
  ["Z_NO_FLUSH", {
    name: "Z_NO_FLUSH",
    value: 0,
    type: "number",
    description: "No flushing - accumulate data until buffer is full"
  }],
  ["Z_PARTIAL_FLUSH", {
    name: "Z_PARTIAL_FLUSH",
    value: 1,
    type: "number",
    description: "Partial flush - flush some output without closing the stream"
  }],
  ["Z_SYNC_FLUSH", {
    name: "Z_SYNC_FLUSH",
    value: 2,
    type: "number",
    description: "Sync flush - flush all pending output and align to byte boundary"
  }],
  ["Z_FULL_FLUSH", {
    name: "Z_FULL_FLUSH",
    value: 3,
    type: "number",
    description: "Full flush - flush all output and reset compression state"
  }],
  ["Z_FINISH", {
    name: "Z_FINISH",
    value: 4,
    type: "number",
    description: "Finish the stream - no more input data expected after this"
  }]
]);

export const zlibModule: ModuleDefinition = {
  name: 'zlib',
  functions,
  constants: zlibConstants,
  documentation: `## Zlib Module

**Data compression and decompression module**

The zlib module provides single-call and stream-oriented functions for interacting with zlib data compression.

### Usage

**Named import syntax:**
\`\`\`ucode
import { deflate, inflate, Z_BEST_SPEED } from 'zlib';

let compressed = deflate("Hello World", false, Z_BEST_SPEED);
let original = inflate(compressed);
\`\`\`

**Namespace import syntax:**
\`\`\`ucode
import * as zlib from 'zlib';

let compressed = zlib.deflate("Hello World");
let original = zlib.inflate(compressed);
\`\`\`

### Available Functions

- **\`deflate()\`** - Compress data in Zlib or gzip format
- **\`inflate()\`** - Decompress data in Zlib or gzip format
- **\`deflater()\`** - Create streaming deflate handle
- **\`inflater()\`** - Create streaming inflate handle

### Constants

**Compression levels:** Z_NO_COMPRESSION, Z_BEST_SPEED, Z_BEST_COMPRESSION, Z_DEFAULT_COMPRESSION

**Flush options:** Z_NO_FLUSH, Z_PARTIAL_FLUSH, Z_SYNC_FLUSH, Z_FULL_FLUSH, Z_FINISH

*Hover over individual function names for detailed parameter and return type information.*`,
};

// Backwards compatibility
export const zlibTypeRegistry = {
  getFunctionNames: () => Array.from(functions.keys()),
  getFunction: (name: string) => functions.get(name),
  isZlibFunction: (name: string) => functions.has(name),
  formatFunctionSignature: (name: string) => {
    const func = functions.get(name);
    if (!func) return '';
    return formatFunctionSignature('zlib', func);
  },
  getFunctionDocumentation: (name: string) => {
    const func = functions.get(name);
    if (!func) return '';
    return formatFunctionDoc('zlib', func);
  },
  getConstantNames: () => Array.from(zlibConstants.keys()),
  getConstant: (name: string) => zlibConstants.get(name),
  isZlibConstant: (name: string) => zlibConstants.has(name),
  getConstantDocumentation: (name: string) => {
    const constant = zlibConstants.get(name);
    if (!constant) return '';
    return `**${constant.name}** = \`${constant.value}\`\n\n*${constant.type}*\n\n${constant.description}`;
  },
  isValidImport: (name: string) => functions.has(name) || zlibConstants.has(name),
  getValidImports: () => [...Array.from(functions.keys()), ...Array.from(zlibConstants.keys())],
};
