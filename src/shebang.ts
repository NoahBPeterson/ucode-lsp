/**
 * Detection of ucode source files, including extensionless executable scripts that
 * start with a ucode shebang (e.g. OpenWrt's `/usr/sbin/unetacld`). Used by the
 * workspace scan / file index so unopened shebang scripts get diagnostics and
 * participate in cross-file features — not just `*.uc` files.
 */
import * as fs from 'fs';
import * as path from 'path';

// Mirrors the `firstLine` pattern in package.json that drives editor language
// detection: `#!/usr/bin/env ucode`, `#!/usr/bin/ucode`, `#!… ucode -R`, etc.
export const UCODE_SHEBANG = /^#!.*\bucode\b/;

/**
 * Read just the first line (bounded I/O — 128 bytes, regardless of file size) and
 * test for a ucode shebang. Returns false on any read error (missing/permission/etc.).
 */
export function hasUcodeShebang(filePath: string): boolean {
  let fd: number | undefined;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.allocUnsafe(128);
    const n = fs.readSync(fd, buf, 0, 128, 0);
    const firstLine = buf.toString('utf8', 0, n).split(/\r?\n/, 1)[0] ?? '';
    return UCODE_SHEBANG.test(firstLine);
  } catch {
    return false;
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* ignore */ } }
  }
}

/**
 * A workspace file is ucode source if it ends in `.uc`, OR it's an extensionless file
 * whose first line is a ucode shebang. The extensionless gate bounds the shebang peek
 * to plausible scripts (skips `.c`/`.so`/`.json`/binaries), keeping the directory walk
 * cheap on large trees.
 */
export function isUcodeSourceFile(filePath: string): boolean {
  if (filePath.endsWith('.uc')) return true;
  if (path.basename(filePath).includes('.')) return false;
  return hasUcodeShebang(filePath);
}
