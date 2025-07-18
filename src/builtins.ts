export const builtinFunctions = new Map<string, string>([
    ['print', 'Print any of the given values to stdout.\n\n**Parameters:**\n- `...values` - Arbitrary values to print\n\n**Returns:** `number` - The amount of bytes written'],
    ['printf', 'Print formatted string to stdout.\n\n**Parameters:**\n- `format` - Format string\n- `...args` - Arguments for formatting\n\n**Returns:** `number` - The amount of bytes written'],
    ['sprintf', 'Return formatted string.\n\n**Parameters:**\n- `format` - Format string\n- `...args` - Arguments for formatting\n\n**Returns:** `string` - The formatted string'],
    ['length', 'Determine the length of the given object, array or string.\n\n**Parameters:**\n- `x` - The input object, array, or string\n\n**Returns:** `number|null` - The length of the input\n\n**Example:**\n```ucode\nlength("test")                             // 4\nlength([true, false, null, 123, "test"])   // 5\n```'],
    ['substr', 'Extract substring from string.\n\n**Parameters:**\n- `string` - The input string\n- `start` - Start position\n- `length` - Length of substring (optional)\n\n**Returns:** `string` - The extracted substring'],
    ['split', 'Split string into array of substrings.\n\n**Parameters:**\n- `string` - The input string\n- `separator` - String or regex to split on\n- `limit` - Maximum number of splits (optional)\n\n**Returns:** `array` - Array of substrings'],
    ['join', 'Join array elements into string.\n\n**Parameters:**\n- `separator` - String to join with\n- `array` - Array to join\n\n**Returns:** `string` - The joined string\n\n**Note:** Parameter order is `join(separator, array)` - different from JavaScript!'],
    ['trim', 'Remove whitespace from both ends of string.\n\n**Parameters:**\n- `string` - The input string\n\n**Returns:** `string` - The trimmed string'],
    ['ltrim', 'Remove whitespace from left end of string.\n\n**Parameters:**\n- `string` - The input string\n\n**Returns:** `string` - The left-trimmed string'],
    ['rtrim', 'Remove whitespace from right end of string.\n\n**Parameters:**\n- `string` - The input string\n\n**Returns:** `string` - The right-trimmed string'],
    ['chr', 'Convert ASCII code to character.\n\n**Parameters:**\n- `code` - ASCII code number\n\n**Returns:** `string` - The character'],
    ['ord', 'Get ASCII code of character.\n\n**Parameters:**\n- `char` - The character\n\n**Returns:** `number` - The ASCII code'],
    ['uc', 'Convert string to uppercase.\n\n**Parameters:**\n- `string` - The string to convert\n\n**Returns:** `string` - Uppercase string'],
    ['lc', 'Convert string to lowercase.\n\n**Parameters:**\n- `string` - The string to convert\n\n**Returns:** `string` - Lowercase string'],
    ['type', 'Get type of value.\n\n**Parameters:**\n- `value` - The value to check\n\n**Returns:** `string` - Type name ("object", "array", "string", "number", "boolean", "function", "null")'],
    ['keys', 'Get array of object keys.\n\n**Parameters:**\n- `object` - The object\n\n**Returns:** `array|null` - Array of property names, or null if not an object'],
    ['values', 'Get array of object values.\n\n**Parameters:**\n- `object` - The object\n\n**Returns:** `array|null` - Array of property values, or null if not an object'],
    ['push', 'Add elements to end of array.\n\n**Parameters:**\n- `array` - The array\n- `...values` - Values to add\n\n**Returns:** `number` - New length of array'],
    ['pop', 'Remove and return last element from array.\n\n**Parameters:**\n- `array` - The array\n\n**Returns:** `*` - The removed element'],
    ['shift', 'Remove and return first element from array.\n\n**Parameters:**\n- `array` - The array\n\n**Returns:** `*` - The removed element'],
    ['unshift', 'Add elements to beginning of array.\n\n**Parameters:**\n- `array` - The array\n- `...values` - Values to add\n\n**Returns:** `number` - New length of array'],
    ['index', 'Find index of substring or element.\n\n**Parameters:**\n- `haystack` - String or array to search in\n- `needle` - Value to search for\n\n**Returns:** `number` - Index of first occurrence, or -1 if not found\n\n**Note:** Parameter order is `index(haystack, needle)`'],
    ['require', 'Load and return module.\n\n**Parameters:**\n- `module` - Module name or path\n\n**Returns:** `*` - The loaded module'],
    ['include', 'Include file contents inline.\n\n**Parameters:**\n- `path` - Path to file\n\n**Returns:** `*` - Result of included file'],
    ['json', 'Parse JSON string or stringify value.\n\n**Parameters:**\n- `value` - String to parse or value to stringify\n\n**Returns:** `*` - Parsed object or JSON string'],
    ['match', 'Match string against regex.\n\n**Parameters:**\n- `string` - The string to match\n- `regex` - Regular expression\n\n**Returns:** `array|null` - Match results or null'],
    ['replace', 'Replace occurrences in string.\n\n**Parameters:**\n- `string` - The string\n- `search` - String or regex to search for\n- `replacement` - Replacement string\n\n**Returns:** `string` - String with replacements'],
    ['system', 'Execute shell command.\n\n**Parameters:**\n- `command` - Command to execute\n\n**Returns:** `number` - Exit code of command'],
    ['time', 'Get current Unix timestamp.\n\n**Returns:** `number` - Current time in seconds since epoch'],
    ['sleep', 'Pause execution for specified seconds.\n\n**Parameters:**\n- `seconds` - Number of seconds to sleep\n\n**Returns:** `null`'],
    ['localtime', 'Convert timestamp to local time components.\n\n**Parameters:**\n- `timestamp` - Unix timestamp (optional, defaults to current time)\n\n**Returns:** `array` - Time components: [year, month, day, hour, minute, second, weekday, yearday]'],
    ['gmtime', 'Convert timestamp to UTC time components.\n\n**Parameters:**\n- `timestamp` - Unix timestamp (optional, defaults to current time)\n\n**Returns:** `array` - Time components: [year, month, day, hour, minute, second, weekday, yearday]'],
    ['timelocal', 'Convert local time components to timestamp.\n\n**Parameters:**\n- `timeArray` - Array of time components [year, month, day, hour, minute, second]\n\n**Returns:** `number` - Unix timestamp'],
    ['timegm', 'Convert UTC time components to timestamp.\n\n**Parameters:**\n- `timeArray` - Array of time components [year, month, day, hour, minute, second]\n\n**Returns:** `number` - Unix timestamp'],
    ['min', 'Find minimum value from numbers.\n\n**Parameters:**\n- `...numbers` - Numbers to compare\n\n**Returns:** `number` - The smallest number'],
    ['max', 'Find maximum value from numbers.\n\n**Parameters:**\n- `...numbers` - Numbers to compare\n\n**Returns:** `number` - The largest number'],
    ['uniq', 'Remove duplicate values from array.\n\n**Parameters:**\n- `array` - The input array\n\n**Returns:** `array` - Array with unique values'],
    ['b64enc', 'Encode string to Base64.\n\n**Parameters:**\n- `string` - String to encode\n\n**Returns:** `string` - Base64 encoded string'],
    ['b64dec', 'Decode Base64 string.\n\n**Parameters:**\n- `string` - Base64 string to decode\n\n**Returns:** `string` - Decoded string'],
    ['hexenc', 'Encode string to hexadecimal.\n\n**Parameters:**\n- `string` - String to encode\n\n**Returns:** `string` - Hexadecimal encoded string'],
    ['hexdec', 'Decode hexadecimal string.\n\n**Parameters:**\n- `string` - Hexadecimal string to decode\n\n**Returns:** `string` - Decoded string'],
    ['hex', 'Convert number to hexadecimal string.\n\n**Parameters:**\n- `number` - Number to convert\n\n**Returns:** `string` - Hexadecimal representation'],
    ['uchr', 'Convert Unicode code point to character.\n\n**Parameters:**\n- `code` - Unicode code point\n\n**Returns:** `string` - The Unicode character'],
    ['iptoarr', 'Convert IP address string to array of components.\n\n**Parameters:**\n- `ipString` - IP address string (IPv4 or IPv6)\n\n**Returns:** `array` - Array of IP address components\n\n**Example:**\n```ucode\niptoarr("192.168.1.1")  // [192, 168, 1, 1]\n```'],
    ['arrtoip', 'Convert array of IP components to IP address string.\n\n**Parameters:**\n- `ipArray` - Array of IP address components\n\n**Returns:** `string` - IP address string\n\n**Example:**\n```ucode\narrtoip([192, 168, 1, 1])  // "192.168.1.1"\n```'],
    ['int', 'Convert value to integer.\n\n**Parameters:**\n- `value` - String or number to convert to integer\n\n**Returns:** `number` - Integer value\n\n**Example:**\n```ucode\nint("123")    // 123\nint(45.67)    // 45\nint("-89")    // -89\n```'],
    ['loadstring', 'Load and execute uCode from string.\n\n**Parameters:**\n- `code` - String containing uCode source code\n\n**Returns:** `*` - Result of executed code\n\n**Example:**\n```ucode\nloadstring("return 42")()  // 42\n```'],
    ['loadfile', 'Load and execute uCode from file.\n\n**Parameters:**\n- `path` - Path to uCode file\n\n**Returns:** `*` - Result of executed file\n\n**Example:**\n```ucode\nloadfile("script.uc")()\n```'],
    ['wildcard', 'Test if a wildcard pattern matches a subject string.\n\n**Parameters:**\n- `pattern` - Wildcard pattern string (supports *, ?, [abc])\n- `subject` - String to test against the pattern\n\n**Returns:** `boolean` - True if pattern matches, false otherwise\n\n**Example:**\n```ucode\nwildcard("*.txt", "document.txt")    // true\nwildcard("test?", "test1")           // true\nwildcard("[0-9]*", "5files")         // true\n```'],
    ['regexp', 'Compile a regular expression from pattern string.\n\n**Parameters:**\n- `pattern` - Regular expression pattern string\n- `flags` - Optional flags string ("i", "g", "s", "m")\n\n**Returns:** `regexp` - Compiled regular expression object\n\n**Example:**\n```ucode\nlet re = regexp("[0-9]+", "g");\nmatch("test123", re);  // ["123"]\n```'],
    ['assert', 'Assert that a condition is true, throw exception if false.\n\n**Parameters:**\n- `condition` - Value to test for truthiness\n- `message` - Optional error message string\n\n**Returns:** `*` - The condition value if truthy\n\n**Throws:** Exception if condition is falsy\n\n**Example:**\n```ucode\nassert(x > 0, "x must be positive");\nassert(array.length > 0);\n```'],
    ['call', 'Invoke a function with modified context and environment.\n\n**Parameters:**\n- `function` - Function to invoke\n- `thisContext` - Value for "this" context (optional)\n- `environment` - Global environment object (optional)\n- `...args` - Arguments to pass to function\n\n**Returns:** `*` - Result of function call\n\n**Example:**\n```ucode\ncall(myFunction, null, null, arg1, arg2);\n```'],
    ['signal', 'Set up signal handlers for Unix signals.\n\n**Parameters:**\n- `signal` - Signal number or name (with/without "SIG" prefix)\n- `handler` - Handler function (optional)\n\n**Returns:** `*` - Previous handler or signal behavior\n\n**Example:**\n```ucode\nsignal(15, function() { print("SIGTERM received"); });\nsignal("SIGINT", exitHandler);\n```'],
    ['type', 'Get the type of a value.\n\n**Parameters:**\n- `value` - Any value to inspect\n\n**Returns:** `string` - Type name ("object", "array", "string", "number", "boolean", "function", "null")\n\n**Example:**\n```ucode\ntype(42);        // "number"\ntype([1,2,3]);   // "array"\ntype("hello");   // "string"\n```'],
    ['clock', 'Get current process CPU time.\n\n**Returns:** `number` - CPU time in seconds\n\n**Example:**\n```ucode\nlet start = clock();\n// ... do work ...\nlet elapsed = clock() - start;\n```'],
    ['sourcepath', 'Get the path of the current source file.\n\n**Returns:** `string` - Absolute path to current source file\n\n**Example:**\n```ucode\nlet currentFile = sourcepath();\nprint("Running:", currentFile);\n```'],
    ['gc', 'Trigger garbage collection.\n\n**Returns:** `null`\n\n**Example:**\n```ucode\ngc();  // Force garbage collection\n```']
]);

