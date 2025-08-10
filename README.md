# ucode Language Server Protocol (LSP)

A comprehensive Language Server Protocol implementation for the [ucode scripting language](https://github.com/jow-/ucode), providing autocompletion of known module functions and builtins, syntax highlighting, function definition go-to, basic type inference, and syntax error diagnostics.

## Features

### Autocompletion
- Context-aware completions for builtin functions, variables, and module members
- Module-specific completions (e.g., `fs.open()`, `fs.readfile()`)
- Variable name suggestions from current scope including imported modules
- Function signature hints and parameter information

### Error Detection & Diagnostics
- Precise error reporting with line/column positions. No more vague "left-hand side is not a function" errors.
- Context-aware diagnostics
- Basic Type Inference with union types (`integer | string | null`), so you are aware of what data types you are working with before deploying your code.
- Function call validation against known signatures with proper argument count checking
- Scope analysis detecting undefined variables and shadowing

### Code Navigation
- Go to Definition for imported functions across files
- Symbol resolution with cross-file analysis
- Hover information showing types and function signatures

### Performance Optimized
- Caching system for analysis results

## Quick Start

### Installation
1. Install the VS Code extension from the marketplace (once I upload it to the marketplace)

### Development Setup
```bash
git clone https://github.com/NoahBPeterson/ucode-lsp.git
cd ucode-lsp

bun install

bun run compile

bun run package && vsce package
```

## Language Support

### Syntax Highlighting
- Complete ucode language grammar
- Proper tokenization for all language constructs
- Context-aware highlighting for keywords, operators, and literals

### Error Detection
```ucode
split("hello", 123);        // Error: expects (string, string)
length(42);                 // Error: expects string, got number

let x = 5;
function test() {
    print(y);               // Error: 'y' is not defined
    let x = 10;             // Warning: shadows outer 'x'
    let e = open();         // Error: Undefined function: open
};

function myFunc() {         // Error: Functions must end with a semicolon ';'
    return 42;
}
```

### Module Support & Autocompletion
Complete IntelliSense for built-in modules:
```ucode
import { create, connect, AF_INET, SOCK_STREAM } from 'socket';
import * as math from 'math';
import { query } from 'resolv';
const fs = require('fs');

let sock = create(AF_INET, SOCK_STREAM);  // ✅ Full autocomplete
let result = connect(sock, "example.com", "80");
let sqrt_val = math.sqrt(16);             // ✅ Namespace imports

// Smart module-specific completions
let file = fs.open("test.txt", "r");      // ✅ fs.open(), fs.readfile(), fs.writefile()...
let content = fs.readfile("data.txt");    // ✅ All 27 fs module functions available
```

**Supported Modules:**
- **socket** - Network socket functionality (create, connect, listen, etc.)
- **math** - Mathematical functions (sin, cos, sqrt, etc.)
- **log** - System logging (syslog, ulog functions)
- **resolv** - DNS resolution (query, error functions)
- **nl80211** - WiFi/802.11 networking
- **debug** - Runtime debugging and introspection
- **digest** - Cryptographic hash functions
- **fs** - File system operations with comprehensive autocompletion for all 27 functions (open, readfile, writefile, stat, access, etc.)
- **uci** - OpenWrt UCI configuration management
- **uloop** - Event loop and timer functionality

### Code Navigation
```ucode
import { run_command } from '../lib/commands.uc';

function process() {
    run_command("netstat");  // Right-click → Go to Definition
}
```

## Architecture

### Core Components
- Lexer (`src/lexer/`) - Tokenization and basic syntax validation
- Parser (`src/parser/`) - AST generation with error recovery
- Semantic Analyzer (`src/analysis/`) - Type checking and scope analysis
- LSP Server (`src/server.ts`) - VS Code integration

## Configuration

### VS Code Settings
```json
{
  "ucode.maxNumberOfProblems": 100,
  "ucode.trace.server": "verbose"
}
```

### Validation Modes
- `lexer` - Basic token-based validation
- `ast-basic` - AST parser with fallback (recommended)
- `ast-full` - Full semantic analysis

## Contributing

### Development Workflow
1. Make changes to source files in `src/`
2. Follow the steps in Development Setup
3. Test with VS Code extension host
4. Submit pull request

### Testing
```bash
# Primary testing with Bun
bun test

# For Bun compatibility issues, use Node.js fallback:
npx mocha tests/test-real-double-diagnostic-fix.test.js
node tests/specific-test-file.js
```

## License

MIT License - see [LICENSE](LICENSE) file for details.