// UC6006: io's IOC_DIR_* constants are Linux-only (lib/io.c gates them behind
// `#if defined(__linux__)` → HAS_IOCTL). Using one emits an INFORMATION diagnostic
// (portability note, not an error) — they exist on OpenWrt/Linux but not on a
// macOS/BSD ucode build. See PLATFORM_GATED_SYMBOLS in src/analysis/ucodeVersions.ts.
import { test, expect, describe } from 'bun:test';
const path = require('path');
const { UcodeLexer } = require(path.resolve('src/lexer/ucodeLexer'));
const { UcodeParser } = require(path.resolve('src/parser/ucodeParser'));
const { SemanticAnalyzer } = require(path.resolve('src/analysis/semanticAnalyzer'));
const { TextDocument } = require('vscode-languageserver-textdocument');

function diags(code) {
  const doc = TextDocument.create('file:///t.uc', 'ucode', 1, code);
  const { ast } = new UcodeParser(new UcodeLexer(code, { rawMode: true }).tokenize(), code).parse();
  return new SemanticAnalyzer(doc, {}).analyze(ast).diagnostics;
}
const u6006 = (code) => diags(code).filter(d => d.code === 'UC6006');

describe('UC6006: Linux-only io IOC_DIR_* constants', () => {
  test('named import of a gated constant → one INFO (severity 3)', () => {
    const ds = u6006("import { IOC_DIR_NONE } from 'io';\n");
    expect(ds.length).toBe(1);
    expect(ds[0].severity).toBe(3); // DiagnosticSeverity.Information
    expect(ds[0].message).toContain('Linux-only');
    expect(ds[0].message).toContain('io.IOC_DIR_NONE');
  });

  test('all four IOC_DIR_* constants are gated', () => {
    const ds = u6006("import { IOC_DIR_NONE, IOC_DIR_READ, IOC_DIR_WRITE, IOC_DIR_RW } from 'io';\n");
    expect(ds.length).toBe(4);
    expect(ds.every(d => d.severity === 3)).toBe(true);
  });

  test('namespace member access (io.IOC_DIR_RW) is gated', () => {
    expect(u6006("import * as io from 'io';\nio.IOC_DIR_RW;\n").length).toBe(1);
  });

  test('gated constant used as a call argument is gated', () => {
    expect(u6006("import * as io from 'io';\nlet f = io.open('/x');\nf.ioctl(io.IOC_DIR_NONE, 1, 2);\n").length).toBeGreaterThanOrEqual(1);
  });

  test('non-gated io constants/functions are NOT flagged (no false positives)', () => {
    expect(u6006("import { O_RDONLY, SEEK_SET } from 'io';\n").length).toBe(0);
    expect(u6006("import * as io from 'io';\nio.open('/x');\n").length).toBe(0);
  });
});
