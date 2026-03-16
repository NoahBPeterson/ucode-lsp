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
    returnType: 'string',
    description: 'Read data from the process handle. Parameter can be: a number (bytes to read), "line" (read until newline), "all" (read until EOF), or a single character (read until that character). Returns a string containing the read data, empty string on EOF, or null on error.'
  }],
  ['write', {
    name: 'write',
    parameters: [{ name: 'data', type: 'any', optional: false }],
    returnType: 'integer',
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
    returnType: 'boolean',
    description: 'Flush buffered data'
  }],
  ['fileno', {
    name: 'fileno',
    parameters: [],
    returnType: 'integer',
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
    returnType: 'string',
    description: 'Read the next directory entry'
  }],
  ['tell', {
    name: 'tell',
    parameters: [],
    returnType: 'integer',
    description: 'Get current read position'
  }],
  ['seek', {
    name: 'seek',
    parameters: [{ name: 'position', type: 'integer', optional: false }],
    returnType: 'boolean',
    description: 'Set read position'
  }],
  ['close', {
    name: 'close',
    parameters: [],
    returnType: 'boolean',
    description: 'Close the directory handle'
  }],
  ['fileno', {
    name: 'fileno',
    parameters: [],
    returnType: 'integer',
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
    returnType: 'string',
    description: 'Read data from the file handle. Parameter can be: a number (bytes to read), "line" (read until newline), "all" (read until EOF), or a single character (read until that character). Returns a string containing the read data, empty string on EOF, or null on error.'
  }],
  ['write', {
    name: 'write',
    parameters: [{ name: 'data', type: 'any', optional: false }],
    returnType: 'integer',
    description: 'Write data to the file handle'
  }],
  ['seek', {
    name: 'seek',
    parameters: [
      { name: 'offset', type: 'integer', optional: true },
      { name: 'whence', type: 'integer', optional: true }
    ],
    returnType: 'boolean',
    description: 'Set file read position'
  }],
  ['tell', {
    name: 'tell',
    parameters: [],
    returnType: 'integer',
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
    returnType: 'boolean',
    description: 'Flush buffered data'
  }],
  ['fileno', {
    name: 'fileno',
    parameters: [],
    returnType: 'integer',
    description: 'Get the underlying file descriptor number'
  }],
  ['isatty', {
    name: 'isatty',
    parameters: [],
    returnType: 'boolean',
    description: 'Check if the file handle refers to a TTY device'
  }],
  ['truncate', {
    name: 'truncate',
    parameters: [{ name: 'offset', type: 'integer', optional: true }],
    returnType: 'boolean',
    description: 'Truncate file to given size'
  }],
  ['lock', {
    name: 'lock',
    parameters: [{ name: 'operation', type: 'string', optional: false }],
    returnType: 'boolean',
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

// Map of all fs object type methods for backwards-compat
const objectMethodMaps: Record<string, Map<string, FunctionSignature>> = {
  [FsObjectType.FS_PROC]: procMethods,
  [FsObjectType.FS_DIR]: dirMethods,
  [FsObjectType.FS_FILE]: fileMethods,
};

// Legacy interface preserved for external consumers
export interface FsMethodSignature {
  name: string;
  parameters: UcodeType[];
  returnType: UcodeType;
  variadic?: boolean;
  minParams?: number;
  maxParams?: number;
  description?: string;
}

export interface FsTypeDefinition {
  type: FsObjectType;
  methods: Map<string, FsMethodSignature>;
}

// Backwards compatibility — singleton registry
export const fsTypeRegistry = {
  getFsType: (_typeName: string) => {
    return undefined as FsTypeDefinition | undefined;
  },
  isFsType: (_typeName: string) => _typeName in objectMethodMaps,
  getFsMethod: (typeName: string, methodName: string) => {
    // Return in legacy FsMethodSignature format for backwards compat
    const methods = objectMethodMaps[typeName];
    const sig = methods?.get(methodName);
    if (!sig) return undefined;
    // Convert FunctionSignature back to FsMethodSignature format
    return {
      name: sig.name,
      parameters: sig.parameters.map(p => {
        // Reverse mapping from string type to UcodeType
        const typeMap: Record<string, UcodeType> = {
          'string': UcodeType.STRING,
          'integer': UcodeType.INTEGER,
          'boolean': UcodeType.BOOLEAN,
          'number': UcodeType.INTEGER,
          'any': UcodeType.UNKNOWN,
          'number | string': UcodeType.UNKNOWN,
        };
        return typeMap[p.type] ?? UcodeType.UNKNOWN;
      }),
      returnType: (() => {
        const typeMap: Record<string, UcodeType> = {
          'string': UcodeType.STRING,
          'integer': UcodeType.INTEGER,
          'boolean': UcodeType.BOOLEAN,
          'any': UcodeType.UNKNOWN,
        };
        return typeMap[sig.returnType] ?? UcodeType.UNKNOWN;
      })(),
      description: sig.description,
    } as FsMethodSignature;
  },
  getAllFsTypes: () => [FsObjectType.FS_PROC, FsObjectType.FS_DIR, FsObjectType.FS_FILE] as FsObjectType[],
  getMethodsForType: (typeName: string) => {
    const methods = objectMethodMaps[typeName];
    return methods ? Array.from(methods.keys()) : [];
  },
  isVariableOfFsType: (dataType: UcodeDataType): FsObjectType | null => {
    if (typeof dataType === 'string') return null;
    if ('moduleName' in dataType && typeof dataType.moduleName === 'string') {
      const moduleName = dataType.moduleName;
      if (moduleName in objectMethodMaps) {
        return moduleName as FsObjectType;
      }
    }
    return null;
  },
};

// Helper functions for type checking
export function isFsObjectType(typeName: string): typeName is FsObjectType {
  return Object.values(FsObjectType).includes(typeName as FsObjectType);
}

export function createFsObjectDataType(fsType: FsObjectType): UcodeDataType {
  return {
    type: UcodeType.OBJECT,
    moduleName: fsType
  };
}
