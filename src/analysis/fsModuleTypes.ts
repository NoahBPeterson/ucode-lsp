/**
 * FS module type definitions and function signatures
 * Based on static const uc_function_list_t global_fns[] in ucode fs module
 */

import { FsObjectType } from './fsTypes';
import type { ModuleDefinition, PropertyDefinition, ObjectTypeDefinition, ObjectExportDefinition } from './registryFactory';

/**
 * fs object-handle exports: the module adds stdin/stdout/stderr to its scope as
 * `fs.file` resources (ucode lib/fs.c: ucv_object_add(scope, "stdin",
 * uc_resource_new(file_type, stdin)), etc.). They are importable
 * (`import { stdin } from "fs"`) and namespace-accessible (`fs.stdin`), and carry all
 * fs.file methods. They are never null (always valid handles).
 */
export const fsObjectExports: ReadonlyMap<string, ObjectExportDefinition> = new Map([
  ["stdin",  { name: "stdin",  objectType: "fs.file", description: "Standard input stream as an `fs.file` handle (file descriptor 0, opened for reading)." }],
  ["stdout", { name: "stdout", objectType: "fs.file", description: "Standard output stream as an `fs.file` handle (file descriptor 1, opened for writing)." }],
  ["stderr", { name: "stderr", objectType: "fs.file", description: "Standard error stream as an `fs.file` handle (file descriptor 2, opened for writing)." }],
]);

/**
 * Look up an fs function by name and extract its FsObjectType from the return type string.
 * e.g. "statvfs" → FsObjectType.FS_STATVFS (from "fs.statvfs | null")
 *      "open"    → FsObjectType.FS_FILE    (from "fs.file | null")
 *      "stat"    → null                    (from "object | null")
 */
export function getFsReturnObjectType(funcName: string): FsObjectType | null {
  const sig = fsModuleFunctions.get(funcName);
  if (!sig) return null;
  // Don't match object types wrapped in array<...> — pipe() returns array<fs.file>,
  // not a single fs.file object
  const returnType = sig.returnType;
  for (const fsType of Object.values(FsObjectType)) {
    if (returnType.includes(fsType) && !returnType.includes(`array<${fsType}>`)) {
      return fsType;
    }
  }
  return null;
}

/**
 * Whether an fs function's object-handle return can be null at RUNTIME (so the inferred type
 * should be `<fs.handle> | null`, not a bare non-null handle). True when the signature's
 * return type string includes `null` AND `nullMeansWrongType` is not set — i.e. the null is a
 * genuine runtime outcome (e.g. open() failing because the file doesn't exist), not merely a
 * "wrong argument type" sentinel that argument-type checking already rules out. Dropping this
 * null is a false negative: an unguarded `open(path).read()` would go unflagged. See
 * docs/done/flow-reassignment-union-call-gap.md.
 */
