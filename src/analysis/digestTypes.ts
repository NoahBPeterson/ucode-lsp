/**
 * Digest module type definitions and function signatures
 * Based on ucode/lib/digest.c
 */

import type { FunctionSignature } from './moduleTypes';
import type { ModuleDefinition } from './registryFactory';
import { formatFunctionDoc, formatFunctionSignature } from './registryFactory';

const functions = new Map<string, FunctionSignature>([
  ["md5", {
    name: "md5",
    parameters: [
      { name: "str", type: "string", optional: false }
    ],
    returnType: "string | null",
    description: "Calculates the MD5 hash of string and returns that hash. Returns `null` if a non-string argument is given."
  }],
  ["sha1", {
    name: "sha1",
    parameters: [
      { name: "str", type: "string", optional: false }
    ],
    returnType: "string | null",
    description: "Calculates the SHA1 hash of string and returns that hash. Returns `null` if a non-string argument is given."
  }],
  ["sha256", {
    name: "sha256",
    parameters: [
      { name: "str", type: "string", optional: false }
    ],
    returnType: "string | null",
    description: "Calculates the SHA256 hash of string and returns that hash. Returns `null` if a non-string argument is given."
  }],
  ["md5_file", {
    name: "md5_file",
    parameters: [
      { name: "path", type: "string", optional: false }
    ],
    returnType: "string | null",
    description: "Calculates the MD5 hash of a given file and returns that hash. Returns `null` if an error occurred."
  }],
  ["sha1_file", {
    name: "sha1_file",
    parameters: [
      { name: "path", type: "string", optional: false }
    ],
    returnType: "string | null",
    description: "Calculates the SHA1 hash of a given file and returns that hash. Returns `null` if an error occurred."
  }],
  ["sha256_file", {
    name: "sha256_file",
    parameters: [
      { name: "path", type: "string", optional: false }
    ],
    returnType: "string | null",
    description: "Calculates the SHA256 hash of a given file and returns that hash. Returns `null` if an error occurred."
  }],
  // Extended functions (conditional compilation)
  ["md2", {
    name: "md2",
    parameters: [
      { name: "str", type: "string", optional: false }
    ],
    returnType: "string | null",
    description: "Calculates the MD2 hash of string and returns that hash. Returns `null` if a non-string argument is given."
  }],
  ["md4", {
    name: "md4",
    parameters: [
      { name: "str", type: "string", optional: false }
    ],
    returnType: "string | null",
    description: "Calculates the MD4 hash of string and returns that hash. Returns `null` if a non-string argument is given."
  }],
  ["sha384", {
    name: "sha384",
    parameters: [
      { name: "str", type: "string", optional: false }
    ],
    returnType: "string | null",
    description: "Calculates the SHA384 hash of string and returns that hash. Returns `null` if a non-string argument is given."
  }],
  ["sha512", {
    name: "sha512",
    parameters: [
      { name: "str", type: "string", optional: false }
    ],
    returnType: "string | null",
    description: "Calculates the SHA512 hash of string and returns that hash. Returns `null` if a non-string argument is given."
  }],
  ["md2_file", {
    name: "md2_file",
    parameters: [
      { name: "path", type: "string", optional: false }
    ],
    returnType: "string | null",
    description: "Calculates the MD2 hash of a given file and returns that hash. Returns `null` if an error occurred."
  }],
  ["md4_file", {
    name: "md4_file",
    parameters: [
      { name: "path", type: "string", optional: false }
    ],
    returnType: "string | null",
    description: "Calculates the MD4 hash of a given file and returns that hash. Returns `null` if an error occurred."
  }],
  ["sha384_file", {
    name: "sha384_file",
    parameters: [
      { name: "path", type: "string", optional: false }
    ],
    returnType: "string | null",
    description: "Calculates the SHA384 hash of a given file and returns that hash. Returns `null` if an error occurred."
  }],
  ["sha512_file", {
    name: "sha512_file",
    parameters: [
      { name: "path", type: "string", optional: false }
    ],
    returnType: "string | null",
    description: "Calculates the SHA512 hash of a given file and returns that hash. Returns `null` if an error occurred."
  }]
]);

export const digestModule: ModuleDefinition = {
  name: 'digest',
  functions,
  documentation: `## Digest Module

**Cryptographic hash functions for ucode scripts**

The digest module provides secure hashing functionality using industry-standard algorithms.

### Usage

**Named import syntax:**
\`\`\`ucode
import { md5, sha256, sha1_file } from 'digest';

let hash = md5("Hello World");
let fileHash = sha256_file("/path/to/file.txt");
\`\`\`

**Namespace import syntax:**
\`\`\`ucode
import * as digest from 'digest';

let hash = digest.md5("Hello World");
let fileHash = digest.sha256_file("/path/to/file.txt");
\`\`\`

### Available Functions

**String hashing functions:**
- **\`md5()\`** - Calculate MD5 hash of string
- **\`sha1()\`** - Calculate SHA1 hash of string
- **\`sha256()\`** - Calculate SHA256 hash of string
- **\`sha384()\`** - Calculate SHA384 hash of string (extended)
- **\`sha512()\`** - Calculate SHA512 hash of string (extended)
- **\`md2()\`** - Calculate MD2 hash of string (extended)
- **\`md4()\`** - Calculate MD4 hash of string (extended)

**File hashing functions:**
- **\`md5_file()\`** - Calculate MD5 hash of file
- **\`sha1_file()\`** - Calculate SHA1 hash of file
- **\`sha256_file()\`** - Calculate SHA256 hash of file
- **\`sha384_file()\`** - Calculate SHA384 hash of file (extended)
- **\`sha512_file()\`** - Calculate SHA512 hash of file (extended)
- **\`md2_file()\`** - Calculate MD2 hash of file (extended)
- **\`md4_file()\`** - Calculate MD4 hash of file (extended)

### Notes

- Extended algorithms (MD2, MD4, SHA384, SHA512) may not be available on all systems
- All functions return \`null\` on error or invalid input
- File functions return \`null\` if the file cannot be read

*Hover over individual function names for detailed parameter and return type information.*`,
  importValidation: {
    isValid: () => true,
    getValidImports: () => Array.from(functions.keys()),
  },
};

// Backwards compatibility — old code imported digestTypeRegistry
export const digestTypeRegistry = {
  getFunctionNames: () => Array.from(functions.keys()),
  getFunction: (name: string) => functions.get(name),
  isDigestFunction: (name: string) => functions.has(name),
  formatFunctionSignature: (name: string) => {
    const func = functions.get(name);
    if (!func) return '';
    return formatFunctionSignature('digest', func);
  },
  getFunctionDocumentation: (name: string) => {
    const func = functions.get(name);
    if (!func) return '';
    return formatFunctionDoc('digest', func);
  },
};
