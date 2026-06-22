/**
 * File System Types for ucode-lsp
 * Defines fs.proc, fs.dir, and fs.file types with their respective methods
 */

import type { FunctionSignature } from './moduleTypes';
import type { ObjectTypeDefinition } from './registryFactory';
import { UcodeType, UcodeDataType } from './symbolTable';

export enum FsObjectType {
  FS_PROC = 'fs.proc',
  FS_DIR = 'fs.dir',
  FS_FILE = 'fs.file',
  FS_STATVFS = 'fs.statvfs'
}

// fs.proc methods
const procMethods = new Map<string, FunctionSignature>([
  ['read', {
    name: 'read',
    parameters: [{ name: 'amount', type: 'number | string', optional: false }],
    returnType: 'string | null',
    description: 'Read data from the process handle. Parameter can be: a number (bytes to read), "line" (read until newline), "all" (read until EOF), or a single character (read until that character). Returns a string containing the read data, empty string on EOF, or null on error.'
  }],
  ['write', {
    name: 'write',
    parameters: [{ name: 'data', type: 'any', optional: false }],
    returnType: 'integer | null',
    description: 'Write data to the process handle'
  }],
  ['close', {
    name: 'close',
    parameters: [],
    returnType: 'integer',
    description: 'Close the process handle and get exit code'
  }],
  ['flush', {
    name: 'flush',
    parameters: [],
    returnType: 'boolean | null',
    description: 'Flush buffered data'
  }],
  ['fileno', {
    name: 'fileno',
    parameters: [],
    returnType: 'integer | null',
    description: 'Get the underlying file descriptor number'
  }],
  ['error', {
    name: 'error',
    parameters: [],
    returnType: 'string',
    description: 'Get error information'
  }]
]);

// fs.dir methods
const dirMethods = new Map<string, FunctionSignature>([
  ['read', {
    name: 'read',
    parameters: [],
    returnType: 'string | null',
    description: 'Read the next directory entry. Returns null at end-of-directory or on error.'
  }],
  ['tell', {
    name: 'tell',
    parameters: [],
    returnType: 'integer | null',
    description: 'Get current read position'
  }],
  ['seek', {
    name: 'seek',
    parameters: [{ name: 'position', type: 'integer', optional: false }],
    returnType: 'boolean | null',
    description: 'Set read position'
  }],
  ['close', {
    name: 'close',
    parameters: [],
    returnType: 'boolean | null',
    description: 'Close the directory handle'
  }],
  ['fileno', {
    name: 'fileno',
    parameters: [],
    returnType: 'integer | null',
    description: 'Get the underlying file descriptor number'
  }],
  ['error', {
    name: 'error',
    parameters: [],
    returnType: 'string',
    description: 'Get error information'
  }]
]);

// fs.file methods
const fileMethods = new Map<string, FunctionSignature>([
  ['read', {
    name: 'read',
    parameters: [{ name: 'amount', type: 'number | string', optional: false }],
    returnType: 'string | null',
    description: 'Read data from the file handle. Parameter can be: a number (bytes to read), "line" (read until newline), "all" (read until EOF), or a single character (read until that character). Returns a string containing the read data, empty string on EOF, or null on error.'
  }],
  ['write', {
    name: 'write',
    parameters: [{ name: 'data', type: 'any', optional: false }],
    returnType: 'integer | null',
    description: 'Write data to the file handle'
  }],
  ['seek', {
    name: 'seek',
    parameters: [
      { name: 'offset', type: 'integer', optional: true },
      { name: 'whence', type: 'integer', optional: true }
    ],
    returnType: 'boolean | null',
    description: 'Set file read position'
  }],
  ['tell', {
    name: 'tell',
    parameters: [],
    returnType: 'integer | null',
    description: 'Get current file position'
  }],
  ['close', {
    name: 'close',
    parameters: [],
    returnType: 'boolean',
    description: 'Close the file handle'
  }],
  ['flush', {
    name: 'flush',
    parameters: [],
    returnType: 'boolean | null',
    description: 'Flush buffered data'
  }],
  ['fileno', {
    name: 'fileno',
    parameters: [],
    returnType: 'integer | null',
    description: 'Get the underlying file descriptor number'
  }],
  ['isatty', {
    name: 'isatty',
    parameters: [],
    returnType: 'boolean | null',
    description: 'Check if the file handle refers to a TTY device'
  }],
  ['truncate', {
    name: 'truncate',
    parameters: [{ name: 'offset', type: 'integer', optional: true }],
    returnType: 'boolean | null',
    description: 'Truncate file to given size'
  }],
  ['lock', {
    name: 'lock',
    parameters: [{ name: 'operation', type: 'string', optional: false }],
    returnType: 'boolean | null',
    description: 'Lock or unlock the file'
  }],
  ['error', {
    name: 'error',
    parameters: [],
    returnType: 'string',
    description: 'Get error information'
  }],
  ['ioctl', {
    name: 'ioctl',
    parameters: [
      { name: 'direction', type: 'integer', optional: false },
      { name: 'type', type: 'integer', optional: false },
      { name: 'number', type: 'integer', optional: false },
      { name: 'value', type: 'any', optional: true }
    ],
    returnType: 'any',
    description: 'Perform ioctl operation on the file (Linux only)'
  }]
]);

// Object type definitions for factory
export const fsProcObjectType: ObjectTypeDefinition = {
  typeName: 'fs.proc',
  methods: procMethods,
  formatDoc: (_name: string, sig: FunctionSignature) =>
    `**fs.proc.${sig.name}()**: \`${sig.returnType}\`\n\n${sig.description}`,
};

export const fsDirObjectType: ObjectTypeDefinition = {
  typeName: 'fs.dir',
  methods: dirMethods,
  formatDoc: (_name: string, sig: FunctionSignature) =>
    `**fs.dir.${sig.name}()**: \`${sig.returnType}\`\n\n${sig.description}`,
};

export const fsFileObjectType: ObjectTypeDefinition = {
  typeName: 'fs.file',
  methods: fileMethods,
  formatDoc: (_name: string, sig: FunctionSignature) =>
    `**fs.file.${sig.name}()**: \`${sig.returnType}\`\n\n${sig.description}`,
};


// Helper functions for type checking
export function createFsObjectDataType(fsType: FsObjectType): UcodeDataType {
  return {
    type: UcodeType.OBJECT,
    moduleName: fsType
  };
}
