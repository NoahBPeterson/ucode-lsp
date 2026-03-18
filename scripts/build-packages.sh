#!/bin/bash
set -euo pipefail

VERSION=$(node -p "require('./package.json').version")

echo "Building ucode-lsp v${VERSION}..."

# Install dependencies
bun install

# Package VSIX (runs webpack via vscode:prepublish automatically)
bunx @vscode/vsce package --no-dependencies -o "ucode-lsp-${VERSION}.vsix"

echo ""
echo "Build complete:"
echo "  VSIX:       ucode-lsp-${VERSION}.vsix"
echo "  LSP server: dist/server.js"