export function fsReturnIsNullable(funcName: string): boolean {
  const sig = fsModuleFunctions.get(funcName);
  if (!sig) return false;
  return sig.returnType.includes('null') && !sig.nullMeansWrongType;
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
  /** When true, null in returnType means only "wrong argument type" — safe to narrow away
   *  when argument types are known to be correct. When false/absent, null can occur at runtime
   *  even with correct argument types (e.g., open() failing because file doesn't exist). */
  nullMeansWrongType?: boolean;
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
    returnType: "fs.stat | null",
    description: "Gets file status information (follows symbolic links)"
  }],
  ["lstat", {
    name: "lstat",
    parameters: [
      { name: "path", type: "string", optional: false }
    ],
    returnType: "fs.stat | null",
    description: "Gets file status information (does not follow symbolic links)"
  }],
  ["mkdir", {
    name: "mkdir",
    parameters: [
      { name: "path", type: "string", optional: false },
      { name: "mode", type: "number", optional: true, defaultValue: 0o755 }
    ],
    returnType: "boolean | null",
    description: "Creates a directory. Returns true on success, null on failure"
  }],
  ["rmdir", {
    name: "rmdir",
    parameters: [
      { name: "path", type: "string", optional: false }
    ],
    returnType: "boolean | null",
    description: "Removes an empty directory. Returns true on success, null on failure"
  }],
  ["symlink", {
    name: "symlink",
    parameters: [
      { name: "target", type: "string", optional: false },
      { name: "linkpath", type: "string", optional: false }
    ],
    returnType: "boolean | null",
    description: "Creates a symbolic link. Returns true on success, null on failure"
  }],
  ["unlink", {
    name: "unlink",
    parameters: [
      { name: "path", type: "string", optional: false }
    ],
    returnType: "boolean | null",
    description: "Removes a file or symbolic link. Returns true on success, null on failure"
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
    description: "Changes the current working directory. Returns true on success, null on failure"
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
      { name: "uid", type: "number | string | null", optional: false },
      { name: "gid", type: "number | string | null", optional: false }
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
    returnType: "boolean | null",
    description: "Renames or moves a file. Returns true on success, null on failure"
  }],
  ["glob", {
    name: "glob",
    parameters: [
      { name: "pattern", type: "string", optional: false }
    ],
    returnType: "array<string> | null",
    nullMeansWrongType: true,
    description: "Finds files matching a pattern using shell wildcards"
  }],
  ["dirname", {
    name: "dirname",
    parameters: [
      { name: "path", type: "string", optional: false }
    ],
    returnType: "string | null",
    nullMeansWrongType: true,
    description: "Returns the directory portion of a path"
  }],
  ["basename", {
    name: "basename",
    parameters: [
      { name: "path", type: "string", optional: false },
      { name: "suffix", type: "string", optional: true }
    ],
    returnType: "string | null",
    nullMeansWrongType: true,
    description: "Returns the filename portion of a path, optionally removing suffix"
  }],
  ["lsdir", {
    name: "lsdir",
    parameters: [
      { name: "path", type: "string", optional: false }
    ],
    returnType: "array<string> | null",
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
      { name: "mode", type: "string", optional: true, defaultValue: "f" }
    ],
    returnType: "boolean | null",
    description: "Tests file accessibility. Mode is a string: 'r' (read), 'w' (write), 'x' (execute), 'f' (exists). Returns true if accessible, null otherwise"
  }],
  ["readfile", {
    name: "readfile",
    parameters: [
      { name: "path", type: "string", optional: false },
      { name: "size", type: "integer", optional: true }
    ],
    returnType: "string | null",
    description: "Reads the contents of a file as a string. If size is specified, reads at most that many bytes"
  }],
  ["writefile", {
    name: "writefile",
    parameters: [
      { name: "path", type: "string", optional: false },
      { name: "data", type: "any", optional: false },
      { name: "size", type: "integer", optional: true }
    ],
    returnType: "integer | null",
    description: "Writes data to a file. Any non-string data value is stringified. The optional third argument is a byte-count limit (how many bytes of the stringified data to write), not a permission mode. Returns the number of bytes written on success, null on failure."
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
    returnType: "array<fs.file> | null",
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
  objectExports: fsObjectExports,
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
    isValid: (name: string) => fsModuleFunctions.has(name) || fsConstants.has(name) || fsObjectExports.has(name),
    getValidImports: () => [...Array.from(fsModuleFunctions.keys()), ...Array.from(fsConstants.keys()), ...Array.from(fsObjectExports.keys())],
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

// stat()/lstat() result object shape — fixed, from uc_fs_stat_common (lib/fs.c).
// Nested `dev` and `perm` are their own object shapes.
export const statDevProperties: Map<string, StatvfsPropertySignature> = new Map([
  ["major", { name: "major", type: "integer", description: "Major device number" }],
  ["minor", { name: "minor", type: "integer", description: "Minor device number" }],
]);

export const statPermProperties: Map<string, StatvfsPropertySignature> = new Map([
  ["setuid", { name: "setuid", type: "boolean", description: "Set-user-ID bit (S_ISUID)" }],
  ["setgid", { name: "setgid", type: "boolean", description: "Set-group-ID bit (S_ISGID)" }],
  ["sticky", { name: "sticky", type: "boolean", description: "Sticky bit (S_ISVTX)" }],
  ["user_read", { name: "user_read", type: "boolean", description: "Owner read permission (S_IRUSR)" }],
  ["user_write", { name: "user_write", type: "boolean", description: "Owner write permission (S_IWUSR)" }],
  ["user_exec", { name: "user_exec", type: "boolean", description: "Owner execute permission (S_IXUSR)" }],
  ["group_read", { name: "group_read", type: "boolean", description: "Group read permission (S_IRGRP)" }],
  ["group_write", { name: "group_write", type: "boolean", description: "Group write permission (S_IWGRP)" }],
  ["group_exec", { name: "group_exec", type: "boolean", description: "Group execute permission (S_IXGRP)" }],
  ["other_read", { name: "other_read", type: "boolean", description: "Other read permission (S_IROTH)" }],
  ["other_write", { name: "other_write", type: "boolean", description: "Other write permission (S_IWOTH)" }],
  ["other_exec", { name: "other_exec", type: "boolean", description: "Other execute permission (S_IXOTH)" }],
]);

export const statProperties: Map<string, StatvfsPropertySignature> = new Map([
  ["dev", { name: "dev", type: "fs.stat.dev", description: "Device the inode resides on ({major, minor})" }],
  ["perm", { name: "perm", type: "fs.stat.perm", description: "Permission bits, broken out as booleans" }],
  ["inode", { name: "inode", type: "integer", description: "Inode number" }],
  ["mode", { name: "mode", type: "integer", description: "Permission mode bits (st_mode without the file-type bits)" }],
  ["nlink", { name: "nlink", type: "integer", description: "Number of hard links" }],
  ["uid", { name: "uid", type: "integer", description: "Owner user ID" }],
  ["gid", { name: "gid", type: "integer", description: "Owner group ID" }],
  ["size", { name: "size", type: "integer", description: "File size in bytes" }],
  ["blksize", { name: "blksize", type: "integer", description: "Preferred I/O block size" }],
  ["blocks", { name: "blocks", type: "integer", description: "Number of 512-byte blocks allocated" }],
  ["atime", { name: "atime", type: "integer", description: "Last access time (Unix epoch seconds)" }],
  ["mtime", { name: "mtime", type: "integer", description: "Last modification time (Unix epoch seconds)" }],
  ["ctime", { name: "ctime", type: "integer", description: "Last status-change time (Unix epoch seconds)" }],
  ["type", { name: "type", type: "string", description: 'File type: "file", "directory", "char", "block", "fifo", "link", "socket", or "unknown"' }],
]);

const makeStatObjectType = (typeName: string, props: Map<string, StatvfsPropertySignature>): ObjectTypeDefinition => ({
  typeName,
  isPropertyBased: true,
  methods: new Map(),
  properties: props as ReadonlyMap<string, PropertyDefinition>,
  formatPropertyDoc: (_name: string, prop: PropertyDefinition) =>
    `**(${typeName} property) ${prop.name}**: \`${prop.type}\`\n\n${prop.description}`,
});

export const statObjectType: ObjectTypeDefinition = makeStatObjectType('fs.stat', statProperties);
export const statDevObjectType: ObjectTypeDefinition = makeStatObjectType('fs.stat.dev', statDevProperties);
export const statPermObjectType: ObjectTypeDefinition = makeStatObjectType('fs.stat.perm', statPermProperties);