// ============================================================================
// File System Built-in Functions (from fs.c global_fns[])
// These are global functions, not methods of an fs module object
// ============================================================================

export const fsBuiltinFunctions = new Map<string, string>([
    ['error', '**error()** - Get error information for the last fs operation.\n\n**Returns:** `string|null` - Description of the last error, or null if no error\n\n**Example:**\n```ucode\nunlink("/path/does/not/exist");\nprint(error()); // "No such file or directory"\n```'],
    
    ['open', '**open(path, mode, perm)** - Open a file and return a file handle.\n\n**Parameters:**\n- `path` (string): Path to the file\n- `mode` (string): Open mode ("r", "w", "a", "r+", "w+", "a+")\n- `perm` (number): File creation permissions (optional, default 0o666)\n\n**Returns:** `object|null` - File handle object or null on error\n\n**Example:**\n```ucode\nlet file = open("/tmp/test.txt", "w");\nif (file) {\n    file.write("Hello World");\n    file.close();\n}\n```'],
    
    ['fdopen', '**fdopen(fd, mode)** - Create a file handle from a file descriptor.\n\n**Parameters:**\n- `fd` (number): File descriptor number\n- `mode` (string): Open mode ("r", "w", "a")\n\n**Returns:** `object|null` - File handle object or null on error\n\n**Example:**\n```ucode\nlet stdin = fdopen(0, "r");\n```'],
    
    ['opendir', '**opendir(path)** - Open a directory for reading.\n\n**Parameters:**\n- `path` (string): Path to the directory\n\n**Returns:** `object|null` - Directory handle object or null on error\n\n**Example:**\n```ucode\nlet dir = opendir("/etc");\nif (dir) {\n    let entry;\n    while ((entry = dir.read()) !== null) {\n        print(entry);\n    }\n    dir.close();\n}\n```'],
    
    ['popen', '**popen(command, mode)** - Open a pipe to a command.\n\n**Parameters:**\n- `command` (string): Command to execute\n- `mode` (string): Pipe mode ("r" for reading, "w" for writing)\n\n**Returns:** `object|null` - Process handle object or null on error\n\n**Example:**\n```ucode\nlet proc = popen("ls -la", "r");\nif (proc) {\n    let output = proc.read("all");\n    let exitCode = proc.close();\n}\n```'],
    
    ['readlink', '**readlink(path)** - Read the target of a symbolic link.\n\n**Parameters:**\n- `path` (string): Path to the symbolic link\n\n**Returns:** `string|null` - Target path or null on error\n\n**Example:**\n```ucode\nlet target = readlink("/sys/class/net/eth0");\n```'],
    
    ['stat', '**stat(path)** - Get information about a file or directory.\n\n**Parameters:**\n- `path` (string): Path to the file or directory\n\n**Returns:** `object|null` - Stat object with file information or null on error\n\n**Example:**\n```ucode\nlet info = stat("/etc/passwd");\nif (info) {\n    print("Size:", info.size);\n    print("Type:", info.type);\n}\n```'],
    
    ['lstat', '**lstat(path)** - Get information about a file (don\'t follow symlinks).\n\n**Parameters:**\n- `path` (string): Path to the file or directory\n\n**Returns:** `object|null` - Stat object with file information or null on error\n\n**Example:**\n```ucode\nlet info = lstat("/etc/passwd");\n```'],
    
    ['mkdir', '**mkdir(path, mode)** - Create a new directory.\n\n**Parameters:**\n- `path` (string): Path for the new directory\n- `mode` (number): Directory permissions (optional, default 0o777)\n\n**Returns:** `boolean|null` - true on success, null on error\n\n**Example:**\n```ucode\nif (mkdir("/tmp/newdir", 0o755)) {\n    print("Directory created");\n}\n```'],
    
    ['rmdir', '**rmdir(path)** - Remove a directory.\n\n**Parameters:**\n- `path` (string): Path to the directory to remove\n\n**Returns:** `boolean|null` - true on success, null on error\n\n**Example:**\n```ucode\nif (rmdir("/tmp/olddir")) {\n    print("Directory removed");\n}\n```'],
    
    ['symlink', '**symlink(target, path)** - Create a symbolic link.\n\n**Parameters:**\n- `target` (string): Target of the symbolic link\n- `path` (string): Path for the new symbolic link\n\n**Returns:** `boolean|null` - true on success, null on error\n\n**Example:**\n```ucode\nif (symlink("/target/file", "/path/to/symlink")) {\n    print("Symlink created");\n}\n```'],
    
    ['unlink', '**unlink(path)** - Remove a file.\n\n**Parameters:**\n- `path` (string): Path to the file to remove\n\n**Returns:** `boolean|null` - true on success, null on error\n\n**Example:**\n```ucode\nif (unlink("/tmp/tempfile")) {\n    print("File removed");\n}\n```'],
    
    ['getcwd', '**getcwd()** - Get the current working directory.\n\n**Returns:** `string|null` - Current working directory path or null on error\n\n**Example:**\n```ucode\nlet cwd = getcwd();\nprint("Current directory:", cwd);\n```'],
    
    ['chdir', '**chdir(path)** - Change the current working directory.\n\n**Parameters:**\n- `path` (string): Path to the new working directory\n\n**Returns:** `boolean|null` - true on success, null on error\n\n**Example:**\n```ucode\nif (chdir("/new/directory")) {\n    print("Changed directory");\n}\n```'],
    
    ['chmod', '**chmod(path, mode)** - Change file permissions.\n\n**Parameters:**\n- `path` (string): Path to the file\n- `mode` (number): New permissions\n\n**Returns:** `boolean|null` - true on success, null on error\n\n**Example:**\n```ucode\nif (chmod("/path/to/file", 0o644)) {\n    print("Permissions changed");\n}\n```'],
    
    ['chown', '**chown(path, uid, gid)** - Change file ownership.\n\n**Parameters:**\n- `path` (string): Path to the file\n- `uid` (number): New user ID\n- `gid` (number): New group ID\n\n**Returns:** `boolean|null` - true on success, null on error\n\n**Example:**\n```ucode\nif (chown("/path/to/file", 1000, 1000)) {\n    print("Ownership changed");\n}\n```'],
    
    ['rename', '**rename(oldpath, newpath)** - Rename or move a file.\n\n**Parameters:**\n- `oldpath` (string): Current path\n- `newpath` (string): New path\n\n**Returns:** `boolean|null` - true on success, null on error\n\n**Example:**\n```ucode\nif (rename("/old/path", "/new/path")) {\n    print("File renamed");\n}\n```'],
    
    ['glob', '**glob(pattern)** - Find pathnames matching a pattern.\n\n**Parameters:**\n- `pattern` (string): Glob pattern to match\n\n**Returns:** `array|null` - Array of matching paths or null on error\n\n**Example:**\n```ucode\nlet files = glob("/tmp/*.txt");\nfor (let file in files) {\n    print(file);\n}\n```'],
    
    ['dirname', '**dirname(path)** - Get the directory part of a path.\n\n**Parameters:**\n- `path` (string): File path\n\n**Returns:** `string|null` - Directory name or null on invalid input\n\n**Example:**\n```ucode\nlet dir = dirname("/path/to/file.txt"); // "/path/to"\n```'],
    
    ['basename', '**basename(path)** - Get the filename part of a path.\n\n**Parameters:**\n- `path` (string): File path\n\n**Returns:** `string|null` - Base name or null on invalid input\n\n**Example:**\n```ucode\nlet name = basename("/path/to/file.txt"); // "file.txt"\n```'],
    
    ['lsdir', '**lsdir(path)** - List directory contents.\n\n**Parameters:**\n- `path` (string): Path to the directory\n\n**Returns:** `array|null` - Array of file names or null on error\n\n**Example:**\n```ucode\nlet files = lsdir("/etc");\nfor (let file in files) {\n    print(file);\n}\n```'],
    
    ['mkstemp', '**mkstemp(template)** - Create a temporary file.\n\n**Parameters:**\n- `template` (string): Template for the temporary filename\n\n**Returns:** `object|null` - File handle for temporary file or null on error\n\n**Example:**\n```ucode\nlet tempFile = mkstemp("/tmp/tempXXXXXX");\nif (tempFile) {\n    tempFile.write("temporary data");\n    tempFile.close();\n}\n```'],
    
    ['access', '**access(path, mode)** - Check file accessibility.\n\n**Parameters:**\n- `path` (string): Path to the file\n- `mode` (string): Access mode to check ("r", "w", "x", "f")\n\n**Returns:** `boolean|null` - true if accessible, false if not, null on error\n\n**Example:**\n```ucode\nif (access("/etc/passwd", "r")) {\n    print("File is readable");\n}\n```'],
    
    ['readfile', '**readfile(path)** - Read the contents of a file.\n\n**Parameters:**\n- `path` (string): Path to the file to read\n\n**Returns:** `string|null` - File contents or null on error\n\n**Example:**\n```ucode\nlet content = readfile("/etc/hostname");\nif (content) {\n    print("Hostname:", trim(content));\n}\n```'],
    
    ['writefile', '**writefile(path, data)** - Write data to a file.\n\n**Parameters:**\n- `path` (string): Path to the file\n- `data` (string): Data to write\n\n**Returns:** `number|null` - Number of bytes written or null on error\n\n**Example:**\n```ucode\nlet bytes = writefile("/tmp/output.txt", "Hello World!");\nif (bytes) {\n    print("Wrote", bytes, "bytes");\n}\n```'],
    
    ['realpath', '**realpath(path)** - Resolve a pathname to its canonical form.\n\n**Parameters:**\n- `path` (string): Path to resolve\n\n**Returns:** `string|null` - Absolute path or null on error\n\n**Example:**\n```ucode\nlet resolved = realpath("../relative/path");\n```'],
    
    ['pipe', '**pipe()** - Create a pipe (returns array of file descriptors).\n\n**Returns:** `array|null` - Array of [readfd, writefd] or null on error\n\n**Example:**\n```ucode\nlet [readfd, writefd] = pipe();\nif (readfd && writefd) {\n    // Use the pipe\n}\n```']
]);

