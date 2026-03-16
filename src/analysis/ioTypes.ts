/**
 * IO module type definitions and function signatures
 * Based on ucode/lib/io.c
 */

import type { FunctionSignature } from './moduleTypes';
import type { ModuleDefinition, ConstantDefinition, ObjectTypeDefinition } from './registryFactory';

import { UcodeType, UcodeDataType } from './symbolTable';

export enum IoObjectType {
  IO_HANDLE = 'io.handle'
}

export function createIoHandleDataType(): UcodeDataType {
  return { type: UcodeType.OBJECT, moduleName: IoObjectType.IO_HANDLE };
}

// Module-level functions (io_fns[])
const functions = new Map<string, FunctionSignature>([
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

// Backwards-compat exports
export { functions as ioFunctions };
export type IoModuleFunctionSignature = FunctionSignature;

// Handle method functions (io_handle_fns[])
const handleMethods = new Map<string, FunctionSignature>([
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

// Backwards-compat export
export { handleMethods as ioHandleFunctions };

// Constants exported by the io module
export const ioConstants: Map<string, ConstantDefinition> = new Map([
  // File open flags
  ["O_RDONLY", { name: "O_RDONLY", value: 0, type: "number", description: "Read-only file open flag" }],
  ["O_WRONLY", { name: "O_WRONLY", value: 1, type: "number", description: "Write-only file open flag" }],
  ["O_RDWR", { name: "O_RDWR", value: 2, type: "number", description: "Read-write file open flag" }],
  ["O_CREAT", { name: "O_CREAT", value: 64, type: "number", description: "Create file if it does not exist" }],
  ["O_EXCL", { name: "O_EXCL", value: 128, type: "number", description: "Fail if file already exists (used with O_CREAT)" }],
  ["O_TRUNC", { name: "O_TRUNC", value: 512, type: "number", description: "Truncate file to zero length on open" }],
  ["O_APPEND", { name: "O_APPEND", value: 1024, type: "number", description: "Append writes to end of file" }],
  ["O_NONBLOCK", { name: "O_NONBLOCK", value: 2048, type: "number", description: "Open in non-blocking mode" }],
  ["O_NOCTTY", { name: "O_NOCTTY", value: 256, type: "number", description: "Do not make the opened file the controlling terminal" }],
  ["O_SYNC", { name: "O_SYNC", value: 1052672, type: "number", description: "Synchronous I/O \u2014 writes block until data is physically written" }],
  ["O_CLOEXEC", { name: "O_CLOEXEC", value: 524288, type: "number", description: "Close file descriptor on exec()" }],
  ["O_DIRECTORY", { name: "O_DIRECTORY", value: 65536, type: "number", description: "Fail if path is not a directory" }],
  ["O_NOFOLLOW", { name: "O_NOFOLLOW", value: 131072, type: "number", description: "Do not follow symbolic links" }],

  // Seek constants
  ["SEEK_SET", { name: "SEEK_SET", value: 0, type: "number", description: "Seek relative to beginning of file" }],
  ["SEEK_CUR", { name: "SEEK_CUR", value: 1, type: "number", description: "Seek relative to current position" }],
  ["SEEK_END", { name: "SEEK_END", value: 2, type: "number", description: "Seek relative to end of file" }],

  // fcntl commands
  ["F_DUPFD", { name: "F_DUPFD", value: 0, type: "number", description: "Duplicate file descriptor (fcntl command)" }],
  ["F_DUPFD_CLOEXEC", { name: "F_DUPFD_CLOEXEC", value: 1030, type: "number", description: "Duplicate file descriptor with close-on-exec (fcntl command)" }],
  ["F_GETFD", { name: "F_GETFD", value: 1, type: "number", description: "Get file descriptor flags (fcntl command)" }],
  ["F_SETFD", { name: "F_SETFD", value: 2, type: "number", description: "Set file descriptor flags (fcntl command)" }],
  ["F_GETFL", { name: "F_GETFL", value: 3, type: "number", description: "Get file status flags (fcntl command)" }],
  ["F_SETFL", { name: "F_SETFL", value: 4, type: "number", description: "Set file status flags (fcntl command)" }],
  ["F_GETLK", { name: "F_GETLK", value: 5, type: "number", description: "Get record lock (fcntl command)" }],
  ["F_SETLK", { name: "F_SETLK", value: 6, type: "number", description: "Set record lock (fcntl command)" }],
  ["F_SETLKW", { name: "F_SETLKW", value: 7, type: "number", description: "Set record lock and wait (fcntl command)" }],
  ["F_GETOWN", { name: "F_GETOWN", value: 9, type: "number", description: "Get process/group receiving SIGIO (fcntl command)" }],
  ["F_SETOWN", { name: "F_SETOWN", value: 8, type: "number", description: "Set process/group to receive SIGIO (fcntl command)" }],

  // File descriptor flags
  ["FD_CLOEXEC", { name: "FD_CLOEXEC", value: 1, type: "number", description: "Close-on-exec file descriptor flag" }],

  // Terminal control
  ["TCSANOW", { name: "TCSANOW", value: 0, type: "number", description: "Apply terminal changes immediately" }],
  ["TCSADRAIN", { name: "TCSADRAIN", value: 1, type: "number", description: "Apply terminal changes after output is drained" }],
  ["TCSAFLUSH", { name: "TCSAFLUSH", value: 2, type: "number", description: "Apply terminal changes after output is drained, discarding pending input" }],

  // ioctl direction constants (Linux only)
  ["IOC_DIR_NONE", { name: "IOC_DIR_NONE", value: 0, type: "number", description: "No data transfer direction (ioctl)" }],
  ["IOC_DIR_READ", { name: "IOC_DIR_READ", value: 2, type: "number", description: "Read direction (ioctl)" }],
  ["IOC_DIR_WRITE", { name: "IOC_DIR_WRITE", value: 1, type: "number", description: "Write direction (ioctl)" }],
  ["IOC_DIR_RW", { name: "IOC_DIR_RW", value: 3, type: "number", description: "Read-write direction (ioctl)" }],
]);

export const ioModule: ModuleDefinition = {
  name: 'io',
  functions,
  constants: ioConstants,
  documentation: `## IO Module

**Object-oriented access to UNIX file descriptors**

The io module provides low-level I/O operations using POSIX file descriptors, with support for terminal control and pseudo-terminal operations.

### Usage

**Named import syntax:**
\`\`\`ucode
import { open, O_RDWR } from 'io';

let handle = open('/tmp/test.txt', O_RDWR);
handle.write('Hello World\\n');
handle.close();
\`\`\`

**Namespace import syntax:**
\`\`\`ucode
import * as io from 'io';

let handle = io.open('/tmp/test.txt', io.O_RDWR);
handle.write('Hello World\\n');
handle.close();
\`\`\`

### Module Functions

- **\`open()\`** - Open a file (POSIX open semantics)
- **\`new()\`** - Create handle from existing fd number
- **\`from()\`** - Create handle from existing file resource
- **\`pipe()\`** - Create a pipe (returns [read, write] handles)
- **\`error()\`** - Get last error message

### Handle Methods

- **\`read()\`**, **\`write()\`** - Read/write data
- **\`seek()\`**, **\`tell()\`** - File position
- **\`dup()\`**, **\`dup2()\`** - Duplicate file descriptors
- **\`fileno()\`** - Get underlying fd number
- **\`fcntl()\`**, **\`ioctl()\`** - File/device control
- **\`isatty()\`** - Test if fd is a terminal
- **\`close()\`** - Close the handle
- **\`ptsname()\`**, **\`grantpt()\`**, **\`unlockpt()\`** - Pseudoterminal ops
- **\`tcgetattr()\`**, **\`tcsetattr()\`** - Terminal attributes

*Hover over individual function names for detailed parameter and return type information.*`,
};

export const ioHandleObjectType: ObjectTypeDefinition = {
  typeName: 'io.handle',
  methods: handleMethods,
};

// Backwards compatibility
export const ioModuleTypeRegistry = {
  getFunctionNames: () => Array.from(functions.keys()),
  getFunction: (name: string) => functions.get(name),
  getHandleFunction: (name: string) => handleMethods.get(name),
  isIoModuleFunction: (name: string) => functions.has(name),
  isIoHandleFunction: (name: string) => handleMethods.has(name),
  isIoConstant: (name: string) => ioConstants.has(name),
  getConstantDocumentation: (name: string) => {
    const c = ioConstants.get(name);
    if (!c) return '';
    return `**(constant) ${c.name}** = ${c.value}\n\n${c.description}`;
  },
  isVariableOfIoType: (dataType: UcodeDataType) => {
    if (typeof dataType === 'string') return false;
    if (typeof dataType === 'object' && 'moduleName' in dataType) {
      return dataType.moduleName === IoObjectType.IO_HANDLE;
    }
    return false;
  },
  getIoHandleMethod: (methodName: string) => handleMethods.get(methodName),
  getFunctionDocumentation: (name: string) => {
    const func = functions.get(name);
    if (!func) return '';

    const params = func.parameters.map(p => {
      const typeStr = p.optional ? `${p.name}?: ${p.type}` : `${p.name}: ${p.type}`;
      return p.defaultValue !== undefined ? `${typeStr} = ${p.defaultValue}` : typeStr;
    }).join(', ');

    return `**io.${func.name}(${params}): ${func.returnType}**\n\n${func.description}`;
  },
  getHandleFunctionDocumentation: (name: string) => {
    const func = handleMethods.get(name);
    if (!func) return '';
    const params = func.parameters.map(p => {
      const typeStr = p.optional ? `${p.name}?: ${p.type}` : `${p.name}: ${p.type}`;
      return p.defaultValue !== undefined ? `${typeStr} = ${p.defaultValue}` : typeStr;
    }).join(', ');
    return `**handle.${func.name}(${params}): ${func.returnType}**\n\n${func.description}`;
  },
};
