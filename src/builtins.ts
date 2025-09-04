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
    ['filter', '**filter(array, callback)** - Filter array elements using a predicate function.\n\n**Parameters:**\n- `array` (array): The array to filter\n- `callback` (function): Function called for each element. Should return truthy to keep element. Receives (value, index, array)\n\n**Returns:** `array | null` - New filtered array, or null if first argument is not an array\n\n**Example:**\n```ucode\n// Filter even numbers\nlet evens = filter([1, 2, 3, 4, 5], n => n % 2 == 0);\n// Result: [2, 4]\n\n// Filter with index\nlet result = filter(["a", "b", "c"], (val, idx) => idx > 0);\n// Result: ["b", "c"]\n```'],
    ['index', 'Find index of substring or element.\n\n**Parameters:**\n- `haystack` - String or array to search in\n- `needle` - Value to search for\n\n**Returns:** `number` - Index of first occurrence, or -1 if not found\n\n**Note:** Parameter order is `index(haystack, needle)`'],
    ['require', 'Load and return module.\n\n**Parameters:**\n- `module` - Module name or path\n\n**Returns:** `*` - The loaded module'],
    ['include', 'Include file contents inline.\n\n**Parameters:**\n- `path` - Path to file\n\n**Returns:** `*` - Result of included file'],
    ['json', 'Parse JSON string or stringify value.\n\n**Parameters:**\n- `value` - String to parse or value to stringify\n\n**Returns:** `*` - Parsed object or JSON string'],
    ['match', 'Match string against regex.\n\n**Parameters:**\n- `string` - The string to match\n- `regex` - Regular expression\n\n**Returns:** `array|null` - Match results or null'],
    ['replace', 'Replace occurrences in string.\n\n**Parameters:**\n- `string` - The string\n- `search` - String or regex to search for\n- `replacement` - Replacement string\n\n**Returns:** `string` - String with replacements'],
    ['system', '**system(command, timeout?)** - Execute shell command or program.\\n\\n**Parameters:**\\n- `command` (string | array): Command to execute. String passed to `/bin/sh -c`, array used as execv() argument vector\\n- `timeout` (number, optional): Timeout in milliseconds. Program terminated by SIGKILL if exceeded\\n\\n**Returns:** `number` - Exit code (positive) or negative signal number if terminated by signal\\n\\n**Examples:**\\n```ucode\\n// Execute through shell\\nsystem("echo Hello && exit 3");  // Returns 3\\n\\n// Execute argument vector\\nsystem(["/usr/bin/date", "+%s"]);  // Returns 0\\n\\n// With timeout\\nsystem("sleep 3", 1000);  // Returns -9 (SIGKILL)\\n```'],
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
    ['hexdec', 'Decode hexadecimal string.\n\n**Parameters:**\n- `hexstring` (string) - Hexadecimal string to decode\n- `skipchars` (string) *optional* - Characters to skip during decoding (default: " \\t\\n")\n\n**Returns:** `string` - Decoded string, or null if invalid\n\n**Examples:**\n```ucode\nhexdec("48656c6c6f20776f726c64210a");  // "Hello world!\\n"\nhexdec("44:55:66:77:33:44", ":");      // "DUfw3D"\n```'],
    ['hex', 'Convert number to hexadecimal string.\n\n**Parameters:**\n- `number` - Number to convert\n\n**Returns:** `string` - Hexadecimal representation'],
    ['uchr', 'Convert Unicode code point to character.\n\n**Parameters:**\n- `code` - Unicode code point\n\n**Returns:** `string` - The Unicode character'],
    ['iptoarr', 'Convert IP address string to array of components.\n\n**Parameters:**\n- `ipString` - IP address string (IPv4 or IPv6)\n\n**Returns:** `array` - Array of IP address components\n\n**Example:**\n```ucode\niptoarr("192.168.1.1")  // [192, 168, 1, 1]\n```'],
    ['arrtoip', 'Convert array of IP components to IP address string.\n\n**Parameters:**\n- `ipArray` - Array of IP address components\n\n**Returns:** `string` - IP address string\n\n**Example:**\n```ucode\narrtoip([192, 168, 1, 1])  // "192.168.1.1"\n```'],
    ['int', 'Convert value to integer.\n\n**Parameters:**\n- `value` - String or number to convert to integer\n\n**Returns:** `number` - Integer value\n\n**Example:**\n```ucode\nint("123")    // 123\nint(45.67)    // 45\nint("-89")    // -89\n```'],
    ['loadstring', 'Load and execute uCode from string.\n\n**Parameters:**\n- `code` - String containing uCode source code\n\n**Returns:** `*` - Result of executed code\n\n**Example:**\n```ucode\nloadstring("return 42")()  // 42\n```'],
    ['loadfile', 'Load and execute uCode from file.\n\n**Parameters:**\n- `path` - Path to uCode file\n\n**Returns:** `*` - Result of executed file\n\n**Example:**\n```ucode\nloadfile("script.uc")()\n```'],
    ['wildcard', 'Match the given **subject** string against a shell-style wildcard (glob) **pattern**. This is pure string matching — it never touches the filesystem.\n\n**Parameters**\n- `subject` — String to test (other types are coerced to string)\n- `pattern` — Glob pattern. Supports `*`, `?`, bracket sets `[abc]`, ranges `[a-z]`, negation `[!abc]`/`[^abc]`, and POSIX character classes inside bracket sets (e.g. `[[:alpha:]]`).\n- `nocase` (boolean, optional) — If truthy, match case-insensitively.\n\n**Returns**\n- `boolean` — `true` if the pattern matches the subject; otherwise `false`.\n\n**Supported syntax (quick reference)**\n- `*` matches any sequence (including empty)\n- `?` matches any single character\n- `[abc]` matches one of the listed characters; `[-ab]` or `[ab-]` include a literal `-`\n- `[a-z]` matches a range; use `[A-Za-z]` (not `[A-z]`) to avoid punctuation\n- `[!set]` or `[^set]` negates the set\n- **POSIX classes** (must be inside `[...]`): `[[:alpha:]]`, `[[:alnum:]]`, `[[:digit:]]`, `[[:space:]]`, `[[:upper:]]`, `[[:lower:]]`, `[[:punct:]]`, `[[:xdigit:]]`, `[[:blank:]]`, `[[:graph:]]`, `[[:print:]]`, `[[:cntrl:]]`\n- `\\` escapes the next character (e.g., match a literal `[` with `\\[`)\n\n**Examples**\n```ucode\nwildcard(\"document.txt\", \"*.txt\")              // true\nwildcard(\"test1\", \"test?\")                     // true\nwildcard(\"5files\", \"[0-9]*\")                   // true  (range)\nwildcard(\"FILE.TXT\", \"*.txt\", true)            // true  (case-insensitive)\n\n// POSIX character classes (must be inside brackets)\nwildcard(\"hello\", \"[[:alpha:]]*\")              // true  (letters)\nwildcard(\"var_42\", \"var_[[:digit:]][[:digit:]]\") // true  (two digits)\nwildcard(\"_tmp\", \"[![:alnum:]]*\")              // true  (first char not alnum)\nwildcard(\"line\\tbreak\", \"*[[:space:]]*\")       // true  (tab/newline/space)\n\n// Escaping special characters\nwildcard(\"file[1].txt\", \"file\\\\[1\\\\].txt\")      // true (literal square brackets)\n\n// Safer alpha range\nwildcard(\"Z\", \"[A-Za-z]\")                       // true\n```\n**Notes**\n- `*` and `?` are **literals** inside bracket sets (e.g. `[a*?]`).\n- Avoid `[A-z]`; it spans punctuation between `Z` and `a`. Use `[A-Za-z]` instead.\n'],
    ['regexp', 'Compile a regular expression from pattern string.\n\n**Parameters:**\n- `pattern` - Regular expression pattern string\n- `flags` - Optional flags string ("i", "g", "s")\n\n**Returns:** `regexp` - Compiled regular expression object\n\n**Example:**\n```ucode\nlet re = regexp("[0-9]+", "g");\nmatch("test123", re);  // ["123"]\n```'],
    ['assert', 'Assert that a condition is true, throw exception if false.\n\n**Parameters:**\n- `condition` - Value to test for truthiness\n- `message` - Optional error message string\n\n**Returns:** `*` - The condition value if truthy\n\n**Throws:** Exception if condition is falsy\n\n**Example:**\n```ucode\nassert(x > 0, "x must be positive");\nassert(array.length > 0);\n```'],
    ['call', 'Invoke a function with modified context and environment.\n\n**Parameters:**\n- `function` - Function to invoke\n- `thisContext` - Value for "this" context (optional)\n- `environment` - Global environment object (optional)\n- `...args` - Arguments to pass to function\n\n**Returns:** `*` - Result of function call\n\n**Example:**\n```ucode\ncall(myFunction, null, null, arg1, arg2);\n```'],
    ['signal', 'Set up signal handlers for Unix signals.\n\n**Parameters:**\n- `signal` - Signal number or name (with/without "SIG" prefix)\n- `handler` - Handler function (optional)\n\n**Returns:** `*` - Previous handler or signal behavior\n\n**Example:**\n```ucode\nsignal(15, function() { print("SIGTERM received"); });\nsignal("SIGINT", exitHandler);\n```'],
    ['clock', '**clock([monotonic])** - Reads the current second and microsecond value of the system clock.\n\nBy default, the realtime clock is queried which might skew forwards or backwards due to NTP changes, system sleep modes etc. If a truish value is passed as argument, the monotonic system clock is queried instead, which will return the monotonically increasing time since some arbitrary point in the past (usually the system boot time).\n\nReturns a two element array containing the full seconds as the first element and the nanosecond fraction as the second element.\n\nReturns `null` if a monotonic clock value is requested and the system does not implement this clock type.\n\n**Parameters:**\n- `monotonic` (boolean, optional): Whether to query the monotonic system clock\n\n**Returns:** `number[] | null` - Two element array [seconds, nanoseconds] or null if monotonic clock unavailable\n\n**Example:**\n```ucode\nclock();        // [ 1647954926, 798269464 ]\nclock(true);    // [ 474751, 527959975 ]\n```'],
    ['sourcepath', 'Get the path of the current source file.\n\n**Parameters:**\n- `depth` (number, optional): Stack depth to look up (default: 0)\n- `dironly` (boolean, optional): Return directory name only (default: false)\n\n**Returns:** `string` - Absolute path to source file or directory\n\n**Example:**\n```ucode\nlet currentFile = sourcepath();\nlet parentDir = sourcepath(1, true);\n```'],
    ['gc', 'Interact with the mark and sweep garbage collector of the running ucode VM.\n\n**Signature:** `gc(operation?, interval?)`\n\n**Parameters:**\n- `operation` (string): Operation to perform. Default: `collect`.\n- `interval` (integer): Number of objects allocated before collecting garbage.\n\n**Operations:**\n- `collect` - Perform a complete GC cycle. Returns `true`.\n- `start` - (Re-)start periodic GC. Optional integer interval `1..65535`; `0` or omitted uses default `1000`. Returns `true` if GC was previously stopped and is now started or if the interval changed; otherwise `false`.\n- `stop` - Stop periodic GC. Returns `true` if it was running; otherwise `false`.\n- `count` - Count active complex object references. Returns the number.\n\n**Default:** If `operation` is omitted, behaves like `collect`.\n\n**Notes:** Extra arguments are ignored. Invalid arguments return `null`.\n\n**Examples:**\n```ucode\ngc();              // true\ngc(\"start\");       // true\ngc(\"start\", 500);  // true\ngc(\"stop\");        // true\nn = gc("count");    // e.g. 42\n```\n'],
    ['die', 'Terminate script execution with optional message.\n\n**Parameters:**\n- `message` (string, optional): Error message to display before termination\n\n**Returns:** Never returns (terminates execution)\n\n**Example:**\n```ucode\nif (critical_error) {\n    die("Critical error occurred");\n}\n```'],    
    ['exists', 'Check if a variable or property exists.\n\n**Parameters:**\n- `object` (object): Object to check\n- `property` (string): Property name to check for\n\n**Returns:** `boolean` - True if property exists, false otherwise\n\n**Example:**\n```ucode\nlet obj = { name: "test", value: null };\nexists(obj, "name");    // true\nexists(obj, "missing"); // false\n```'],
    ['exit', 'Terminate script execution with exit code.\n\n**Parameters:**\n- `code` (number, optional): Exit code (default: 0)\n\n**Returns:** Never returns (terminates execution)\n\n**Example:**\n```ucode\nif (error_condition) {\n    exit(1);\n}\nexit(0);  // Success\n```'],
    ['getenv', 'Get environment variable value.\n\n**Parameters:**\n- `name` (string): Environment variable name\n\n**Returns:** `string | null` - Environment variable value or null if not found\n\n**Example:**\n```ucode\nlet path = getenv("PATH");\nlet home = getenv("HOME");\nlet missing = getenv("DOES_NOT_EXIST");  // null\n```'],
    ['map', 'Transform array elements using callback function.\n\n**Parameters:**\n- `array` (array): The array to transform\n- `callback` (function): Function called for each element. Receives (value, index, array)\n\n**Returns:** `array | null` - New array with transformed elements, or null if first argument is not an array\n\n**Example:**\n```ucode\n// Double all numbers\nlet doubled = map([1, 2, 3, 4], n => n * 2);\n// Result: [2, 4, 6, 8]\n\n// Transform with index\nlet indexed = map(["a", "b", "c"], (val, idx) => `${idx}: ${val}`);\n// Result: ["0: a", "1: b", "2: c"]\n```'],
    ['reverse', 'Reverse array or string.\n\n**Parameters:**\n- `value` (array | string): Array or string to reverse\n\n**Returns:** `array | string | null` - Reversed copy, or null if invalid input\n\n**Example:**\n```ucode\nreverse([1, 2, 3, 4]);    // [4, 3, 2, 1]\nreverse("hello");         // "olleh"\nreverse(123);             // null\n```'],
    ['rindex', 'Find last index of substring or element.\n\n**Parameters:**\n- `haystack` - String or array to search in\n- `needle` - Value to search for\n\n**Returns:** `number` - Index of last occurrence, or -1 if not found\n\n**Example:**\n```ucode\nrindex("hello world hello", "hello");  // 12\nrindex([1, 2, 3, 2, 1], 2);            // 3\nrindex("test", "missing");             // -1\n```'],
    ['sort', 'Sort array elements in place.\n\n**Parameters:**\n- `array` (array): Array to sort\n- `compare` (function, optional): Comparison function\n\n**Returns:** `array | null` - The sorted array, or null if invalid input\n\n**Example:**\n```ucode\n// Sort numbers\nsort([3, 1, 4, 2]);  // [1, 2, 3, 4]\n\n// Sort with custom compare\nsort(["apple", "Banana", "cherry"], (a, b) => {\n    return lc(a) < lc(b) ? -1 : (lc(a) > lc(b) ? 1 : 0);\n});\n```'],
    ['splice', 'Change array contents by adding/removing elements.\n\n**Parameters:**\n- `array` (array): Array to modify\n- `start` (number): Start index\n- `deleteCount` (number, optional): Number of elements to remove\n- `...items` (any, optional): Items to add\n\n**Returns:** `array | null` - Array of removed elements, or null if invalid input\n\n**Example:**\n```ucode\nlet arr = [1, 2, 3, 4, 5];\n// Remove 2 elements starting at index 1\nlet removed = splice(arr, 1, 2);  // [2, 3]\n// arr is now [1, 4, 5]\n\n// Insert elements\nsplice(arr, 1, 0, "a", "b");  // []\n// arr is now [1, "a", "b", 4, 5]\n```'],
    ['slice', 'Extract section of array or string.\n\n**Parameters:**\n- `value` (array | string): Array or string to slice\n- `start` (number): Start index (inclusive)\n- `end` (number, optional): End index (exclusive)\n\n**Returns:** `array | string | null` - Extracted section, or null if invalid input\n\n**Example:**\n```ucode\nslice([1, 2, 3, 4, 5], 1, 4);  // [2, 3, 4]\nslice("hello world", 0, 5);    // "hello"\nslice([1, 2, 3], 1);           // [2, 3]\n```'],
    ['warn', 'Print warning message to stderr.\n\n**Parameters:**\n- `...values` - Values to print as warning\n\n**Returns:** `null`\n\n**Example:**\n```ucode\nwarn("This is a warning message");\nwarn("Warning:", error_code, "occurred");\n```'],
    ['trace', 'Print stack trace for debugging.\n\n**Parameters:**\n- `message` (string, optional): Optional message to include\n\n**Returns:** `null`\n\n**Example:**\n```ucode\nfunction problematic_function() {\n    trace("Debug trace point");\n    // ... rest of function\n}\n```'],
    ['proto', 'Get or set prototype of object.\n\n**Parameters:**\n- `object` (object): Object to inspect/modify\n- `prototype` (object, optional): New prototype to set\n\n**Returns:** `object | null` - Current/previous prototype, or null if invalid\n\n**Example:**\n```ucode\nlet obj = {};\nlet current_proto = proto(obj);  // Get current prototype\nproto(obj, new_prototype);       // Set new prototype\n```'],
    ['render', 'Render template string with context.\n\n**Parameters:**\n- `template` (string): Template string to render\n- `context` (object, optional): Variables for template substitution\n\n**Returns:** `string | null` - Rendered string, or null on error\n\n**Example:**\n```ucode\nlet template = "Hello {{name}}, you have {{count}} messages";\nlet context = { name: "Alice", count: 5 };\nrender(template, context);  // "Hello Alice, you have 5 messages"\n```']
]);

