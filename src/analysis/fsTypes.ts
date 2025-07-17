/**
 * File System Types for ucode-lsp
 * Defines fs.proc, fs.dir, and fs.file types with their respective methods
 */

import { UcodeType, UcodeDataType } from './symbolTable';

export enum FsObjectType {
  FS_PROC = 'fs.proc',
  FS_DIR = 'fs.dir', 
  FS_FILE = 'fs.file'
}

export interface FsTypeDefinition {
  type: FsObjectType;
  methods: Map<string, FsMethodSignature>;
}

export interface FsMethodSignature {
  name: string;
  parameters: UcodeType[];
  returnType: UcodeType;
  variadic?: boolean;
  minParams?: number;
  maxParams?: number;
  description?: string;
}

export class FsTypeRegistry {
  private static instance: FsTypeRegistry;
  private types: Map<FsObjectType, FsTypeDefinition> = new Map();

  private constructor() {
    this.initializeFsTypes();
  }

  public static getInstance(): FsTypeRegistry {
    if (!FsTypeRegistry.instance) {
      FsTypeRegistry.instance = new FsTypeRegistry();
    }
    return FsTypeRegistry.instance;
  }

  private initializeFsTypes(): void {
    this.initializeFsProcType();
    this.initializeFsDirType();
    this.initializeFsFileType();
  }

  private initializeFsProcType(): void {
    const procMethods = new Map<string, FsMethodSignature>([
      ['read', {
        name: 'read',
        parameters: [UcodeType.UNKNOWN], // number | "line" | "all" | single char
        returnType: UcodeType.STRING,
        description: 'Read data from the process handle'
      }],
      ['write', {
        name: 'write', 
        parameters: [UcodeType.UNKNOWN], // any data type
        returnType: UcodeType.INTEGER,
        description: 'Write data to the process handle'
      }],
      ['close', {
        name: 'close',
        parameters: [],
        returnType: UcodeType.INTEGER, // exit code
        description: 'Close the process handle and get exit code'
      }],
      ['flush', {
        name: 'flush',
        parameters: [],
        returnType: UcodeType.BOOLEAN,
        description: 'Flush buffered data'
      }],
      ['fileno', {
        name: 'fileno',
        parameters: [],
        returnType: UcodeType.INTEGER,
        description: 'Get the underlying file descriptor number'
      }],
      ['error', {
        name: 'error',
        parameters: [],
        returnType: UcodeType.STRING,
        description: 'Get error information'
      }]
    ]);

    this.types.set(FsObjectType.FS_PROC, {
      type: FsObjectType.FS_PROC,
      methods: procMethods
    });
  }

  private initializeFsDirType(): void {
    const dirMethods = new Map<string, FsMethodSignature>([
      ['read', {
        name: 'read',
        parameters: [],
        returnType: UcodeType.STRING, // null on EOF
        description: 'Read the next directory entry'
      }],
      ['tell', {
        name: 'tell',
        parameters: [],
        returnType: UcodeType.INTEGER,
        description: 'Get current read position'
      }],
      ['seek', {
        name: 'seek',
        parameters: [UcodeType.INTEGER], // position from tell()
        returnType: UcodeType.BOOLEAN,
        description: 'Set read position'
      }],
      ['close', {
        name: 'close',
        parameters: [],
        returnType: UcodeType.BOOLEAN,
        description: 'Close the directory handle'
      }],
      ['fileno', {
        name: 'fileno',
        parameters: [],
        returnType: UcodeType.INTEGER,
        description: 'Get the underlying file descriptor number'
      }],
      ['error', {
        name: 'error',
        parameters: [],
        returnType: UcodeType.STRING,
        description: 'Get error information'
      }]
    ]);

    this.types.set(FsObjectType.FS_DIR, {
      type: FsObjectType.FS_DIR,
      methods: dirMethods
    });
  }