// ============================================================================
// Debug Built-in Functions (from debug.c global_fns[])
// These are global functions, not methods of a debug module object
// ============================================================================

export const debugBuiltinFunctions = new Map<string, string>([
    ['memdump', '**memdump(file)** - Write a memory dump report to the given file.\\n\\n**Parameters:**\\n- `file` (string | module:fs.file | module:fs.proc): Output file path or file handle\\n\\n**Returns:** `boolean | null` - true on success, null on error\\n\\n**Example:**\\n```ucode\\nif (memdump(\"/tmp/memory.dump\")) {\\n    print(\"Memory dump written\");\\n}\\n```'],
    
    ['traceback', '**traceback([level])** - Generate a stack trace from the current execution point.\\n\\n**Parameters:**\\n- `level` (number, optional): Stack frame level to start from (default: 1)\\n\\n**Returns:** `module:debug.StackTraceEntry[]` - Array of stack trace entries\\n\\n**Example:**\\n```ucode\\nlet trace = traceback(1);\\nfor (let frame in trace) {\\n    print(\"Function:\", frame.function, \"Line:\", frame.line);\\n}\\n```'],
    
    ['sourcepos', '**sourcepos()** - Get the current source position information.\\n\\n**Returns:** `module:debug.SourcePosition | null` - Source position object or null\\n\\n**Example:**\\n```ucode\\nlet pos = sourcepos();\\nif (pos) {\\n    print(\"File:\", pos.filename, \"Line:\", pos.line);\\n}\\n```'],
    
    ['getinfo', '**getinfo(value)** - Get detailed information about a value.\\n\\n**Parameters:**\\n- `value` (any): The value to inspect\\n\\n**Returns:** `module:debug.ValueInformation | null` - Value information object or null\\n\\n**Example:**\\n```ucode\\nlet info = getinfo(myFunction);\\nif (info) {\\n    print(\"Type:\", info.type, \"Address:\", info.address);\\n}\\n```'],
    
    ['getlocal', '**getlocal([level], variable)** - Get the value of a local variable.\\n\\n**Parameters:**\\n- `level` (number, optional): Stack frame level (default: 1)\\n- `variable` (string | number): Variable name or index\\n\\n**Returns:** `module:debug.LocalInfo | null` - Local variable information or null\\n\\n**Example:**\\n```ucode\\nlet localInfo = getlocal(1, \"myVar\");\\nif (localInfo) {\\n    print(\"Value:\", localInfo.value);\\n}\\n```'],
    
    ['setlocal', '**setlocal([level], variable, [value])** - Set the value of a local variable.\\n\\n**Parameters:**\\n- `level` (number, optional): Stack frame level (default: 1)\\n- `variable` (string | number): Variable name or index\\n- `value` (any, optional): New value to set (default: null)\\n\\n**Returns:** `module:debug.LocalInfo | null` - Updated local variable information or null\\n\\n**Example:**\\n```ucode\\nlet result = setlocal(1, \"myVar\", \"new value\");\\nif (result) {\\n    print(\"Variable updated:\", result.name);\\n}\\n```'],
    
    ['getupval', '**getupval(target, variable)** - Get the value of an upvalue (closure variable).\\n\\n**Parameters:**\\n- `target` (function | number): Target function or stack level\\n- `variable` (string | number): Variable name or index\\n\\n**Returns:** `module:debug.UpvalInfo | null` - Upvalue information or null\\n\\n**Example:**\\n```ucode\\nlet upval = getupval(myFunction, \"closureVar\");\\nif (upval) {\\n    print(\"Upvalue:\", upval.value);\\n}\\n```'],
    
    ['setupval', '**setupval(target, variable, value)** - Set the value of an upvalue (closure variable).\\n\\n**Parameters:**\\n- `target` (function | number): Target function or stack level\\n- `variable` (string | number): Variable name or index\\n- `value` (any): New value to set\\n\\n**Returns:** `module:debug.UpvalInfo | null` - Updated upvalue information or null\\n\\n**Example:**\\n```ucode\\nlet result = setupval(myFunction, \"closureVar\", \"new value\");\\nif (result) {\\n    print(\"Upvalue updated:\", result.name);\\n}\\n```']
]);