// ============================================================================
// File System Functions (from fs.c global_fns[])
// These are now fs.* module functions only, NOT global functions
// Available as: fs.open(), fs.readfile(), etc.
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

// ============================================================================
// RTNL Built-in Functions (from rtnl.c global_fns[])
// These are global functions, not methods of a rtnl module object
// ============================================================================

export const rtnlBuiltinFunctions = new Map<string, string>([
    ['request', '**request(cmd, flags?, payload?)** - Send a netlink request to the routing subsystem.\\n\\n**Parameters:**\\n- `cmd` (integer): The RTM_* command to execute\\n- `flags` (integer, optional): Request flags (NLM_F_*)\\n- `payload` (object, optional): Command-specific attributes\\n\\n**Returns:** `object | null` - The response object or null on error\\n\\n**Example:**\\n```ucode\\n// Get all routes\\nlet routes = request(RTM_GETROUTE, NLM_F_DUMP);\\n\\n// Add a new route\\nlet result = request(RTM_NEWROUTE, NLM_F_CREATE | NLM_F_EXCL, {\\n    dst: "192.168.1.0/24",\\n    gateway: "192.168.1.1",\\n    oif: 2\\n});\\n```'],
    
    ['listener', '**listener(callback, cmds?, groups?)** - Create an event listener for routing netlink messages.\\n\\n**Parameters:**\\n- `callback` (function): Function called when events are received\\n- `cmds` (array, optional): Array of RTM_* command constants to listen for\\n- `groups` (array, optional): Array of multicast groups to join\\n\\n**Returns:** `rtnl.listener` - Listener object\\n\\n**Example:**\\n```ucode\\n// Listen for route changes\\nlet l = listener(function(msg) {\\n    printf("Route event: %J\\\\n", msg);\\n}, [RTM_NEWROUTE, RTM_DELROUTE]);\\n\\n// Listen for link changes\\nlet linkListener = listener(function(msg) {\\n    printf("Link event: %J\\\\n", msg);\\n}, [RTM_NEWLINK, RTM_DELLINK]);\\n```'],
    
    ['error', '**error()** - Returns the last rtnl error message, or null if no error occurred.\\n\\n**Returns:** `string | null` - The error message or null\\n\\n**Example:**\\n```ucode\\nlet result = request(RTM_GETROUTE, NLM_F_DUMP);\\nif (!result) {\\n    let errorMsg = error();\\n    printf("RTNL error: %s\\\\n", errorMsg);\\n}\\n```']
]);

