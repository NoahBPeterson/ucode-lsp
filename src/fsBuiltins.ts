/**
 * fs Module Function Documentation
 * Based on ucode/lib/fs.c analysis
 */

export const fsModuleFunctions = new Map<string, string>([
  ['error', 'Get error information for the last fs operation.\n\n**Returns:** `string|null` - Description of the last error, or null if no error\n\n**Example:**\n```ucode\nunlink(\'/path/does/not/exist\');\nprint(fs.error()); // "No such file or directory"\n```'],

  ['open', 'Open a file and return a file handle.\n\n**Parameters:**\n- `path: string` - Path to the file\n- `mode: string` - Open mode (default "r"): "r", "w", "a", "r+", "w+", "a+" with optional "x", "e" flags\n- `perm: number` - File creation permissions (default 0o666)\n\n**Returns:** `fs.file|null` - File handle object or null on error\n\n**Can throw:** Returns null on error (check fs.error())\n\n**Example:**\n```ucode\nconst file = fs.open(\'file.txt\', \'r\');\nif (file) {\n  const content = file.read("all");\n  file.close();\n}\n```'],

  ['fdopen', 'Associate a file descriptor with a file handle.\n\n**Parameters:**\n- `fd: number` - File descriptor number\n- `mode: string` - Open mode (default "r")\n\n**Returns:** `fs.file|null` - File handle object or null on error\n\n**Can throw:** Returns null on error (check fs.error())\n\n**Example:**\n```ucode\nconst stdin = fs.fdopen(0, \'r\');\n```'],

  ['opendir', 'Open a directory and return a directory handle.\n\n**Parameters:**\n- `path: string` - Path to the directory\n\n**Returns:** `fs.dir|null` - Directory handle object or null on error\n\n**Can throw:** Returns null on error (check fs.error())\n\n**Example:**\n```ucode\nconst dir = fs.opendir(\'/etc\');\nif (dir) {\n  let entry;\n  while ((entry = dir.read()) !== null) {\n    print(entry);\n  }\n  dir.close();\n}\n```'],

  ['popen', 'Start a process and return a handle for interacting with it.\n\n**Parameters:**\n- `command: string` - Command to execute\n- `mode: string` - Open mode (default "r"): "r" for reading, "w" for writing, optional "e" flag\n\n**Returns:** `fs.proc|null` - Process handle object or null on error\n\n**Can throw:** Returns null on error (check fs.error())\n\n**Example:**\n```ucode\nconst proc = fs.popen(\'ls -la\', \'r\');\nif (proc) {\n  const output = proc.read("all");\n  const exitCode = proc.close();\n}\n```'],

  ['readlink', 'Read the target of a symbolic link.\n\n**Parameters:**\n- `path: string` - Path to the symbolic link\n\n**Returns:** `string|null` - Target path or null on error\n\n**Can throw:** Returns null on error (check fs.error())\n\n**Example:**\n```ucode\nconst target = fs.readlink(\'/sys/class/net/eth0\');\n```'],

  ['stat', 'Get information about a file or directory.\n\n**Parameters:**\n- `path: string` - Path to the file or directory\n\n**Returns:** `object|null` - Stat object with file information or null on error\n\n**Can throw:** Returns null on error (check fs.error())\n\n**Example:**\n```ucode\nconst info = fs.stat(\'/etc/passwd\');\nif (info) {\n  print("Size:", info.size);\n  print("Type:", info.type);\n}\n```'],

  ['lstat', 'Get information about a file or directory (without following symlinks).\n\n**Parameters:**\n- `path: string` - Path to the file or directory\n\n**Returns:** `object|null` - Stat object with file information or null on error\n\n**Can throw:** Returns null on error (check fs.error())\n\n**Example:**\n```ucode\nconst info = fs.lstat(\'/etc/passwd\');\n```'],

  ['mkdir', 'Create a new directory.\n\n**Parameters:**\n- `path: string` - Path to the new directory\n- `mode: number` - Directory permissions (default 0o777)\n\n**Returns:** `boolean|null` - true on success, null on error\n\n**Can throw:** Returns null on error (check fs.error())\n\n**Example:**\n```ucode\nconst success = fs.mkdir(\'/tmp/newdir\', 0o755);\n```'],

  ['rmdir', 'Remove a directory.\n\n**Parameters:**\n- `path: string` - Path to the directory\n\n**Returns:** `boolean|null` - true on success, null on error\n\n**Can throw:** Returns null on error (check fs.error())\n\n**Example:**\n```ucode\nconst success = fs.rmdir(\'/tmp/olddir\');\n```'],

  ['symlink', 'Create a symbolic link.\n\n**Parameters:**\n- `target: string` - Target path\n- `linkpath: string` - Symbolic link path\n\n**Returns:** `boolean|null` - true on success, null on error\n\n**Can throw:** Returns null on error (check fs.error())\n\n**Example:**\n```ucode\nconst success = fs.symlink(\'/target/path\', \'/link/path\');\n```'],

  ['unlink', 'Remove a file.\n\n**Parameters:**\n- `path: string` - Path to the file\n\n**Returns:** `boolean|null` - true on success, null on error\n\n**Can throw:** Returns null on error (check fs.error())\n\n**Example:**\n```ucode\nconst success = fs.unlink(\'/tmp/tempfile\');\n```'],

  ['getcwd', 'Get the current working directory.\n\n**Returns:** `string|null` - Current working directory path or null on error\n\n**Can throw:** Returns null on error (check fs.error())\n\n**Example:**\n```ucode\nconst cwd = fs.getcwd();\n```'],

  ['chdir', 'Change the current working directory.\n\n**Parameters:**\n- `path: string` - Path to the new working directory\n\n**Returns:** `boolean|null` - true on success, null on error\n\n**Can throw:** Returns null on error (check fs.error())\n\n**Example:**\n```ucode\nconst success = fs.chdir(\'/new/directory\');\n```'],

  ['chmod', 'Change file or directory permissions.\n\n**Parameters:**\n- `path: string` - Path to the file or directory\n- `mode: number` - New permission mode\n\n**Returns:** `boolean|null` - true on success, null on error\n\n**Can throw:** Returns null on error (check fs.error())\n\n**Example:**\n```ucode\nconst success = fs.chmod(\'/path/to/file\', 0o644);\n```'],

  ['chown', 'Change file or directory ownership.\n\n**Parameters:**\n- `path: string` - Path to the file or directory\n- `user: number|string|null` - User ID or username\n- `group: number|string|null` - Group ID or group name\n\n**Returns:** `boolean|null` - true on success, null on error\n\n**Can throw:** Returns null on error (check fs.error())\n\n**Example:**\n```ucode\nconst success = fs.chown(\'/path/to/file\', \'user\', \'group\');\n```'],

  ['rename', 'Rename a file or directory.\n\n**Parameters:**\n- `oldpath: string` - Current path\n- `newpath: string` - New path\n\n**Returns:** `boolean|null` - true on success, null on error\n\n**Can throw:** Returns null on error (check fs.error())\n\n**Example:**\n```ucode\nconst success = fs.rename(\'/old/path\', \'/new/path\');\n```'],

  ['glob', 'Match file paths using glob patterns.\n\n**Parameters:**\n- `...patterns: string[]` - One or more glob patterns\n\n**Returns:** `string[]|null` - Array of matching paths or null on error\n\n**Can throw:** Returns null on error (check fs.error())\n\n**Example:**\n```ucode\nconst files = fs.glob(\'*.txt\', \'*.log\');\n```'],

  ['dirname', 'Get the directory name of a path.\n\n**Parameters:**\n- `path: string` - File path\n\n**Returns:** `string|null` - Directory name or null on invalid input\n\n**Example:**\n```ucode\nconst dir = fs.dirname(\'/path/to/file.txt\'); // "/path/to"\n```'],

  ['basename', 'Get the base name of a path.\n\n**Parameters:**\n- `path: string` - File path\n\n**Returns:** `string|null` - Base name or null on invalid input\n\n**Example:**\n```ucode\nconst name = fs.basename(\'/path/to/file.txt\'); // "file.txt"\n```'],

  ['lsdir', 'List directory contents.\n\n**Parameters:**\n- `path: string` - Path to the directory\n- `pattern: string|RegExp|null` - Optional filter pattern\n\n**Returns:** `string[]|null` - Array of file names or null on error\n\n**Can throw:** Returns null on error (check fs.error())\n\n**Example:**\n```ucode\nconst files = fs.lsdir(\'/etc\');\nconst txtFiles = fs.lsdir(\'/docs\', \'*.txt\');\n```'],

  ['mkstemp', 'Create a unique temporary file.\n\n**Parameters:**\n- `template: string` - Path template (default "/tmp/XXXXXX")\n\n**Returns:** `fs.file|null` - File handle for temporary file or null on error\n\n**Can throw:** Returns null on error (check fs.error())\n\n**Example:**\n```ucode\nconst tempFile = fs.mkstemp(\'./data-XXXXXX\');\nif (tempFile) {\n  tempFile.write(\'temporary data\');\n  tempFile.close();\n}\n```'],

  ['access', 'Check file or directory accessibility.\n\n**Parameters:**\n- `path: string` - Path to the file or directory\n- `modes: string` - Access modes to check: "r" (read), "w" (write), "x" (execute), "f" (exists)\n\n**Returns:** `boolean|null` - true if accessible, false if not, null on error\n\n**Can throw:** Returns null on error (check fs.error())\n\n**Example:**\n```ucode\nconst canRead = fs.access(\'/etc/passwd\', \'r\');\nconst exists = fs.access(\'/some/file\', \'f\');\n```'],

  ['readfile', 'Read the contents of a file.\n\n**Parameters:**\n- `path: string` - Path to the file\n- `limit: number` - Optional byte limit\n\n**Returns:** `string|null` - File contents or null on error\n\n**Can throw:** Returns null on error (check fs.error())\n\n**Example:**\n```ucode\nconst content = fs.readfile(\'/etc/hostname\');\nconst first100 = fs.readfile(\'/var/log/syslog\', 100);\n```'],

  ['writefile', 'Write data to a file.\n\n**Parameters:**\n- `path: string` - Path to the file\n- `data: any` - Data to write\n- `limit: number` - Optional truncation limit\n\n**Returns:** `number|null` - Number of bytes written or null on error\n\n**Can throw:** Returns null on error (check fs.error())\n\n**Example:**\n```ucode\nconst bytes = fs.writefile(\'/tmp/output.txt\', \'Hello World!\');\n```'],

  ['realpath', 'Resolve the absolute path.\n\n**Parameters:**\n- `path: string` - Path to resolve\n\n**Returns:** `string|null` - Absolute path or null on error\n\n**Can throw:** Returns null on error (check fs.error())\n\n**Example:**\n```ucode\nconst absolute = fs.realpath(\'../relative/path\');\n```'],

  ['pipe', 'Create a pipe and return read/write file handles.\n\n**Returns:** `fs.file[]|null` - Array of [read_handle, write_handle] or null on error\n\n**Can throw:** Returns null on error (check fs.error())\n\n**Example:**\n```ucode\nconst handles = fs.pipe();\nif (handles) {\n  handles[1].write("Hello world\\n");\n  const data = handles[0].read("line");\n  handles[0].close();\n  handles[1].close();\n}\n```'],

  // Pre-defined file handles
  ['stdin', 'Standard input file handle.\n\n**Type:** `fs.file` - Pre-opened file handle for stdin (fd 0)\n\n**Example:**\n```ucode\nconst line = fs.stdin.read("line");\n```'],

  ['stdout', 'Standard output file handle.\n\n**Type:** `fs.file` - Pre-opened file handle for stdout (fd 1)\n\n**Example:**\n```ucode\nfs.stdout.write("Hello World\\n");\n```'],

  ['stderr', 'Standard error file handle.\n\n**Type:** `fs.file` - Pre-opened file handle for stderr (fd 2)\n\n**Example:**\n```ucode\nfs.stderr.write("Error message\\n");\n```']
]);

