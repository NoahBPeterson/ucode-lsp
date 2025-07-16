# ucode Language Server Protocol (LSP)

A comprehensive Language Server Protocol implementation for the ucode scripting language, providing syntax highlighting, function definition go-to, basic type inference, and syntax error diagnostics.

## Features

### Syntax Analysis
- Precise error reporting with line/column positions. No more vague "left-hand side is not a function" errors.
- Context-aware diagnostics: 
- Basic Type Inference with union types (`integer | string | null`), so you are at least vaguely aware of what data types you are working with before deploying your code to an OpenWRT router.
- Function call validation against known signatures
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
}
```

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
bun test
```

### Adding New Features
1. Update AST nodes in `src/ast/nodes.ts`
2. Extend parser rules in `src/parser/parser.ts`
3. Add semantic analysis in `src/analysis/`
4. Update documentation

## License

MIT License - see [LICENSE](LICENSE) file for details.