// ============================================================================
// NL80211 Built-in Functions (from nl80211.c global_fns[])
// These are global functions, not methods of a nl80211 module object
// ============================================================================

export const nl80211BuiltinFunctions = new Map<string, string>([
    ['error', '**error()** - Returns the last nl80211 error message, or null if no error occurred.\\n\\n**Returns:** `string | null` - The error message or null\\n\\n**Example:**\\n```ucode\\nlet result = request(NL80211_CMD_GET_WIPHY, NLM_F_DUMP);\\nif (!result) {\\n    let errorMsg = error();\\n    printf("NL80211 error: %s\\n", errorMsg);\\n}\\n```'],
    
    ['request', '**request(cmd, flags?, payload?)** - Sends a netlink request to the nl80211 subsystem.\\n\\n**Parameters:**\\n- `cmd` (integer): The NL80211_CMD_* command to execute\\n- `flags` (integer, optional): Request flags (NLM_F_*)\\n- `payload` (object, optional): Command-specific attributes\\n\\n**Returns:** `object | null` - The response object or null on error\\n\\n**Example:**\\n```ucode\\n// Get all wireless interfaces\\nlet interfaces = request(NL80211_CMD_GET_INTERFACE, NLM_F_DUMP);\\n```'],
    
    ['waitfor', '**waitfor(cmds, timeout?)** - Waits for specific nl80211 commands to be received.\\n\\n**Parameters:**\\n- `cmds` (array): Array of NL80211_CMD_* constants to wait for\\n- `timeout` (integer, optional): Maximum wait time in milliseconds\\n\\n**Returns:** `object | null` - The received message object or null on timeout\\n\\n**Example:**\\n```ucode\\n// Wait for scan results with 10 second timeout\\nlet scanResults = waitfor([NL80211_CMD_NEW_SCAN_RESULTS], 10000);\\n```'],
    
    ['listener', '**listener(callback, cmds)** - Creates an event listener for nl80211 messages.\\n\\n**Parameters:**\\n- `callback` (function): Function called when events are received\\n- `cmds` (array): Array of NL80211_CMD_* constants to listen for\\n\\n**Returns:** `nl80211.listener` - Listener object with set_commands() and close() methods\\n\\n**Example:**\\n```ucode\\nlet l = listener(function(msg) {\\n    printf("WiFi event: %J\\n", msg);\\n}, [NL80211_CMD_NEW_STATION, NL80211_CMD_DEL_STATION]);\\n```']
]);

