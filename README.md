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

### npm (CLI + LSP server)
```bash
npm install -g ucode-lsp
```

This gives you the `ucode-lsp` command with two modes:

**Check mode** — scan files and print diagnostics (like `tsc`):
```bash
ucode-lsp                     # check all .uc files in current directory
ucode-lsp src/                # check a specific directory
ucode-lsp file.uc             # check a specific file
ucode-lsp --verbose           # include info-level diagnostics
```

**LSP server mode** — for editors:
```bash
ucode-lsp --stdio             # start LSP server over stdio
```

Run `ucode-lsp --help` for all options, or `ucode-lsp --help-types` for the type annotation guide. A man page is also available: `man ucode-lsp`.

### VS Code
Install the extension from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=noahbpeterson.ucode-lsp).

### Neovim (0.11+)
Add to `~/.config/nvim/init.lua`:
```lua
vim.filetype.add({ extension = { uc = 'ucode' } })

vim.lsp.config('ucode', {
  cmd = { 'ucode-lsp', '--stdio' },
  filetypes = { 'ucode' },
  root_markers = { '.git' },
})
vim.lsp.enable('ucode')
```

### Building from Source
```bash
git clone https://github.com/NoahBPeterson/ucode-lsp.git
cd ucode-lsp
bun install && bun run compile
npm install -g .              # install CLI globally from local build
```

This produces:
- `dist/server.js` — LSP server
- `dist/cli.js` — CLI checker
- `bin/ucode-lsp.js` — entry point (routes to server or CLI)

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
- **debug** - Runtime debugging and introspection
- **digest** - Cryptographic hash functions
- **fs** - File system operations (open, readfile, writefile, stat, access, etc.)
- **io** - I/O handle operations
- **log** - System logging (syslog, ulog functions)
- **math** - Mathematical functions (sin, cos, sqrt, etc.)
- **nl80211** - WiFi/802.11 networking
- **resolv** - DNS resolution (query, error functions)
- **rtnl** - Netlink routing (routes, links, addresses)
- **socket** - Network socket functionality (create, connect, listen, etc.)
- **struct** - Binary data packing/unpacking
- **ubus** - OpenWrt inter-process communication
- **uci** - OpenWrt UCI configuration management
- **uloop** - Event loop and timer functionality
- **zlib** - Compression/decompression

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
- LSP Server (`src/server.ts`) - Editor integration via LSP (editor-agnostic)
- CLI Checker (`src/cli.ts`) - Standalone diagnostic output (like `tsc`)

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