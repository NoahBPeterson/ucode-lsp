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

/** Async variant of {@link hasUcodeShebang} (yields instead of a blocking read). */
export async function hasUcodeShebangAsync(filePath: string): Promise<boolean> {
  let fh: fs.promises.FileHandle | undefined;
  try {
    fh = await fs.promises.open(filePath, 'r');
    const buf = Buffer.allocUnsafe(128);
    const { bytesRead } = await fh.read(buf, 0, 128, 0);
    const firstLine = buf.toString('utf8', 0, bytesRead).split(/\r?\n/, 1)[0] ?? '';
    return UCODE_SHEBANG.test(firstLine);
  } catch {
    return false;
  } finally {
    if (fh) { try { await fh.close(); } catch { /* ignore */ } }
  }
}

/**
 * Caches the shebang peek per extensionless file, keyed by mtime, so repeated workspace
 * walks (the startup scan + the file-index TTL refresh, which can re-walk thousands of
 * extensionless files in a large vendored tree) don't re-read unchanged files. A file's
 * `isUcode` verdict only changes when its first line changes, which changes its mtime —
 * so the mtime key auto-invalidates stale entries; no explicit eviction is needed. The
 * cache is bounded by the number of distinct extensionless files seen.
 */
const shebangPeekCache = new Map<string, { mtimeMs: number; isUcode: boolean }>();

/** Test helper: drop all cached peek verdicts (so a test controls cold/warm state). */
export function clearShebangPeekCache(): void {
  shebangPeekCache.clear();
}

/**
 * A workspace file is ucode source if it ends in `.uc`, OR it's an extensionless file
 * whose first line is a ucode shebang. The extensionless gate bounds the shebang peek
 * to plausible scripts (skips `.c`/`.so`/`.json`/binaries), keeping the directory walk
 * cheap on large trees. The shebang verdict is mtime-cached (see {@link shebangPeekCache}).
 */
export function isUcodeSourceFile(filePath: string): boolean {
  if (filePath.endsWith('.uc')) return true;
  if (path.basename(filePath).includes('.')) return false;
  let mtimeMs: number;
  try { mtimeMs = fs.statSync(filePath).mtimeMs; } catch { return false; }
  const cached = shebangPeekCache.get(filePath);
  if (cached && cached.mtimeMs === mtimeMs) return cached.isUcode;
  const isUcode = hasUcodeShebang(filePath);
  shebangPeekCache.set(filePath, { mtimeMs, isUcode });
  return isUcode;
}

/**
 * Async variant of {@link isUcodeSourceFile} — stats/reads via fs.promises so the
 * workspace walk yields to the event loop instead of blocking per extensionless file
 * (matters on large trees). Shares the same mtime-keyed {@link shebangPeekCache}.
 */
export async function isUcodeSourceFileAsync(filePath: string): Promise<boolean> {
  if (filePath.endsWith('.uc')) return true;
  if (path.basename(filePath).includes('.')) return false;
  let mtimeMs: number;
  try { mtimeMs = (await fs.promises.stat(filePath)).mtimeMs; } catch { return false; }
  const cached = shebangPeekCache.get(filePath);
  if (cached && cached.mtimeMs === mtimeMs) return cached.isUcode;
  const isUcode = await hasUcodeShebangAsync(filePath);
  shebangPeekCache.set(filePath, { mtimeMs, isUcode });
  return isUcode;
}