// ============================================================================
// NL80211 Built-in Constants (from nl80211.c register_constants())
// These are global constants available without imports
// ============================================================================

export const nl80211BuiltinConstants = new Map<string, string>([
    // Netlink Message Flags
    ['NLM_F_ACK', 'Request an acknowledgment on errors'],
    ['NLM_F_ACK_TLVS', 'Extended ACK TLVs were included'],
    ['NLM_F_APPEND', 'Append the new entry to the end of the list'],
    ['NLM_F_ATOMIC', 'Use atomic operations'],
    ['NLM_F_CAPPED', 'Dump was capped'],
    ['NLM_F_CREATE', 'Create if it does not exist'],
    ['NLM_F_DUMP', 'Dump the table'],
    ['NLM_F_DUMP_FILTERED', 'Dump was filtered'],
    ['NLM_F_DUMP_INTR', 'Dump was interrupted'],
    ['NLM_F_ECHO', 'Echo this request'],
    ['NLM_F_EXCL', 'Do not touch, if it exists'],
    ['NLM_F_MATCH', 'Dump all matching entries'],
    ['NLM_F_MULTI', 'Multipart message'],
    ['NLM_F_NONREC', 'Do not delete recursively'],
    ['NLM_F_REPLACE', 'Replace existing matching object'],
    ['NLM_F_REQUEST', 'This message is a request'],
    ['NLM_F_ROOT', 'Specify tree root'],

    // WiFi Interface Types
    ['NL80211_IFTYPE_ADHOC', 'Ad-hoc network interface type'],
    ['NL80211_IFTYPE_STATION', 'Station (client) interface type'],
    ['NL80211_IFTYPE_AP', 'Access Point interface type'],
    ['NL80211_IFTYPE_AP_VLAN', 'Access Point VLAN interface type'],
    ['NL80211_IFTYPE_WDS', 'Wireless Distribution System interface type'],
    ['NL80211_IFTYPE_MONITOR', 'Monitor interface type (packet capture)'],
    ['NL80211_IFTYPE_MESH_POINT', 'Mesh point interface type'],
    ['NL80211_IFTYPE_P2P_CLIENT', 'P2P client interface type'],
    ['NL80211_IFTYPE_P2P_GO', 'P2P Group Owner interface type'],
    ['NL80211_IFTYPE_P2P_DEVICE', 'P2P device interface type'],
    ['NL80211_IFTYPE_OCB', 'Outside Context of a BSS interface type'],

    // Common NL80211 Commands
    ['NL80211_CMD_GET_WIPHY', 'Get wireless physical device information'],
    ['NL80211_CMD_SET_WIPHY', 'Set wireless physical device configuration'],
    ['NL80211_CMD_NEW_WIPHY', 'Create new wireless physical device'],
    ['NL80211_CMD_DEL_WIPHY', 'Delete wireless physical device'],
    ['NL80211_CMD_GET_INTERFACE', 'Get wireless interface information'],
    ['NL80211_CMD_SET_INTERFACE', 'Set wireless interface configuration'],
    ['NL80211_CMD_NEW_INTERFACE', 'Create new wireless interface'],
    ['NL80211_CMD_DEL_INTERFACE', 'Delete wireless interface'],
    ['NL80211_CMD_GET_STATION', 'Get station information'],
    ['NL80211_CMD_SET_STATION', 'Set station configuration'],
    ['NL80211_CMD_NEW_STATION', 'Create new station'],
    ['NL80211_CMD_DEL_STATION', 'Delete station'],
    ['NL80211_CMD_GET_SCAN', 'Get scan results'],
    ['NL80211_CMD_TRIGGER_SCAN', 'Trigger a scan'],
    ['NL80211_CMD_NEW_SCAN_RESULTS', 'New scan results available'],
    ['NL80211_CMD_CONNECT', 'Connect to an access point'],
    ['NL80211_CMD_DISCONNECT', 'Disconnect from an access point'],
    ['NL80211_CMD_START_AP', 'Start access point mode'],
    ['NL80211_CMD_STOP_AP', 'Stop access point mode'],

    // Hardware Simulator Commands
    ['HWSIM_CMD_REGISTER', 'Register with the wireless hardware simulator'],
    ['HWSIM_CMD_FRAME', 'Send a frame through the hardware simulator'],
    ['HWSIM_CMD_TX_INFO_FRAME', 'Send transmission info frame'],
    ['HWSIM_CMD_NEW_RADIO', 'Create new simulated radio'],
    ['HWSIM_CMD_DEL_RADIO', 'Delete simulated radio'],
    ['HWSIM_CMD_GET_RADIO', 'Get simulated radio information']
]);

