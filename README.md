# ucode Language Server Protocol (LSP)

A comprehensive Language Server Protocol implementation for the [ucode scripting language](https://github.com/jow-/ucode). It provides flow-sensitive type inference, target-version-aware diagnostics, autocompletion of builtins and module members, go-to-definition and hover across files, quick fixes, and a standalone CLI checker — for VS Code, Neovim, and any LSP-capable editor.

Every diagnostic carries a stable `UC####` code so you can look it up, filter it, or suppress it.

## Type inference

The LSP infers types flow-sensitively, tracking how a value's type changes as it flows through assignments, guards, and branches. Types are unions (`integer | string | null`), so you can see exactly what you're working with — including the cases you haven't handled yet — before you deploy.

ucode is a dynamically typed language, so the type system is deliberately **not total**: it cannot prove the type of every expression, and it does not try to. Two language realities drive this, and the LSP gives you a way to address each one:

- **Static gaps — what the checker can't see.** Function parameters, values that cross module boundaries, and data read from the outside world have no statically knowable type. Rather than guess, the LSP lets you annotate intent with **JSDoc-style type comments** (`@param`, `@returns`, `@typedef`). These feed directly into inference, so an annotated parameter or return value propagates everywhere it's used. A quick fix can generate a `/** @param */` block with types **inferred from how the parameter is used in the body**, and `@returns` is reconciled against the inferred return type. Run `ucode-lsp --help-types` for the annotation guide.

- **Runtime gaps — what can fail at runtime.** Many builtins legitimately return `T | null` (e.g. `fs.open()` → `fs.file | null`, `fs.readfile()` → `string | null`). The checker surfaces these as nullable unions and then **respects the narrowing you write**: a null guard (`if (fh) …`), a `type()` or `exists` check, or optional chaining (`fh?.read()`) narrows `T | null` down to `T` for the rest of that flow. Member access on a still-nullable value is flagged (a warning, escalating to an error under `'use strict';`), pointing you at the runtime check that's actually missing.

In short: inference does as much as is soundly possible, JSDoc annotations close the static gaps, and runtime checks close the nullable-return gaps — and the checker rewards both.

## Features

### Diagnostics
- **Null safety** — member access on a provably-null value is an error, and access on a possibly-null `T | null` value is a warning that escalates to an error under `'use strict';`.
- **Builtin call validation** — argument counts, types, and coercions checked against real ucode signatures (including a full `printf`/`sprintf` format checker), with precise line/column positions. No more vague "left-hand side is not a function" errors.
- **Scope analysis** — undefined variables, `const` reassignment, shadowing, use-before-declaration, and unused imports, with ucode's non-strict vs `'use strict';` semantics modeled faithfully (implicit globals, last-write-wins redeclaration, etc.).
- **Target-version awareness** — modules, functions, and methods are gated to a chosen OpenWrt/ucode release (`UC6005`); using something newer than your target is flagged. See [Target version](#target-version).

### Quick fixes & code actions
- Add a missing import for an unresolved module member.
- Add inferred null guards or optional chaining (`?.`) on possibly-null access.
- Insert a `/** @param */` JSDoc block with types **inferred from body usage**.
- Coerce a non-string argument where a builtin expects one.
- Type-guard narrowing fixes, generated from the AST (not text scraping).

### Autocompletion
- Context-aware completions for builtins, locals, and module members.
- Module-specific completions, e.g. `fs.` → `open`, `readfile`, `writefile`, …
- Member completion on object values, including `this.`, optional chaining (`obj?.`), nested members, and namespace constants (`nl80211.const.`).
- Completion is correctly suppressed inside strings and comments.

### Code navigation & info
- **Go to Definition** across files, following re-export chains.
- **Find References** and **Rename** (workspace-wide).
- **Hover** showing inferred types and function signatures.
- **Signature help** with parameter info as you type a call.
- **Document symbols**, **folding ranges**, **document highlights**, and **inlay hints**.
- **Code lens** — Git history and reference count above each function (VS Code).

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

## Examples

### Error detection
```ucode
split("hello", 123);        // Error: split() expects (string, string)
length(42);                 // Error: length() expects a string, array, or object

let x = 5;
function test() {
    print(y);               // Error: 'y' is not defined ('use strict')
    let x = 10;             // Warning: shadows outer 'x'
    let e = open();         // Error: Undefined function 'open'
};

const PORT = 80;
PORT = 443;                 // Error: assignment to constant 'PORT' (UC1010)
```

### Null safety
```ucode
import { open } from 'fs';

let fh = open("data.txt", "r");   // fs.file | null
fh.read("all");                   // Warning: 'fh' is possibly null
fh?.read("all");                  // ok — optional chaining
```

### Module support & autocompletion
Complete IntelliSense for built-in modules:
```ucode
import { create, connect, AF_INET, SOCK_STREAM } from 'socket';
import * as math from 'math';
import { query } from 'resolv';
const fs = require('fs');

let sock = create(AF_INET, SOCK_STREAM);  // ✅ Full autocomplete
let result = connect(sock, "example.com", "80");
let sqrt_val = math.sqrt(16);             // ✅ Namespace imports

let file = fs.open("test.txt", "r");      // ✅ fs.open(), fs.readfile(), fs.writefile()...
let content = fs.readfile("data.txt");    // string | null
```

**Supported modules:**
- **debug** — runtime debugging and introspection
- **digest** — cryptographic hash functions
- **fs** — file system operations (`open`, `readfile`, `writefile`, `stat`, …)
- **io** — I/O handle operations (OpenWrt 25.12+)
- **log** — system logging (syslog, ulog functions)
- **math** — mathematical functions (`sin`, `cos`, `sqrt`, …)
- **nl80211** — WiFi/802.11 networking
- **resolv** — DNS resolution
- **rtnl** — netlink routing (routes, links, addresses)
- **socket** — network socket functionality
- **struct** — binary data packing/unpacking
- **ubus** — OpenWrt inter-process communication
- **uci** — OpenWrt UCI configuration management
- **uloop** — event loop and timer functionality
- **zlib** — compression/decompression

## Configuration

### Target version
Diagnostics are gated to a target OpenWrt/ucode release so the LSP only offers — and only accepts — what exists in your deployment target. The default is the latest stable release (`25.12`).

- VS Code: set `ucode.targetVersion`, or run **"ucode: Select target OpenWrt/ucode version"** from the Command Palette.
- Allowed values: `main`, `25.12`, `24.10`, `23.05`, `22.03`.

### VS Code settings
```json
{
  "ucode.targetVersion": "25.12",
  "ucode.maxNumberOfProblems": 100,
  "ucode.inlayHints.enable": true,
  "ucode.trace.server": "off"
}
```

### Commands (VS Code)
- **ucode: Select target OpenWrt/ucode version**
- **ucode: Show Function Git History**
- **ucode: Show Function References**

## Architecture

- **Lexer** (`src/lexer/`) — tokenization and basic syntax validation
- **Parser** (`src/parser/`) — AST generation with error recovery
- **Semantic analyzer** (`src/analysis/`) — type inference, flow analysis, and scope checking; module type definitions and the version-gating registry
- **LSP server** (`src/server.ts`) — editor integration via LSP (editor-agnostic)
- **CLI checker** (`src/cli.ts`) — standalone diagnostic output (like `tsc`)

## Contributing

### Development workflow
1. Make changes to source files in `src/`.
2. Build with `bun run compile`.
3. Verify types with `tsc --noEmit` and run the test suite.
4. Test interactively in the VS Code extension host.
5. Submit a pull request.

### Testing
```bash
# Primary testing with Bun
bun test tests/

# Node.js fallback for individual files
npx mocha tests/test-real-double-diagnostic-fix.test.js
node tests/specific-test-file.js
```

## License

MIT License — see [LICENSE](LICENSE) file for details.
