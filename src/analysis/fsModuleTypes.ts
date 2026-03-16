/**
 * FS module type definitions and function signatures
 * Based on static const uc_function_list_t global_fns[] in ucode fs module
 */

import { FsObjectType } from './fsTypes';
import type { ModuleDefinition, PropertyDefinition, ObjectTypeDefinition } from './registryFactory';

/**
 * Look up an fs function by name and extract its FsObjectType from the return type string.
 * e.g. "statvfs" → FsObjectType.FS_STATVFS (from "fs.statvfs | null")
 *      "open"    → FsObjectType.FS_FILE    (from "fs.file | null")
 *      "stat"    → null                    (from "object | null")
 */
export function getFsReturnObjectType(funcName: string): FsObjectType | null {
  const sig = fsModuleFunctions.get(funcName);
  if (!sig) return null;
  for (const fsType of Object.values(FsObjectType)) {
    if (sig.returnType.includes(fsType)) {
      return fsType;
    }
  }
  return null;
}

export interface FsModuleFunctionSignature {
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

export const fsModuleFunctions: Map<string, FsModuleFunctionSignature> = new Map([
  ["error", {
    name: "error",
    parameters: [],
    returnType: "string | null",
    description: "Returns the last filesystem error message, or null if no error occurred"
  }],
  ["open", {
    name: "open",
    parameters: [
      { name: "path", type: "string", optional: false },
      { name: "mode", type: "string", optional: true, defaultValue: "r" },
      { name: "perm", type: "number", optional: true, defaultValue: 0o666 }
    ],
    returnType: "fs.file | null",
    description: "Opens a file and returns a file handle. Mode can be 'r' (read), 'w' (write), 'a' (append), etc."
  }],
  ["fdopen", {
    name: "fdopen", 
    parameters: [
      { name: "fd", type: "number", optional: false },
      { name: "mode", type: "string", optional: true, defaultValue: "r" }
    ],
    returnType: "fs.file | null",
    description: "Creates a file handle from a file descriptor"
  }],
  ["opendir", {
    name: "opendir",
    parameters: [
      { name: "path", type: "string", optional: false }
    ],
    returnType: "fs.dir | null",
    description: "Opens a directory and returns a directory handle"
  }],
  ["popen", {
    name: "popen",
    parameters: [
      { name: "command", type: "string", optional: false },
      { name: "mode", type: "string", optional: true, defaultValue: "r" }
    ],
    returnType: "fs.proc | null",
    description: "Opens a process pipe and returns a process handle"
  }],
  ["readlink", {
    name: "readlink",
    parameters: [
      { name: "path", type: "string", optional: false }
    ],
    returnType: "string | null",
    description: "Reads the target of a symbolic link"
  }],
  ["stat", {
    name: "stat",
    parameters: [
      { name: "path", type: "string", optional: false }
    ],
    returnType: "object | null",
    description: "Gets file status information (follows symbolic links)"
  }],
  ["lstat", {
    name: "lstat",
    parameters: [
      { name: "path", type: "string", optional: false }
    ],
    returnType: "object | null", 
    description: "Gets file status information (does not follow symbolic links)"
  }],
  ["mkdir", {
    name: "mkdir",
    parameters: [
      { name: "path", type: "string", optional: false },
      { name: "mode", type: "number", optional: true, defaultValue: 0o755 }
    ],
    returnType: "boolean",
    description: "Creates a directory. Returns true on success, false on failure"
  }],
  ["rmdir", {
    name: "rmdir",
    parameters: [
      { name: "path", type: "string", optional: false }
    ],
    returnType: "boolean",
    description: "Removes an empty directory. Returns true on success, false on failure"
  }],
  ["symlink", {
    name: "symlink", 
    parameters: [
      { name: "target", type: "string", optional: false },
      { name: "linkpath", type: "string", optional: false }
    ],
    returnType: "boolean",
    description: "Creates a symbolic link. Returns true on success, false on failure"
  }],
  ["unlink", {
    name: "unlink",
    parameters: [
      { name: "path", type: "string", optional: false }
    ],
    returnType: "boolean",
    description: "Removes a file or symbolic link. Returns true on success, false on failure"
  }],
  ["getcwd", {
    name: "getcwd",
    parameters: [],
    returnType: "string | null",
    description: "Gets the current working directory path"
  }],
  ["chdir", {
    name: "chdir",
    parameters: [
      { name: "path", type: "string", optional: false }
    ],
    returnType: "boolean",
    description: "Changes the current working directory. Returns true on success, false on failure"
  }],
  ["chmod", {
    name: "chmod",
    parameters: [
      { name: "path", type: "string", optional: false },
      { name: "mode", type: "number", optional: false }
    ],
    returnType: "boolean | null",
    description: "Changes file permissions. Returns true on success, false on failure"
  }],
  ["chown", {
    name: "chown",
    parameters: [
      { name: "path", type: "string", optional: false },
      { name: "uid", type: "number", optional: false },
      { name: "gid", type: "number", optional: false }
    ],
    returnType: "boolean | null",
    description: "Changes file ownership. Returns true on success, null on failure"
  }],
  ["rename", {
    name: "rename",
    parameters: [
      { name: "oldpath", type: "string", optional: false },
      { name: "newpath", type: "string", optional: false }
    ],
    returnType: "boolean",
    description: "Renames or moves a file. Returns true on success, false on failure"
  }],
  ["glob", {
    name: "glob",
    parameters: [
      { name: "pattern", type: "string", optional: false }
    ],
    returnType: "array | null",
    description: "Finds files matching a pattern using shell wildcards"
  }],
  ["dirname", {
    name: "dirname",
    parameters: [
      { name: "path", type: "string", optional: false }
    ],
    returnType: "string",
    description: "Returns the directory portion of a path"
  }],
  ["basename", {
    name: "basename",
    parameters: [
      { name: "path", type: "string", optional: false },
      { name: "suffix", type: "string", optional: true }
    ],
    returnType: "string",
    description: "Returns the filename portion of a path, optionally removing suffix"
  }],
  ["lsdir", {
    name: "lsdir",
    parameters: [
      { name: "path", type: "string", optional: false }
    ],
    returnType: "array | null",
    description: "Lists directory contents as an array of filenames"
  }],
  ["mkstemp", {
    name: "mkstemp",
    parameters: [
      { name: "template", type: "string", optional: false }
    ],
    returnType: "fs.file | null",
    description: "Creates a unique temporary file and returns a file handle"
  }],
  ["access", {
    name: "access",
    parameters: [
      { name: "path", type: "string", optional: false },
      { name: "mode", type: "number", optional: true, defaultValue: 0 }
    ],
    returnType: "boolean",
    description: "Tests file accessibility. Returns true if accessible, false otherwise"
  }],
  ["readfile", {
    name: "readfile",
    parameters: [
      { name: "path", type: "string", optional: false }
    ],
    returnType: "string | null",
    description: "Reads the entire contents of a file as a string"
  }],
  ["writefile", {
    name: "writefile", 
    parameters: [
      { name: "path", type: "string", optional: false },
      { name: "content", type: "string", optional: false },
      { name: "mode", type: "number", optional: true, defaultValue: 0o644 }
    ],
    returnType: "boolean",
    description: "Writes content to a file. Returns true on success, false on failure"
  }],
  ["realpath", {
    name: "realpath",
    parameters: [
      { name: "path", type: "string", optional: false }
    ],
    returnType: "string | null", 
    description: "Resolves a path to its canonical absolute form"
  }],
  ["pipe", {
    name: "pipe",
    parameters: [],
    returnType: "array | null",
    description: "Creates a pipe and returns an array with read and write file handles"
  }],
  ["dup2", {
    name: "dup2",
    parameters: [
      { name: "oldfd", type: "number", optional: false },
      { name: "newfd", type: "number", optional: false }
    ],
    returnType: "boolean | null",
    description: "Duplicates file descriptor oldfd to newfd. Returns true on success, null on error"
  }],
  ["mkdtemp", {
    name: "mkdtemp",
    parameters: [
      { name: "template", type: "string", optional: true, defaultValue: "/tmp/XXXXXX" }
    ],
    returnType: "string | null",
    description: "Creates a unique temporary directory using the given template. Returns the path of the created directory on success, null on error"
  }],
  ["getcwd", {
    name: "getcwd",
    parameters: [],
    returnType: "string | null",
    description: "Gets the current working directory path"
  }],
  ["chdir", {
    name: "chdir", 
    parameters: [
      { name: "path", type: "string", optional: false }
    ],
    returnType: "boolean | null",
    description: "Changes the current working directory"
  }],
  ["rename", {
    name: "rename",
    parameters: [
      { name: "oldpath", type: "string", optional: false },
      { name: "newpath", type: "string", optional: false }
    ],
    returnType: "boolean | null",
    description: "Renames a file or directory"
  }],
  ["symlink", {
    name: "symlink",
    parameters: [
      { name: "target", type: "string", optional: false },
      { name: "linkpath", type: "string", optional: false }
    ],
    returnType: "boolean | null",
    description: "Creates a symbolic link"
  }],
  ["glob", {
    name: "glob",
    parameters: [
      { name: "patterns", type: "string", optional: false }
    ],
    returnType: "array | null",
    description: "Matches file paths using glob patterns (variadic function)"
  }],
  ["statvfs", {
    name: "statvfs",
    parameters: [
      { name: "path", type: "string", optional: false }
    ],
    returnType: "fs.statvfs | null",
    description: "Queries filesystem statistics for a given pathname. Returns an object with properties: bsize, frsize, blocks, bfree, bavail, files, ffree, favail, fsid, flag, namemax, freesize (frsize * bfree), totalsize (frsize * blocks). On Linux, an additional `type` field (filesystem magic number) is provided. Returns null on failure."
  }]
]);

// StatVFS result object properties
export interface StatvfsPropertySignature {
  name: string;
  type: string;
  description: string;
}

export const statvfsProperties: Map<string, StatvfsPropertySignature> = new Map([
  ["bsize", { name: "bsize", type: "integer", description: "File system block size" }],
  ["frsize", { name: "frsize", type: "integer", description: "Fragment size" }],
  ["blocks", { name: "blocks", type: "integer", description: "Total number of blocks in the filesystem" }],
  ["bfree", { name: "bfree", type: "integer", description: "Total number of free blocks" }],
  ["bavail", { name: "bavail", type: "integer", description: "Free blocks available to unprivileged users" }],
  ["files", { name: "files", type: "integer", description: "Total number of file nodes (inodes)" }],
  ["ffree", { name: "ffree", type: "integer", description: "Total number of free file nodes" }],
  ["favail", { name: "favail", type: "integer", description: "Free file nodes available to unprivileged users" }],
  ["fsid", { name: "fsid", type: "integer", description: "File system ID" }],
  ["flag", { name: "flag", type: "integer", description: "Mount flags (bitmask of ST_* constants)" }],
  ["namemax", { name: "namemax", type: "integer", description: "Maximum filename length" }],
  ["freesize", { name: "freesize", type: "integer", description: "Free space in bytes (frsize * bfree)" }],
  ["totalsize", { name: "totalsize", type: "integer", description: "Total filesystem size in bytes (frsize * blocks)" }],
  ["type", { name: "type", type: "integer", description: "Filesystem magic number from statfs (Linux only)" }],
]);

export class StatvfsTypeRegistry {
  getPropertyNames(): string[] {
    return Array.from(statvfsProperties.keys());
  }