// ============================================================================
// Zlib Built-in Functions (from zlib.c global_fns[])
// These are global functions, not methods of a zlib module object
// ============================================================================

export const zlibBuiltinFunctions = new Map<string, string>([
    ['deflate', '**deflate(str_or_resource, gzip?, level?)** - Compresses data in Zlib or gzip format.\n\n**Parameters:**\n- `str_or_resource` (string | object): The string or resource object to be compressed. If an object with a read() method is given, it will be read in chunks for incremental compression\n- `gzip` (boolean, optional, default: false): Add a gzip header if true (creates gzip-compliant output), otherwise defaults to Zlib format\n- `level` (number, optional, default: Z_DEFAULT_COMPRESSION): The compression level (0-9) where 0=no compression, 1=fastest, 9=best compression\n\n**Returns:** `string | null` - The compressed data as a string, or null on error\n\n**Example:**\n```ucode\n// deflate content using default compression\nconst deflated = deflate(content);\n\n// deflate content with gzip format and fastest compression\nconst deflated = deflate(content, true, Z_BEST_SPEED);\n```'],

    ['inflate', '**inflate(str_or_resource)** - Decompresses data in Zlib or gzip format.\n\n**Parameters:**\n- `str_or_resource` (string | object): The string or resource object to be decompressed. If an object with a read() method is given, it will be read in chunks for incremental decompression\n\n**Returns:** `string | null` - The decompressed data as a string, or null on error\n\n**Example:**\n```ucode\n// inflate compressed data\nconst inflated = inflate(compressed_data);\n```'],

    ['deflater', '**deflater(gzip?, level?)** - Initializes a deflate stream for streaming compression.\n\n**Parameters:**\n- `gzip` (boolean, optional, default: false): Add a gzip header if true (creates gzip-compliant output), otherwise defaults to Zlib format\n- `level` (number, optional, default: Z_DEFAULT_COMPRESSION): The compression level (0-9)\n\n**Returns:** `zlib.deflate | null` - A stream handle that can be used with write() and read() methods, or null on error\n\n**Example:**\n```ucode\n// create streaming deflate\nconst zstrmd = deflater(true, Z_BEST_SPEED);\nzstrmd.write("data", Z_NO_FLUSH);\nconst compressed = zstrmd.read();\n```'],

    ['inflater', '**inflater()** - Initializes an inflate stream for streaming decompression.\n\n**Returns:** `zlib.inflate | null` - A stream handle that can be used with write() and read() methods for streaming decompression. Can process either Zlib or gzip data, or null on error\n\n**Example:**\n```ucode\n// create streaming inflate\nconst zstrmi = inflater();\nzstrmi.write(compressed_data, Z_NO_FLUSH);\nconst decompressed = zstrmi.read();\n```']
]);

