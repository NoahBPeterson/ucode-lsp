/**
 * IO module type definitions and function signatures
 * Based on ucode/lib/io.c
 */

import { UcodeType, UcodeDataType } from './symbolTable';

export enum IoObjectType {
  IO_HANDLE = 'io.handle'
}

export function createIoHandleDataType(): UcodeDataType {
  return { type: UcodeType.OBJECT, moduleName: IoObjectType.IO_HANDLE };
}

export interface IoModuleFunctionSignature {
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

// Module-level functions (io_fns[])
export const ioFunctions: Map<string, IoModuleFunctionSignature> = new Map([
  ["error", {
    name: "error",
    parameters: [],
    returnType: "string | null",
    description: "Returns the last I/O error message, or null if no error occurred"
  }],
  ["new", {
    name: "new",
    parameters: [
      { name: "fd", type: "number", optional: false },
      { name: "takeOver", type: "boolean", optional: true, defaultValue: false }
    ],
    returnType: "io.handle | null",
    description: "Creates an io.handle from an existing file descriptor number. If takeOver is true, the handle will close the fd when garbage collected"
  }],
  ["open", {
    name: "open",
    parameters: [
      { name: "path", type: "string", optional: false },
      { name: "flags", type: "number", optional: true, defaultValue: "O_RDONLY" },
      { name: "mode", type: "number", optional: true, defaultValue: 0o666 }
    ],
    returnType: "io.handle | null",
    description: "Opens a file and returns an io.handle. Uses POSIX open() flags (O_RDONLY, O_WRONLY, O_RDWR, O_CREAT, etc.)"
  }],
  ["from", {
    name: "from",
    parameters: [
      { name: "source", type: "any", optional: false }
    ],
    returnType: "io.handle | null",
    description: "Creates an io.handle from an existing file handle (fs.file, fs.proc, fs.dir) or io.handle resource by extracting its underlying file descriptor"
  }],
  ["pipe", {
    name: "pipe",
    parameters: [],
    returnType: "array | null",
    description: "Creates a pipe and returns an array of two io.handle objects [read_handle, write_handle], or null on error"
  }],
]);

// Handle method functions (io_handle_fns[])
export const ioHandleFunctions: Map<string, IoModuleFunctionSignature> = new Map([
  ["read", {
    name: "read",
    parameters: [
      { name: "length", type: "number", optional: false }
    ],
    returnType: "string | null",
    description: "Reads up to length bytes from the handle. Returns the data as a string, empty string on EOF, or null on error"
  }],
  ["write", {
    name: "write",
    parameters: [
      { name: "data", type: "string", optional: false }
    ],
    returnType: "number | null",
    description: "Writes data to the handle. Returns the number of bytes written, or null on error"
  }],
  ["seek", {
    name: "seek",
    parameters: [
      { name: "offset", type: "number", optional: false },
      { name: "whence", type: "number", optional: true, defaultValue: "SEEK_SET" }
    ],
    returnType: "number | null",
    description: "Repositions the file offset. whence is SEEK_SET, SEEK_CUR, or SEEK_END. Returns the new offset, or null on error"
  }],
  ["tell", {
    name: "tell",
    parameters: [],
    returnType: "number | null",
    description: "Returns the current file offset, or null on error"
  }],
  ["dup", {
    name: "dup",
    parameters: [],
    returnType: "io.handle | null",
    description: "Duplicates the file descriptor and returns a new io.handle, or null on error"
  }],
  ["dup2", {
    name: "dup2",
    parameters: [
      { name: "newfd", type: "number", optional: false }
    ],
    returnType: "io.handle | null",
    description: "Duplicates the file descriptor to the specified newfd number. Returns a new io.handle, or null on error"
  }],
  ["fileno", {
    name: "fileno",
    parameters: [],
    returnType: "number | null",
    description: "Returns the underlying file descriptor number, or null on error"
  }],
  ["fcntl", {
    name: "fcntl",
    parameters: [
      { name: "cmd", type: "number", optional: false },
      { name: "arg", type: "any", optional: true }
    ],
    returnType: "any",
    description: "Performs file control operations. Behavior depends on cmd (F_DUPFD, F_GETFD, F_SETFD, F_GETFL, F_SETFL, etc.)"
  }],
  ["ioctl", {
    name: "ioctl",
    parameters: [
      { name: "direction", type: "number", optional: false },
      { name: "type", type: "number", optional: false },
      { name: "number", type: "number", optional: false },
      { name: "argument", type: "any", optional: true }
    ],
    returnType: "any",
    description: "Performs device-specific I/O control operations (Linux only)"
  }],
  ["isatty", {
    name: "isatty",
    parameters: [],
    returnType: "boolean",
    description: "Tests whether the file descriptor refers to a terminal"
  }],
  ["close", {
    name: "close",
    parameters: [],
    returnType: "boolean | null",
    description: "Closes the file descriptor. Returns true on success, null on error"
  }],
  ["error", {
    name: "error",
    parameters: [],
    returnType: "string | null",
    description: "Returns the last I/O error message, or null if no error occurred"
  }],
  ["ptsname", {
    name: "ptsname",
    parameters: [],
    returnType: "string | null",
    description: "Returns the name of the slave pseudoterminal device corresponding to the master referred to by the handle"
  }],
  ["tcgetattr", {
    name: "tcgetattr",
    parameters: [],
    returnType: "object | null",
    description: "Gets the terminal attributes. Returns an object with iflag, oflag, cflag, lflag, ispeed, ospeed, and cc fields"
  }],
  ["tcsetattr", {
    name: "tcsetattr",
    parameters: [
      { name: "attrs", type: "object", optional: false },
      { name: "when", type: "number", optional: true, defaultValue: "TCSANOW" }
    ],
    returnType: "boolean | null",
    description: "Sets the terminal attributes. when can be TCSANOW, TCSADRAIN, or TCSAFLUSH"
  }],
  ["grantpt", {
    name: "grantpt",
    parameters: [],
    returnType: "boolean | null",
    description: "Grants access to the slave pseudoterminal. Returns true on success, null on error"
  }],
  ["unlockpt", {
    name: "unlockpt",
    parameters: [],
    returnType: "boolean | null",
    description: "Unlocks the slave pseudoterminal. Returns true on success, null on error"
  }],
]);

// Constants exported by the io module
export const ioConstants: Map<string, number> = new Map([
  // File open flags
  ["O_RDONLY", 0],
  ["O_WRONLY", 1],
  ["O_RDWR", 2],
  ["O_CREAT", 64],
  ["O_EXCL", 128],
  ["O_TRUNC", 512],
  ["O_APPEND", 1024],
  ["O_NONBLOCK", 2048],
  ["O_NOCTTY", 256],
  ["O_SYNC", 1052672],
  ["O_CLOEXEC", 524288],
  ["O_DIRECTORY", 65536],
  ["O_NOFOLLOW", 131072],

  // Seek constants
  ["SEEK_SET", 0],
  ["SEEK_CUR", 1],
  ["SEEK_END", 2],

  // fcntl commands
  ["F_DUPFD", 0],
  ["F_DUPFD_CLOEXEC", 1030],
  ["F_GETFD", 1],
  ["F_SETFD", 2],
  ["F_GETFL", 3],
  ["F_SETFL", 4],
  ["F_GETLK", 5],
  ["F_SETLK", 6],
  ["F_SETLKW", 7],
  ["F_GETOWN", 9],
  ["F_SETOWN", 8],

  // File descriptor flags
  ["FD_CLOEXEC", 1],

  // Terminal control
  ["TCSANOW", 0],
  ["TCSADRAIN", 1],
  ["TCSAFLUSH", 2],

  // ioctl direction constants (Linux only)
  ["IOC_DIR_NONE", 0],
  ["IOC_DIR_READ", 2],
  ["IOC_DIR_WRITE", 1],
  ["IOC_DIR_RW", 3],
]);

// Constant documentation grouped by category
const ioConstantDocs: Map<string, string> = new Map([
  // File open flags
  ["O_RDONLY", `**(constant) O_RDONLY** = 0\n\nRead-only file open flag`],
  ["O_WRONLY", `**(constant) O_WRONLY** = 1\n\nWrite-only file open flag`],
  ["O_RDWR", `**(constant) O_RDWR** = 2\n\nRead-write file open flag`],
  ["O_CREAT", `**(constant) O_CREAT** = 64\n\nCreate file if it does not exist`],
  ["O_EXCL", `**(constant) O_EXCL** = 128\n\nFail if file already exists (used with O_CREAT)`],
  ["O_TRUNC", `**(constant) O_TRUNC** = 512\n\nTruncate file to zero length on open`],
  ["O_APPEND", `**(constant) O_APPEND** = 1024\n\nAppend writes to end of file`],
  ["O_NONBLOCK", `**(constant) O_NONBLOCK** = 2048\n\nOpen in non-blocking mode`],
  ["O_NOCTTY", `**(constant) O_NOCTTY** = 256\n\nDo not make the opened file the controlling terminal`],
  ["O_SYNC", `**(constant) O_SYNC** = 1052672\n\nSynchronous I/O — writes block until data is physically written`],
  ["O_CLOEXEC", `**(constant) O_CLOEXEC** = 524288\n\nClose file descriptor on exec()`],
  ["O_DIRECTORY", `**(constant) O_DIRECTORY** = 65536\n\nFail if path is not a directory`],
  ["O_NOFOLLOW", `**(constant) O_NOFOLLOW** = 131072\n\nDo not follow symbolic links`],
  // Seek constants
  ["SEEK_SET", `**(constant) SEEK_SET** = 0\n\nSeek relative to beginning of file`],
  ["SEEK_CUR", `**(constant) SEEK_CUR** = 1\n\nSeek relative to current position`],
  ["SEEK_END", `**(constant) SEEK_END** = 2\n\nSeek relative to end of file`],
  // fcntl commands
  ["F_DUPFD", `**(constant) F_DUPFD** = 0\n\nDuplicate file descriptor (fcntl command)`],
  ["F_DUPFD_CLOEXEC", `**(constant) F_DUPFD_CLOEXEC** = 1030\n\nDuplicate file descriptor with close-on-exec (fcntl command)`],
  ["F_GETFD", `**(constant) F_GETFD** = 1\n\nGet file descriptor flags (fcntl command)`],
  ["F_SETFD", `**(constant) F_SETFD** = 2\n\nSet file descriptor flags (fcntl command)`],
  ["F_GETFL", `**(constant) F_GETFL** = 3\n\nGet file status flags (fcntl command)`],
  ["F_SETFL", `**(constant) F_SETFL** = 4\n\nSet file status flags (fcntl command)`],
  ["F_GETLK", `**(constant) F_GETLK** = 5\n\nGet record lock (fcntl command)`],
  ["F_SETLK", `**(constant) F_SETLK** = 6\n\nSet record lock (fcntl command)`],
  ["F_SETLKW", `**(constant) F_SETLKW** = 7\n\nSet record lock and wait (fcntl command)`],
  ["F_GETOWN", `**(constant) F_GETOWN** = 9\n\nGet process/group receiving SIGIO (fcntl command)`],
  ["F_SETOWN", `**(constant) F_SETOWN** = 8\n\nSet process/group to receive SIGIO (fcntl command)`],
  // File descriptor flags
  ["FD_CLOEXEC", `**(constant) FD_CLOEXEC** = 1\n\nClose-on-exec file descriptor flag`],
  // Terminal control
  ["TCSANOW", `**(constant) TCSANOW** = 0\n\nApply terminal changes immediately`],
  ["TCSADRAIN", `**(constant) TCSADRAIN** = 1\n\nApply terminal changes after output is drained`],
  ["TCSAFLUSH", `**(constant) TCSAFLUSH** = 2\n\nApply terminal changes after output is drained, discarding pending input`],
  // ioctl direction constants
  ["IOC_DIR_NONE", `**(constant) IOC_DIR_NONE** = 0\n\nNo data transfer direction (ioctl)`],
  ["IOC_DIR_READ", `**(constant) IOC_DIR_READ** = 2\n\nRead direction (ioctl)`],
  ["IOC_DIR_WRITE", `**(constant) IOC_DIR_WRITE** = 1\n\nWrite direction (ioctl)`],
  ["IOC_DIR_RW", `**(constant) IOC_DIR_RW** = 3\n\nRead-write direction (ioctl)`],
]);

export class IoModuleTypeRegistry {
  private static instance: IoModuleTypeRegistry;