// ============================================================================
// Digest Built-in Functions (from digest.c global_fns[])
// These are global functions, not methods of a digest module object
// ============================================================================

export const digestBuiltinFunctions = new Map<string, string>([
    ['md5', '**md5(str)** - Calculate MD5 hash of string.\\n\\n**Parameters:**\\n- `str` (string): The string to hash\\n\\n**Returns:** `string | null` - MD5 hash string or null if invalid input\\n\\n**Example:**\\n```ucode\\nmd5("This is a test");  // "ce114e4501d2f4e2dcea3e17b546f339"\\nmd5(123);               // null\\n```'],
    
    ['sha1', '**sha1(str)** - Calculate SHA1 hash of string.\\n\\n**Parameters:**\\n- `str` (string): The string to hash\\n\\n**Returns:** `string | null` - SHA1 hash string or null if invalid input\\n\\n**Example:**\\n```ucode\\nsha1("This is a test");  // "a54d88e06612d820bc3be72877c74f257b561b19"\\nsha1(123);               // null\\n```'],
    
    ['sha256', '**sha256(str)** - Calculate SHA256 hash of string.\\n\\n**Parameters:**\\n- `str` (string): The string to hash\\n\\n**Returns:** `string | null` - SHA256 hash string or null if invalid input\\n\\n**Example:**\\n```ucode\\nsha256("This is a test");  // "c7be1ed902fb8dd4d48997c6452f5d7e509fbcdbe2808b16bcf4edce4c07d14e"\\nsha256(123);               // null\\n```'],
    
    ['md5_file', '**md5_file(path)** - Calculate MD5 hash of file.\\n\\n**Parameters:**\\n- `path` (string): Path to the file\\n\\n**Returns:** `string | null` - MD5 hash string or null if error occurred\\n\\n**Example:**\\n```ucode\\nmd5_file("/etc/passwd");    // Returns file hash\\nmd5_file("/nonexistent");   // null\\n```'],
    
    ['sha1_file', '**sha1_file(path)** - Calculate SHA1 hash of file.\\n\\n**Parameters:**\\n- `path` (string): Path to the file\\n\\n**Returns:** `string | null` - SHA1 hash string or null if error occurred\\n\\n**Example:**\\n```ucode\\nsha1_file("/etc/passwd");    // Returns file hash\\nsha1_file("/nonexistent");   // null\\n```'],
    
    ['sha256_file', '**sha256_file(path)** - Calculate SHA256 hash of file.\\n\\n**Parameters:**\\n- `path` (string): Path to the file\\n\\n**Returns:** `string | null` - SHA256 hash string or null if error occurred\\n\\n**Example:**\\n```ucode\\nsha256_file("/etc/passwd");  // Returns file hash\\nsha256_file("/nonexistent"); // null\\n```'],
    
    // Extended digest functions (may not be available on all systems)
    ['md2', '**md2(str)** - Calculate MD2 hash of string (extended).\\n\\n**Parameters:**\\n- `str` (string): The string to hash\\n\\n**Returns:** `string | null` - MD2 hash string or null if invalid input\\n\\n**Example:**\\n```ucode\\nmd2("This is a test");  // "dc378580fd0722e56b82666a6994c718"\\nmd2(123);               // null\\n```'],
    
    ['md4', '**md4(str)** - Calculate MD4 hash of string (extended).\\n\\n**Parameters:**\\n- `str` (string): The string to hash\\n\\n**Returns:** `string | null` - MD4 hash string or null if invalid input\\n\\n**Example:**\\n```ucode\\nmd4("This is a test");  // "3b487cf6856af7e330bc4b1b7d977ef8"\\nmd4(123);               // null\\n```'],
    
    ['sha384', '**sha384(str)** - Calculate SHA384 hash of string (extended).\\n\\n**Parameters:**\\n- `str` (string): The string to hash\\n\\n**Returns:** `string | null` - SHA384 hash string or null if invalid input\\n\\n**Example:**\\n```ucode\\nsha384("This is a test");  // Returns long SHA384 hash\\nsha384(123);               // null\\n```'],
    
    ['sha512', '**sha512(str)** - Calculate SHA512 hash of string (extended).\\n\\n**Parameters:**\\n- `str` (string): The string to hash\\n\\n**Returns:** `string | null` - SHA512 hash string or null if invalid input\\n\\n**Example:**\\n```ucode\\nsha512("This is a test");  // Returns long SHA512 hash\\nsha512(123);               // null\\n```'],
    
    ['md2_file', '**md2_file(path)** - Calculate MD2 hash of file (extended).\\n\\n**Parameters:**\\n- `path` (string): Path to the file\\n\\n**Returns:** `string | null` - MD2 hash string or null if error occurred\\n\\n**Example:**\\n```ucode\\nmd2_file("/etc/passwd");  // Returns file hash\\n```'],
    
    ['md4_file', '**md4_file(path)** - Calculate MD4 hash of file (extended).\\n\\n**Parameters:**\\n- `path` (string): Path to the file\\n\\n**Returns:** `string | null` - MD4 hash string or null if error occurred\\n\\n**Example:**\\n```ucode\\nmd4_file("/etc/passwd");  // Returns file hash\\n```'],
    
    ['sha384_file', '**sha384_file(path)** - Calculate SHA384 hash of file (extended).\\n\\n**Parameters:**\\n- `path` (string): Path to the file\\n\\n**Returns:** `string | null` - SHA384 hash string or null if error occurred\\n\\n**Example:**\\n```ucode\\nsha384_file("/etc/passwd");  // Returns file hash\\n```'],
    
    ['sha512_file', '**sha512_file(path)** - Calculate SHA512 hash of file (extended).\\n\\n**Parameters:**\\n- `path` (string): Path to the file\\n\\n**Returns:** `string | null` - SHA512 hash string or null if error occurred\\n\\n**Example:**\\n```ucode\\nsha512_file("/etc/passwd");  // Returns file hash\\n```']
]);