// ============================================================================
// Resolv Built-in Functions (from resolv.c global_fns[])
// These are global functions, not methods of a resolv module object
// ============================================================================

export const resolvBuiltinFunctions = new Map<string, string>([
    ['query', '**query(names, options?)** - Perform DNS queries for specified domain names.\\n\\n**Parameters:**\\n- `names` (string | string[]): Domain name(s) to query. Can be a single domain name string or an array of domain name strings. IP addresses can also be provided for reverse DNS lookups\\n- `options` (object, optional): Query options object with properties:\\n  - `type` (string[], optional): Array of DNS record types: \'A\', \'AAAA\', \'CNAME\', \'MX\', \'NS\', \'PTR\', \'SOA\', \'SRV\', \'TXT\', \'ANY\'\\n  - `nameserver` (string[], optional): Array of DNS nameserver addresses (e.g., \'8.8.8.8#53\')\\n  - `timeout` (number, optional, default: 5000): Total timeout in milliseconds\\n  - `retries` (number, optional, default: 2): Number of retry attempts\\n  - `edns_maxsize` (number, optional, default: 4096): Maximum UDP packet size for EDNS\\n\\n**Returns:** `object` - Object containing DNS query results organized by domain name\\n\\n**Example:**\\n```ucode\\n// Basic lookup\\nconst result = query([\"example.com\"]);\\n\\n// Specific record types\\nconst mx = query([\"example.com\"], { type: [\"MX\"] });\\n\\n// Reverse DNS\\nconst ptr = query([\"192.0.2.1\"], { type: [\"PTR\"] });\\n```'],
    
    ['error', '**error()** - Get the last error message from DNS operations.\\n\\n**Returns:** `string | null` - A descriptive error message for the last failed operation, or null if no error occurred\\n\\n**Example:**\\n```ucode\\nconst result = query(\"example.org\", { nameserver: [\"invalid.server\"] });\\nconst err = error();\\nif (err) {\\n    print(\"DNS query failed: \", err, \"\\n\");\\n}\\n```']
]);

// ============================================================================
// Socket Built-in Functions (from socket.c global_fns[])
// These are global functions, not methods of a socket module object
// ============================================================================