  private constructor() {}

  public static getInstance(): IoModuleTypeRegistry {
    if (!IoModuleTypeRegistry.instance) {
      IoModuleTypeRegistry.instance = new IoModuleTypeRegistry();
    }
    return IoModuleTypeRegistry.instance;
  }

  getFunctionNames(): string[] {
    return Array.from(ioFunctions.keys());
  }

  getFunction(name: string): IoModuleFunctionSignature | undefined {
    return ioFunctions.get(name);
  }

  getHandleFunction(name: string): IoModuleFunctionSignature | undefined {
    return ioHandleFunctions.get(name);
  }

  isIoModuleFunction(name: string): boolean {
    return ioFunctions.has(name);
  }

  isIoHandleFunction(name: string): boolean {
    return ioHandleFunctions.has(name);
  }

  isIoConstant(name: string): boolean {
    return ioConstants.has(name);
  }

  getConstantDocumentation(name: string): string {
    return ioConstantDocs.get(name) || '';
  }

  isVariableOfIoType(dataType: UcodeDataType): boolean {
    if (typeof dataType === 'string') return false;
    if (typeof dataType === 'object' && 'moduleName' in dataType) {
      return dataType.moduleName === IoObjectType.IO_HANDLE;
    }
    return false;
  }

  getIoHandleMethod(methodName: string): IoModuleFunctionSignature | undefined {
    return ioHandleFunctions.get(methodName);
  }

  getFunctionDocumentation(name: string): string {
    const func = ioFunctions.get(name);
    if (!func) return '';

    const params = func.parameters.map(p => {
      const typeStr = p.optional ? `${p.name}?: ${p.type}` : `${p.name}: ${p.type}`;
      return p.defaultValue !== undefined ? `${typeStr} = ${p.defaultValue}` : typeStr;
    }).join(', ');

    return `**io.${func.name}(${params}): ${func.returnType}**\n\n${func.description}`;
  }

  getHandleFunctionDocumentation(name: string): string {
    const func = ioHandleFunctions.get(name);
    if (!func) return '';

    const params = func.parameters.map(p => {
      const typeStr = p.optional ? `${p.name}?: ${p.type}` : `${p.name}: ${p.type}`;
      return p.defaultValue !== undefined ? `${typeStr} = ${p.defaultValue}` : typeStr;
    }).join(', ');

    return `**handle.${func.name}(${params}): ${func.returnType}**\n\n${func.description}`;
  }
}

export const ioModuleTypeRegistry = IoModuleTypeRegistry.getInstance();
