#!/bin/sh
# Link man page into the npm prefix's man directory on global install.
# Silently skip if not a global install or if permissions prevent linking.

# Only run for global installs
[ "$npm_config_global" = "true" ] || exit 0

prefix="$(npm config get prefix 2>/dev/null)" || exit 0
mandir="$prefix/share/man/man1"
src="$(dirname "$0")/../man/ucode-lsp.1"

[ -d "$mandir" ] || exit 0
[ -f "$src" ] || exit 0

ln -sf "$(cd "$(dirname "$src")" && pwd)/$(basename "$src")" "$mandir/ucode-lsp.1" 2>/dev/null || true