export const socketBuiltinFunctions = new Map<string, string>([
    ['create', '**create(domain?, type?, protocol?)** - Creates a network socket instance with the specified domain, type, and protocol.\\n\\n**Parameters:**\\n- `domain` (number, optional): Communication domain (default: AF_INET). Values include AF_INET, AF_INET6, AF_UNIX, AF_PACKET\\n- `type` (number, optional): Socket type (default: SOCK_STREAM). Values include SOCK_STREAM, SOCK_DGRAM, SOCK_RAW. Can be OR-ed with SOCK_NONBLOCK or SOCK_CLOEXEC\\n- `protocol` (number, optional): Protocol to be used (default: 0)\\n\\n**Returns:** `socket | null` - Socket instance or null on error\\n\\n**Example:**\\n```ucode\\n// Create TCP socket\\nlet tcp_sock = create(AF_INET, SOCK_STREAM);\\n\\n// Create UDP socket\\nlet udp_sock = create(AF_INET, SOCK_DGRAM);\\n\\n// Create non-blocking TCP socket\\nlet nb_sock = create(AF_INET, SOCK_STREAM | SOCK_NONBLOCK);\\n```'],
    
    ['connect', '**connect(host, service?, hints?, timeout?)** - Creates a network socket and connects it to the specified host and service.\\n\\n**Parameters:**\\n- `host` (string | number[] | SocketAddress): Host to connect to. Can be IP address, hostname, SocketAddress object, or IP array from iptoarr()\\n- `service` (string | number, optional): Service name or port number. Optional if host is a SocketAddress\\n- `hints` (object, optional): Connection preferences with properties family, socktype, protocol, flags\\n- `timeout` (number, optional): Connection timeout in milliseconds (default: -1 for no timeout)\\n\\n**Returns:** `socket | null` - Connected socket instance or null on error\\n\\n**Example:**\\n```ucode\\n// Connect to HTTP server\\nlet conn = connect("example.org", 80);\\n\\n// Connect with IPv6 preference\\nlet conn = connect("example.com", 80, { family: AF_INET6 });\\n\\n// Connect UDP socket\\nlet udp = connect("192.168.1.1", 53, { socktype: SOCK_DGRAM });\\n```'],
    
    ['listen', '**listen(host?, service?, hints?, backlog?, reuseaddr?)** - Binds a listening network socket to the specified host and service.\\n\\n**Parameters:**\\n- `host` (string | number[] | SocketAddress, optional): Host to bind to. If omitted, binds to all interfaces\\n- `service` (string | number, optional): Service name or port number\\n- `hints` (object, optional): Socket preferences with properties family, socktype, protocol, flags\\n- `backlog` (number, optional): Maximum length of pending connections queue (default: 128)\\n- `reuseaddr` (boolean, optional): Whether to set SO_REUSEADDR option\\n\\n**Returns:** `socket | null` - Listening socket instance or null on error\\n\\n**Example:**\\n```ucode\\n// Listen on all interfaces, port 8080\\nlet server = listen("localhost", 8080);\\n\\n// Listen IPv6 only\\nlet server = listen("::1", 8080, { family: AF_INET6 });\\n\\n// Listen on UNIX domain socket\\nlet server = listen({ path: "/tmp/server.sock" });\\n```'],
    
    ['sockaddr', '**sockaddr(address)** - Parses the provided address value into a socket address representation.\\n\\n**Parameters:**\\n- `address` (string | number[] | SocketAddress): Address to parse. Can be IP string with optional port, IP array, or address object\\n\\n**Returns:** `SocketAddress | null` - Parsed socket address object or null on error\\n\\n**Example:**\\n```ucode\\n// Parse IP with port\\nlet addr = sockaddr("192.168.1.1:8080");\\n\\n// Parse IPv6 with port\\nlet addr = sockaddr("[fe80::1%eth0]:8080");\\n\\n// Parse IP array\\nlet addr = sockaddr([192, 168, 1, 1]);\\n\\n// Parse UNIX socket path\\nlet addr = sockaddr("/var/run/daemon.sock");\\n```'],
    
    ['nameinfo', '**nameinfo(address, flags?)** - Resolves the given network address into hostname and service name.\\n\\n**Parameters:**\\n- `address` (string | SocketAddress): Network address to resolve\\n- `flags` (number, optional): Resolution flags (NI_* constants)\\n\\n**Returns:** `{hostname: string, service: string} | null` - Resolved hostname and service or null on error\\n\\n**Example:**\\n```ucode\\n// Resolve IP address\\nlet result = nameinfo("192.168.1.1:80");\\nprint(result.hostname, result.service);\\n\\n// Force numeric output\\nlet result = nameinfo("8.8.8.8:53", NI_NUMERICHOST);\\n```'],
    
    ['addrinfo', '**addrinfo(hostname, service?, hints?)** - Resolves the given hostname and optional service name into a list of network addresses.\\n\\n**Parameters:**\\n- `hostname` (string): Hostname to resolve\\n- `service` (string, optional): Service name to resolve\\n- `hints` (object, optional): Resolution hints with properties family, socktype, protocol, flags\\n\\n**Returns:** `AddressInfo[] | null` - Array of resolved addresses or null on error\\n\\n**Example:**\\n```ucode\\n// Resolve all addresses\\nlet addresses = addrinfo("example.org");\\n\\n// Resolve IPv4 addresses for HTTP\\nlet ipv4 = addrinfo("example.com", "http", { family: AF_INET });\\n\\n// Resolve for TCP sockets\\nlet tcp = addrinfo("localhost", "8080", { socktype: SOCK_STREAM });\\n```'],
    
    ['poll', '**poll(timeout, ...sockets)** - Polls a number of sockets for state changes.\\n\\n**Parameters:**\\n- `timeout` (number): Timeout in milliseconds. 0 for immediate return, negative for infinite wait\\n- `sockets` (...socket | PollSpec): Socket instances or [socket, flags] tuples to poll\\n\\n**Returns:** `PollSpec[] | null` - Array of [socket, events] tuples for sockets with pending events, or null on error\\n\\n**Example:**\\n```ucode\\n// Poll sockets with 10 second timeout\\nlet events = poll(10000, sock1, sock2);\\n\\n// Poll with specific events\\nlet events = poll(5000, [sock1, POLLIN], [sock2, POLLOUT]);\\n```'],
    
    ['error', '**error(numeric?)** - Query error information for socket operations.\\n\\n**Parameters:**\\n- `numeric` (boolean, optional): Return numeric error code instead of description\\n\\n**Returns:** `string | number | null` - Error description, error code, or null if no error\\n\\n**Example:**\\n```ucode\\nlet sock = create(AF_INET, SOCK_STREAM);\\nif (!sock.connect("invalid.host", 80)) {\\n    print("Error:", error());\\n    print("Code:", error(true));\\n}\\n```'],
    
    ['strerror', '**strerror(code)** - Returns a string containing a description of the error code.\\n\\n**Parameters:**\\n- `code` (number): Error code (positive for errno, negative for EAI_* constants)\\n\\n**Returns:** `string | null` - Error description or null for unknown codes\\n\\n**Example:**\\n```ucode\\nprint(strerror(-2));  // "Name or service not known"\\nprint(strerror(113)); // "No route to host"\\n```']
]);