// ============================================================================
// Log Built-in Functions (from log.c global_fns[])
// These are global functions, not methods of a log module object
// ============================================================================

export const logBuiltinFunctions = new Map<string, string>([
    ['openlog', '**openlog(ident, options, facility)** - Open connection to system logger.\\n\\n**Parameters:**\\n- `ident` (string, optional): String identifying the program name\\n- `options` (number|string|string[], optional): Logging options to use\\n- `facility` (number|string, optional): The facility for log messages (default: "user")\\n\\n**Returns:** `boolean` - true if system openlog() was invoked, false on invalid arguments\\n\\n**Example:**\\n```ucode\\n// Using constants\\nopenlog("myapp", LOG_PID | LOG_NDELAY, LOG_LOCAL0);\\n\\n// Using option names\\nopenlog("myapp", ["pid", "ndelay"], "user");\\n```'],
    
    ['syslog', '**syslog(priority, format, ...args)** - Log a message to the system logger.\\n\\n**Parameters:**\\n- `priority` (number|string): Log message priority\\n- `format` (any): The sprintf-like format string or value to log\\n- `...args` (any, optional): Arguments for format string\\n\\n**Returns:** `boolean` - true if message was logged, false on invalid priority or empty message\\n\\n**Example:**\\n```ucode\\n// Using constants\\nsyslog(LOG_ERR, "User %s encountered error: %d", username, errorCode);\\n\\n// Using priority names\\nsyslog("info", "System started successfully");\\n\\n// Implicit stringification\\nsyslog("debug", { status: "running", pid: 1234 });\\n```'],
    
    ['closelog', '**closelog()** - Close connection to system logger.\\n\\n**Returns:** `null`\\n\\n**Example:**\\n```ucode\\ncloselog();\\n```'],
    
    ['ulog_open', '**ulog_open(channels, facility, ident)** - Configure ulog logger (OpenWrt specific).\\n\\n**Parameters:**\\n- `channels` (number|string|string[], optional): Log channels to use\\n- `facility` (number|string, optional): The facility for log messages\\n- `ident` (string, optional): String identifying the program name\\n\\n**Returns:** `boolean` - true if ulog was configured, false on invalid arguments\\n\\n**Example:**\\n```ucode\\n// Log to dmesg and stderr\\nulog_open(["stdio", "kmsg"], "daemon", "my-program");\\n\\n// Use numeric constants\\nulog_open(ULOG_SYSLOG, LOG_LOCAL0);\\n```'],
    
    ['ulog', '**ulog(priority, format, ...args)** - Log a message via ulog mechanism (OpenWrt specific).\\n\\n**Parameters:**\\n- `priority` (number|string): Log message priority\\n- `format` (any): The sprintf-like format string or value to log\\n- `...args` (any, optional): Arguments for format string\\n\\n**Returns:** `boolean` - true if message was logged, false on invalid priority or empty message\\n\\n**Example:**\\n```ucode\\n// Using constants\\nulog(LOG_ERR, "User %s encountered error: %d", username, errorCode);\\n\\n// Using priority names\\nulog("info", "System started successfully");\\n\\n// Implicit stringification\\nulog("debug", { status: "running", pid: 1234 });\\n```'],
    
    ['ulog_close', '**ulog_close()** - Close ulog logger (OpenWrt specific).\\n\\n**Returns:** `null`\\n\\n**Example:**\\n```ucode\\nulog_close();\\n```'],
    
    ['ulog_threshold', '**ulog_threshold(priority)** - Set ulog priority threshold (OpenWrt specific).\\n\\n**Parameters:**\\n- `priority` (number|string, optional): The priority threshold to configure\\n\\n**Returns:** `boolean` - true if threshold was set, false on invalid priority\\n\\n**Example:**\\n```ucode\\n// Set threshold to "warning" or more severe\\nulog_threshold(LOG_WARNING);\\n\\n// Using priority name\\nulog_threshold("debug");\\n```'],
    
    ['INFO', '**INFO(format, ...args)** - Convenience wrapper for ulog(LOG_INFO, ...).\\n\\n**Parameters:**\\n- `format` (any): The sprintf-like format string or value to log\\n- `...args` (any, optional): Arguments for format string\\n\\n**Returns:** `boolean` - true if message was logged, false on error\\n\\n**Example:**\\n```ucode\\nINFO("System initialization complete");\\nINFO("User %s logged in", username);\\n```'],
    
    ['NOTE', '**NOTE(format, ...args)** - Convenience wrapper for ulog(LOG_NOTICE, ...).\\n\\n**Parameters:**\\n- `format` (any): The sprintf-like format string or value to log\\n- `...args` (any, optional): Arguments for format string\\n\\n**Returns:** `boolean` - true if message was logged, false on error\\n\\n**Example:**\\n```ucode\\nNOTE("Configuration change detected");\\nNOTE("Service %s restarted", serviceName);\\n```'],
    
    ['WARN', '**WARN(format, ...args)** - Convenience wrapper for ulog(LOG_WARNING, ...).\\n\\n**Parameters:**\\n- `format` (any): The sprintf-like format string or value to log\\n- `...args` (any, optional): Arguments for format string\\n\\n**Returns:** `boolean` - true if message was logged, false on error\\n\\n**Example:**\\n```ucode\\nWARN("Low disk space detected");\\nWARN("Connection timeout for %s", hostname);\\n```'],
    
    ['ERR', '**ERR(format, ...args)** - Convenience wrapper for ulog(LOG_ERR, ...).\\n\\n**Parameters:**\\n- `format` (any): The sprintf-like format string or value to log\\n- `...args` (any, optional): Arguments for format string\\n\\n**Returns:** `boolean` - true if message was logged, false on error\\n\\n**Example:**\\n```ucode\\nERR("Failed to connect to database");\\nERR("Invalid configuration: %s", errorMessage);\\n```']
]);