  private initializeFsFileType(): void {
    const fileMethods = new Map<string, FsMethodSignature>([
      ['read', {
        name: 'read',
        parameters: [UcodeType.UNKNOWN], // number | "line" | "all" | single char
        returnType: UcodeType.STRING,
        description: 'Read data from the file handle'
      }],
      ['write', {
        name: 'write',
        parameters: [UcodeType.UNKNOWN], // any data type
        returnType: UcodeType.INTEGER,
        description: 'Write data to the file handle'
      }],
      ['seek', {
        name: 'seek',
        parameters: [UcodeType.INTEGER, UcodeType.INTEGER], // offset, whence
        returnType: UcodeType.BOOLEAN,
        minParams: 0,
        maxParams: 2,
        description: 'Set file read position'
      }],
      ['tell', {
        name: 'tell',
        parameters: [],
        returnType: UcodeType.INTEGER,
        description: 'Get current file position'
      }],
      ['close', {
        name: 'close',
        parameters: [],
        returnType: UcodeType.BOOLEAN,
        description: 'Close the file handle'
      }],
      ['flush', {
        name: 'flush',
        parameters: [],
        returnType: UcodeType.BOOLEAN,
        description: 'Flush buffered data'
      }],
      ['fileno', {
        name: 'fileno',
        parameters: [],
        returnType: UcodeType.INTEGER,
        description: 'Get the underlying file descriptor number'
      }],
      ['isatty', {
        name: 'isatty',
        parameters: [],
        returnType: UcodeType.BOOLEAN,
        description: 'Check if the file handle refers to a TTY device'
      }],
      ['truncate', {
        name: 'truncate',
        parameters: [UcodeType.INTEGER], // offset
        returnType: UcodeType.BOOLEAN,
        minParams: 0,
        maxParams: 1,
        description: 'Truncate file to given size'
      }],
      ['lock', {
        name: 'lock',
        parameters: [UcodeType.STRING], // operation flags
        returnType: UcodeType.BOOLEAN,
        description: 'Lock or unlock the file'
      }],
      ['error', {
        name: 'error',
        parameters: [],
        returnType: UcodeType.STRING,
        description: 'Get error information'
      }]
    ]);

    // Add ioctl method for Linux systems (conditionally available)
    fileMethods.set('ioctl', {
      name: 'ioctl',
      parameters: [UcodeType.INTEGER, UcodeType.INTEGER, UcodeType.INTEGER, UcodeType.UNKNOWN], // direction, type, num, value
      returnType: UcodeType.UNKNOWN, // number or string depending on operation
      minParams: 3,
      maxParams: 4,
      description: 'Perform ioctl operation on the file (Linux only)'
    });

    this.types.set(FsObjectType.FS_FILE, {
      type: FsObjectType.FS_FILE,
      methods: fileMethods
    });
  }

  public getFsType(typeName: string): FsTypeDefinition | undefined {
    return this.types.get(typeName as FsObjectType);
  }

  public isFsType(typeName: string): boolean {
    return this.types.has(typeName as FsObjectType);
  }

  public getFsMethod(typeName: string, methodName: string): FsMethodSignature | undefined {
    const fsType = this.getFsType(typeName);
    return fsType?.methods.get(methodName);
  }

  public getAllFsTypes(): FsObjectType[] {
    return Array.from(this.types.keys());
  }

  public getMethodsForType(typeName: string): string[] {
    const fsType = this.getFsType(typeName);
    return fsType ? Array.from(fsType.methods.keys()) : [];
  }

  // Check if a variable type represents an fs object
  public isVariableOfFsType(dataType: UcodeDataType): FsObjectType | null {
    if (typeof dataType === 'string') {
      return null;
    }
    
    // Check if it's a module type with fs object type name
    if ('moduleName' in dataType && typeof dataType.moduleName === 'string') {
      const moduleName = dataType.moduleName;
      if (this.isFsType(moduleName)) {
        return moduleName as FsObjectType;
      }
    }

    return null;
  }
}

// Singleton instance
export const fsTypeRegistry = FsTypeRegistry.getInstance();

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