// ============================================================================
// ubus Built-in Functions (from ubus.c global_fns[])
// These are global functions, not methods of a ubus module object
// ============================================================================

export const ubusBuiltinFunctions = new Map<string, string>([
    ['error', '**error(numeric?)** - Retrieve the last ubus error.\n\n**Parameters:**\n- `numeric` (boolean, optional): Return error code as integer if true, otherwise return formatted error message\n\n**Returns:** `integer | string | null` - Error code, error message, or null if no error occurred\n\n**Example:**\n```ucode\nimport { connect, error } from "ubus";\nlet conn = connect("/invalid/socket");\nif (!conn) {\n    print("Error:", error());\n    print("Code:", error(true));\n}\n```'],
    
    ['connect', '**connect(socket?, timeout?)** - Establish a connection to the ubus daemon.\n\n**Parameters:**\n- `socket` (string, optional): Path to ubus socket (default: system socket)\n- `timeout` (integer, optional): Connection timeout in seconds (default: 30)\n\n**Returns:** `object` - Connection object for further ubus operations\n\n**Example:**\n```ucode\nimport { connect } from "ubus";\nlet conn = connect();\nif (conn) {\n    let objects = conn.list();\n    print("Available objects:", length(objects));\n}\n```'],
    
    ['open_channel', '**open_channel(fd, cb?, disconnect_cb?, timeout?)** - Create a ubus channel connection using an existing file descriptor.\n\n**Parameters:**\n- `fd` (integer): File descriptor for the channel\n- `cb` (function, optional): Callback function for incoming requests\n- `disconnect_cb` (function, optional): Callback function for disconnect events\n- `timeout` (integer, optional): Timeout in seconds (default: 30)\n\n**Returns:** `object` - Channel object for bidirectional communication\n\n**Example:**\n```ucode\nimport { open_channel } from "ubus";\nlet channel = open_channel(socket_fd, function(req) {\n    print("Received request:", req.method);\n});\n```'],
    
    ['guard', '**guard(handler?)** - Set or get the global ubus exception handler.\n\n**Parameters:**\n- `handler` (function, optional): Exception handler function to set\n\n**Returns:** `function | boolean` - Current handler if no arguments, true if handler was set successfully\n\n**Example:**\n```ucode\nimport { guard } from "ubus";\n// Set exception handler\nguard(function(ex) {\n    print("ubus exception:", ex.message);\n});\n\n// Get current handler\nlet currentHandler = guard();\n```']
]);

// ============================================================================
// UCI Built-in Functions (from uci.c global_fns[])
// These are global functions, not methods of a uci module object
// ============================================================================

export const uciBuiltinFunctions = new Map<string, string>([
    ['error', '**error()** - Query error information.\n\n**Returns:** `string | null` - Description of the last occurred error or null if there is no error information\n\n**Example:**\n```ucode\n// Trigger error\nconst ctx = cursor();\nctx.set("not_existing_config", "test", "1");\n\n// Print error (should yield "Entry not found")\nprint(error(), "\\n");\n```'],
    
    ['cursor', '**cursor([config_dir], [delta_dir], [config2_dir], [flags])** - Instantiate uci cursor.\n\n**Parameters:**\n- `config_dir` (string, optional): The directory to search for configuration files (default: "/etc/config")\n- `delta_dir` (string, optional): The directory to save delta records in (default: "/tmp/.uci")\n- `config2_dir` (string, optional): The directory to keep override config files in (default: "/var/run/uci")\n- `flags` (object, optional): Parser flags object with properties "strict" and "print_errors"\n\n**Returns:** `uci.cursor | null` - The instantiated cursor on success, null on error\n\n**Example:**\n```ucode\nimport { cursor } from "uci";\n\nlet ctx = cursor();\nlet hostname = ctx.get_first("system", "system", "hostname");\n\n// Custom configuration\nlet custom_ctx = cursor("/tmp/config", "/tmp/delta");\n```']
]);

// Merge all builtins for completion
// NOTE: fsBuiltinFunctions are now fs.* module functions only, not global
// Module-specific functions should NOT be included in global builtins
// They are available only when importing from their respective modules:
// - nl80211BuiltinConstants: only via import from 'nl80211'
// - rtnl functions: only via import from 'rtnl' (when implemented)
export const allBuiltinFunctions = new Map([...builtinFunctions]); //, ...debugBuiltinFunctions, ...digestBuiltinFunctions, ...logBuiltinFunctions, ...mathBuiltinFunctions, ...resolvBuiltinFunctions, ...socketBuiltinFunctions, ...ubusBuiltinFunctions, ...uciBuiltinFunctions, ...zlibBuiltinFunctions]);