// ============================================================================
// Math Built-in Functions (from math.c global_fns[])
// These are global functions, not methods of a math module object
// ============================================================================

export const mathBuiltinFunctions = new Map<string, string>([
    ['abs', '**abs(number)** - Returns the absolute value of the given numeric value.\\n\\n**Parameters:**\\n- `number` (number): The number to return the absolute value for\\n\\n**Returns:** `number` - The absolute value or NaN if the argument cannot be converted to a number\\n\\n**Example:**\\n```ucode\\nabs(-42);    // 42\\nabs(3.14);   // 3.14\\nabs("abc");  // NaN\\n```'],
    
    ['atan2', '**atan2(y, x)** - Calculates the principal value of the arc tangent of y/x.\\n\\n**Parameters:**\\n- `y` (number): The y value\\n- `x` (number): The x value\\n\\n**Returns:** `number` - The arc tangent result in radians (range [-π, π])\\n\\n**Example:**\\n```ucode\\natan2(1, 1);   // π/4 (45 degrees)\\natan2(0, 1);   // 0\\natan2(1, 0);   // π/2\\n```'],
    
    ['cos', '**cos(x)** - Calculates the cosine of x, where x is given in radians.\\n\\n**Parameters:**\\n- `x` (number): Radians value to calculate cosine for\\n\\n**Returns:** `number` - The cosine value or NaN if x cannot be converted to a number\\n\\n**Example:**\\n```ucode\\ncos(0);      // 1\\ncos(3.14159/2);  // ~0 (cos(π/2))\\ncos(3.14159);    // -1 (cos(π))\\n```'],
    
    ['exp', '**exp(x)** - Calculates e (base of natural logarithms) raised to the power of x.\\n\\n**Parameters:**\\n- `x` (number): Power to raise e to\\n\\n**Returns:** `number` - The exponential value or NaN if x cannot be converted to a number\\n\\n**Example:**\\n```ucode\\nexp(0);     // 1 (e^0)\\nexp(1);     // ~2.718 (e^1)\\nexp(2);     // ~7.389 (e^2)\\n```'],
    
    ['log', '**log(x)** - Calculates the natural logarithm of x.\\n\\n**Parameters:**\\n- `x` (number): Value to calculate natural logarithm of\\n\\n**Returns:** `number` - The natural logarithm or NaN if x cannot be converted to a number or is negative\\n\\n**Example:**\\n```ucode\\nlog(1);      // 0 (ln(1))\\nlog(2.718);  // ~1 (ln(e))\\nlog(10);     // ~2.303\\n```'],
    
    ['sin', '**sin(x)** - Calculates the sine of x, where x is given in radians.\\n\\n**Parameters:**\\n- `x` (number): Radians value to calculate sine for\\n\\n**Returns:** `number` - The sine value or NaN if x cannot be converted to a number\\n\\n**Example:**\\n```ucode\\nsin(0);          // 0\\nsin(3.14159/2);  // 1 (sin(π/2))\\nsin(3.14159);    // ~0 (sin(π))\\n```'],
    
    ['sqrt', '**sqrt(x)** - Calculates the nonnegative square root of x.\\n\\n**Parameters:**\\n- `x` (number): Value to calculate square root for\\n\\n**Returns:** `number` - The square root or NaN if x cannot be converted to a number or is negative\\n\\n**Example:**\\n```ucode\\nsqrt(4);     // 2\\nsqrt(9);     // 3\\nsqrt(-1);    // NaN\\n```'],
    
    ['pow', '**pow(x, y)** - Calculates the value of x raised to the power of y.\\n\\n**Parameters:**\\n- `x` (number): The base value\\n- `y` (number): The power value\\n\\n**Returns:** `number` - The result of x^y or NaN if either argument cannot be converted to a number\\n\\n**Example:**\\n```ucode\\npow(2, 3);   // 8 (2^3)\\npow(4, 0.5); // 2 (4^0.5 = √4)\\npow(10, 2);  // 100\\n```'],
    
    ['rand', '**rand()** - Produces a pseudo-random positive integer.\\n\\n**Returns:** `number` - A random integer in the range 0 to RAND_MAX (at least 32767)\\n\\n**Example:**\\n```ucode\\nrand();  // e.g., 1804\\nrand();  // e.g., 25667\\n// Note: Use srand() to seed the generator\\n```'],
    
    ['srand', '**srand(seed)** - Seeds the pseudo-random number generator.\\n\\n**Parameters:**\\n- `seed` (number): The seed value for the random number generator\\n\\n**Returns:** `null`\\n\\n**Example:**\\n```ucode\\nsrand(42);   // Seed with 42\\nrand();      // Predictable sequence\\nsrand(42);   // Same seed\\nrand();      // Same first value\\n```'],
    
    ['isnan', '**isnan(x)** - Tests whether x is a NaN (not a number) double value.\\n\\n**Parameters:**\\n- `x` (number): The value to test\\n\\n**Returns:** `boolean` - true if the value is NaN, otherwise false\\n\\n**Example:**\\n```ucode\\nisnan(42);        // false\\nisnan(sqrt(-1));  // true\\nisnan(0/0);       // true\\n```']
]);

// Merge all builtins for completion
export const allBuiltinFunctions = new Map([...builtinFunctions, ...fsBuiltinFunctions, ...debugBuiltinFunctions, ...digestBuiltinFunctions, ...logBuiltinFunctions, ...mathBuiltinFunctions]);