  getProperty(name: string): StatvfsPropertySignature | undefined {
    return statvfsProperties.get(name);
  }

  getPropertyDocumentation(name: string): string {
    const prop = statvfsProperties.get(name);
    if (!prop) return '';
    return `**(fs.statvfs property) ${prop.name}**: \`${prop.type}\`\n\n${prop.description}`;
  }
}

export const statvfsTypeRegistry = new StatvfsTypeRegistry();

// FS module constants (mount flags from statvfs)
export const fsConstants: Map<string, number> = new Map([
  ["ST_RDONLY", 1],
  ["ST_NOSUID", 2],
  ["ST_NODEV", 4],
  ["ST_NOEXEC", 8],
  ["ST_SYNCHRONOUS", 16],
  ["ST_MANDLOCK", 64],
  ["ST_NOATIME", 1024],
  ["ST_NODIRATIME", 2048],
  ["ST_RELATIME", 4096],
  ["ST_NOSYMFOLLOW", 256],
]);

export const fsConstantDocumentation: Map<string, string> = new Map([
  ["ST_RDONLY", `**(constant) ST_RDONLY** = 1\n\nRead-only filesystem`],
  ["ST_NOSUID", `**(constant) ST_NOSUID** = 2\n\nDo not allow set-user-identifier or set-group-identifier bits`],
  ["ST_NODEV", `**(constant) ST_NODEV** = 4\n\nDo not allow device files (Linux only)`],
  ["ST_NOEXEC", `**(constant) ST_NOEXEC** = 8\n\nDo not allow execution of binaries (Linux only)`],
  ["ST_SYNCHRONOUS", `**(constant) ST_SYNCHRONOUS** = 16\n\nSynchronous writes (Linux only)`],
  ["ST_MANDLOCK", `**(constant) ST_MANDLOCK** = 64\n\nMandatory locking (Linux only)`],
  ["ST_NOATIME", `**(constant) ST_NOATIME** = 1024\n\nDo not update access times (Linux only)`],
  ["ST_NODIRATIME", `**(constant) ST_NODIRATIME** = 2048\n\nDo not update directory access times (Linux only)`],
  ["ST_RELATIME", `**(constant) ST_RELATIME** = 4096\n\nUpdate access times relative to modification time (Linux only)`],
  ["ST_NOSYMFOLLOW", `**(constant) ST_NOSYMFOLLOW** = 256\n\nDo not follow symbolic links (Linux only)`],
]);

export class FsModuleTypeRegistry {
  private static instance: FsModuleTypeRegistry;

