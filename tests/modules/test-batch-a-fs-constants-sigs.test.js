// Batch A — fs module type-table fixes:
//  - #38 fs IOC_DIR_* ioctl-direction constants are importable (ucode/lib/fs.c ADD_CONST).
//  - #127 fs.glob is variadic (...patterns) — signature help must show the rest param.
//  - #128 fs.lsdir accepts an optional 2nd pattern (string|regexp) filter — must appear in sig help.
const { test, expect, beforeAll, afterAll } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');

let s, n = 0;
beforeAll(async () => { s = createLSPTestServer(); await s.initialize(); });
afterAll(() => { try { s.shutdown(); } catch {} });
const errs = async (code) => ((await s.getDiagnostics(code, `/tmp/ba-fs-${n++}.uc`)) || []).filter((d) => d.severity === 1);
const sigLabel = async (code, line, char) => {
  const sh = await s.getSignatureHelp(code, `/tmp/ba-fs-sig-${n++}.uc`, line, char);
  return sh && sh.signatures && sh.signatures[0] ? sh.signatures[0].label : null;
};

// ── #38: IOC_DIR_* constants are exported by fs ──
test('fs exports IOC_DIR_* ioctl direction constants (no UC3005)', async () => {
  const e = await errs("import { IOC_DIR_NONE, IOC_DIR_READ, IOC_DIR_WRITE, IOC_DIR_RW } from 'fs';\nprint(IOC_DIR_NONE, IOC_DIR_READ, IOC_DIR_WRITE, IOC_DIR_RW);\n");
  expect(e).toEqual([]);
});
test('an imported IOC_DIR_* constant hovers with its ioctl-direction doc', async () => {
  const code = "import { IOC_DIR_READ } from 'fs';\nprint(IOC_DIR_READ);\n";
  const h = await s.getHover(code, `/tmp/ba-fs-h-${n++}.uc`, 1, code.split('\n')[1].indexOf('IOC_DIR_READ'));
  const t = (h && h.contents && (typeof h.contents === 'string' ? h.contents : h.contents.value)) || '';
  expect(t).toContain('IOC_DIR_READ');
  expect(t.toLowerCase()).toContain('ioctl');
});

// ── #127: glob is variadic ──
test('fs.glob signature help shows the variadic ...patterns param', async () => {
  const code = "import { glob } from 'fs';\nglob('/tmp/*', '/etc/*');\n";
  const label = await sigLabel(code, 1, code.split('\n')[1].indexOf('glob(') + 5);
  expect(label).toBe('glob(...patterns)');
});
test('fs.glob with multiple pattern args raises no arg-count error', async () => {
  const e = await errs("import { glob } from 'fs';\nlet f = glob('/tmp/*', '/etc/*', '/var/*');\nprint(f);\n");
  expect(e).toEqual([]);
});

// ── #128: lsdir optional pattern ──
test('fs.lsdir signature help shows the optional pattern param', async () => {
  const code = "import { lsdir } from 'fs';\nlsdir('/etc', '*.conf');\n";
  const label = await sigLabel(code, 1, code.split('\n')[1].indexOf('lsdir(') + 6);
  expect(label).toBe('lsdir(path, pattern?)');
});
test('fs.lsdir with a 2nd pattern arg raises no arg-count error', async () => {
  const e = await errs("import { lsdir } from 'fs';\nlet f = lsdir('/etc', '*.conf');\nprint(f);\n");
  expect(e).toEqual([]);
});