// Helper function to get fs method documentation
export function getFsMethodDoc(methodName: string): string | undefined {
  return fsModuleFunctions.get(methodName);
}

// Get all fs method names
export function getAllFsMethodNames(): string[] {
  return Array.from(fsModuleFunctions.keys());
}

// Get a summary of available fs methods for hover display
export function getFsModuleSummary(): string {
  const methods = Array.from(fsModuleFunctions.keys());
  const fileOps = ['open', 'readfile', 'writefile', 'access', 'realpath'];
  const dirOps = ['opendir', 'mkdir', 'rmdir', 'lsdir', 'getcwd', 'chdir'];
  const metaOps = ['stat', 'lstat', 'chmod', 'chown', 'rename'];
  const linkOps = ['symlink', 'readlink', 'unlink'];
  const utilOps = ['dirname', 'basename', 'glob', 'mkstemp', 'pipe'];
  const handles = ['stdin', 'stdout', 'stderr'];
  
  let summary = 'Filesystem module providing file and directory operations.\n\n';
  summary += '**File Operations:** `' + fileOps.join('`, `') + '`\n\n';
  summary += '**Directory Operations:** `' + dirOps.join('`, `') + '`\n\n';
  summary += '**Metadata Operations:** `' + metaOps.join('`, `') + '`\n\n';
  summary += '**Link Operations:** `' + linkOps.join('`, `') + '`\n\n';
  summary += '**Utility Operations:** `' + utilOps.join('`, `') + '`\n\n';
  summary += '**Pre-defined Handles:** `' + handles.join('`, `') + '`\n\n';
  summary += '**Error Handling:** All methods return `null` on error. Call `fs.error()` for details.\n\n';
  summary += `**Available Methods** (${methods.length}): Type \`fs.\` to see autocomplete suggestions.`;
  
  return summary;
}