  private constructor() {}

  public static getInstance(): FsModuleTypeRegistry {
    if (!FsModuleTypeRegistry.instance) {
      FsModuleTypeRegistry.instance = new FsModuleTypeRegistry();
    }
    return FsModuleTypeRegistry.instance;
  }

  getFunctionNames(): string[] {
    return Array.from(fsModuleFunctions.keys());
  }

  getFunction(name: string): FsModuleFunctionSignature | undefined {
    return fsModuleFunctions.get(name);
  }

  isFsModuleFunction(name: string): boolean {
    return fsModuleFunctions.has(name);
  }

  getFunctionDocumentation(name: string): string {
    const func = fsModuleFunctions.get(name);
    if (!func) return '';

    const params = func.parameters.map(p => {
      const typeStr = p.optional ? `${p.name}?: ${p.type}` : `${p.name}: ${p.type}`;
      return p.defaultValue !== undefined ? `${typeStr} = ${p.defaultValue}` : typeStr;
    }).join(', ');

    return `**fs.${func.name}(${params}): ${func.returnType}**\n\n${func.description}`;
  }
}

// Export singleton instance
export const fsModuleTypeRegistry = FsModuleTypeRegistry.getInstance();

// ---- New-style definitions for registryFactory ----

export const fsModule: ModuleDefinition = {
  name: 'fs',
  functions: fsModuleFunctions,
  constantDocumentation: fsConstantDocumentation,
  documentation: `## FS Module

**File system operations for ucode scripts**

The fs module provides comprehensive file system functionality for reading, writing, and manipulating files and directories.

### Usage

**Named import syntax:**
\`\`\`ucode
import { open, readlink, stat } from 'fs';

let file = open("file.txt", "r");
let target = readlink("/sys/class/net/eth0");
let info = stat("/etc/passwd");
\`\`\`

**Namespace import syntax:**
\`\`\`ucode
import * as fs from 'fs';

let file = fs.open("file.txt", "r");
let content = file.read("all");
file.close();
\`\`\`

### Available Functions

**File operations:**
- **\`open()\`** - Open files for reading/writing
- **\`fdopen()\`** - Associate file descriptor with handle
- **\`popen()\`** - Execute commands and handle I/O

**Directory operations:**
- **\`opendir()\`** - Open directories for reading
- **\`mkdir()\`** - Create directories
- **\`rmdir()\`** - Remove directories

**File system information:**
- **\`stat()\`** - Get file/directory information
- **\`lstat()\`** - Get info without following symlinks
- **\`readlink()\`** - Read symbolic link targets
- **\`statvfs()\`** - Query filesystem statistics

**File manipulation:**
- **\`unlink()\`** - Remove files
- **\`symlink()\`** - Create symbolic links
- **\`chmod()\`** - Change file permissions
- **\`chown()\`** - Change file ownership

**Utility functions:**
- **\`error()\`** - Get last error information
- **\`getcwd()\`** - Get current working directory
- **\`chdir()\`** - Change current directory

### File Handle Objects

- **\`fs.file\`** - File handles with read/write/seek methods
- **\`fs.proc\`** - Process handles for command execution
- **\`fs.dir\`** - Directory handles for listing entries

*Hover over individual function names for detailed parameter and return type information.*`,
  importValidation: {
    isValid: (name: string) => fsModuleFunctions.has(name) || fsConstants.has(name),
    getValidImports: () => [...Array.from(fsModuleFunctions.keys()), ...Array.from(fsConstants.keys())],
  },
};

export const statvfsObjectType: ObjectTypeDefinition = {
  typeName: 'fs.statvfs',
  isPropertyBased: true,
  methods: new Map(),
  properties: statvfsProperties as ReadonlyMap<string, PropertyDefinition>,
  formatPropertyDoc: (_name: string, prop: PropertyDefinition) =>
    `**(fs.statvfs property) ${prop.name}**: \`${prop.type}\`\n\n${prop.description}`,
};