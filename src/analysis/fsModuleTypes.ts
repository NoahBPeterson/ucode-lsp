/**
 * FS module type definitions and function signatures
 * Based on static const uc_function_list_t global_fns[] in ucode fs module
 */

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
      { name: "mode", type: "string", optional: true, defaultValue: "r" }
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
  }]
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