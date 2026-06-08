// Extensionless ucode scripts that start with a ucode shebang (#!/usr/bin/env ucode,
// like OpenWrt's /usr/sbin/unetacld) are treated as ucode source: the workspace scan
// analyzes them (Problems panel for UNOPENED files) and the file index includes them.
// Editor language detection is handled separately by package.json `firstLine`.
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { isUcodeSourceFile, hasUcodeShebang, UCODE_SHEBANG } = require('../src/shebang');
const { createLSPTestServer } = require('./lsp-test-helpers');

setDefaultTimeout(20000); // scan + waitForDiagnostics are async
const uriOf = (p) => 'file://' + p;

// ── Unit: the shebang regex ──────────────────────────────────────────────────
const reMatches = (line) => UCODE_SHEBANG.test(line);
test('01 regex matches #!/usr/bin/env ucode', () => expect(reMatches('#!/usr/bin/env ucode')).toBe(true));
test('02 regex matches #!/usr/bin/ucode', () => expect(reMatches('#!/usr/bin/ucode')).toBe(true));
test('03 regex matches #!/usr/bin/ucode -S', () => expect(reMatches('#!/usr/bin/ucode -S')).toBe(true));
test('04 regex matches #!/usr/bin/env -S ucode -R', () => expect(reMatches('#!/usr/bin/env -S ucode -R')).toBe(true));
test('05 regex rejects node shebang', () => expect(reMatches('#!/usr/bin/env node')).toBe(false));
test('06 regex rejects /bin/sh', () => expect(reMatches('#!/bin/sh')).toBe(false));
test('07 regex rejects a non-shebang line', () => expect(reMatches('let x = 1;')).toBe(false));
test('08 regex rejects "microcode" (word boundary)', () => expect(reMatches('#!/usr/bin/microcode')).toBe(false));

// ── Unit: hasUcodeShebang / isUcodeSourceFile against real files ─────────────
let udir;
beforeAll(() => {
  udir = fs.mkdtempSync(path.join(os.tmpdir(), 'shbu-'));
  fs.writeFileSync(path.join(udir, 'unetacld'), '#!/usr/bin/env ucode\nprint("hi\\n");\n');
  fs.writeFileSync(path.join(udir, 'tool'), '#!/usr/bin/ucode\nprint(1);\n');
  fs.writeFileSync(path.join(udir, 'plain.uc'), 'print(1);\n');
  fs.writeFileSync(path.join(udir, 'Makefile'), 'all:\n\techo hi\n');     // extensionless, no shebang
  fs.writeFileSync(path.join(udir, 'script.sh'), '#!/bin/sh\necho hi\n');  // shell shebang
  fs.writeFileSync(path.join(udir, 'lib.c'), '#!/usr/bin/env ucode\n');    // .c with a ucode shebang (extension wins → skip)
  fs.writeFileSync(path.join(udir, 'README'), 'just text\n');
});
afterAll(() => { try { fs.rmSync(udir, { recursive: true, force: true }); } catch {} });

test('09 hasUcodeShebang true for an env-ucode script', () => expect(hasUcodeShebang(path.join(udir, 'unetacld'))).toBe(true));
test('10 hasUcodeShebang true for a direct ucode script', () => expect(hasUcodeShebang(path.join(udir, 'tool'))).toBe(true));
test('11 hasUcodeShebang false for a shell script', () => expect(hasUcodeShebang(path.join(udir, 'script.sh'))).toBe(false));
test('12 hasUcodeShebang false for a missing file', () => expect(hasUcodeShebang(path.join(udir, 'nope'))).toBe(false));
test('13 isUcodeSourceFile true for a .uc file (no read needed)', () => expect(isUcodeSourceFile(path.join(udir, 'plain.uc'))).toBe(true));
test('14 isUcodeSourceFile true for an extensionless shebang script', () => expect(isUcodeSourceFile(path.join(udir, 'unetacld'))).toBe(true));
test('15 isUcodeSourceFile false for an extensionless non-shebang file (Makefile)', () => expect(isUcodeSourceFile(path.join(udir, 'Makefile'))).toBe(false));
test('16 isUcodeSourceFile false for README', () => expect(isUcodeSourceFile(path.join(udir, 'README'))).toBe(false));
test('17 isUcodeSourceFile false for a shell script', () => expect(isUcodeSourceFile(path.join(udir, 'script.sh'))).toBe(false));
test('18 isUcodeSourceFile false for a .c file even with a ucode shebang (extension wins)', () => expect(isUcodeSourceFile(path.join(udir, 'lib.c'))).toBe(false));

// ── Integration: workspace scan picks up unopened shebang scripts ────────────
let dir, server, shebangScript, shebangScript2, plainUc, makefile;
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shbscan-'));
  // Unopened extensionless shebang script with a real error (forward reference)
  shebangScript = path.join(dir, 'unetacld');
  fs.writeFileSync(shebangScript, "#!/usr/bin/env ucode\n'use strict';\nlet x = greet();\nfunction greet() { return 1; }\n");
  shebangScript2 = path.join(dir, 'cli');
  fs.writeFileSync(shebangScript2, '#!/usr/bin/ucode\nlet y = ;\n'); // parse error
  plainUc = path.join(dir, 'ok.uc');
  fs.writeFileSync(plainUc, 'print(1);\n');
  makefile = path.join(dir, 'Makefile');
  fs.writeFileSync(makefile, 'let x = ;\n'); // would error IF (wrongly) scanned as ucode
  server = createLSPTestServer({ workspaceRoot: dir });
  await server.initialize();
});
afterAll(() => { try { server.shutdown(); } catch {} try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

test('19 scan publishes diagnostics for an unopened shebang script (forward-ref)', async () => {
  const ds = await server.waitForDiagnostics(uriOf(shebangScript), (d) => d && d.length > 0, 8000);
  expect(ds.some((x) => /used before its declaration/.test(x.message || ''))).toBe(true);
});
test('20 scan publishes diagnostics for a #!/usr/bin/ucode script (parse error)', async () => {
  const ds = await server.waitForDiagnostics(uriOf(shebangScript2), (d) => d && d.length > 0, 8000);
  expect(ds.length).toBeGreaterThan(0);
});
test('21 the extensionless non-ucode Makefile is NOT scanned (no diagnostics published)', async () => {
  // ensure the scan has run (a shebang file has diagnostics), then assert Makefile got none
  await server.waitForDiagnostics(uriOf(shebangScript), (d) => d && d.length > 0, 8000);
  let timedOut = false;
  try { await server.waitForDiagnostics(uriOf(makefile), (d) => d && d.length > 0, 1500); }
  catch { timedOut = true; }
  expect(timedOut).toBe(true); // never published → not analyzed as ucode
});
test('22 a newly-created shebang script is analyzed (watched Create)', async () => {
  const p = path.join(dir, 'freshd');
  fs.writeFileSync(p, "#!/usr/bin/env ucode\nlet z = ;\n");
  server.notifyWatchedFileChange(uriOf(p), 1 /* Created */);
  const ds = await server.waitForDiagnostics(uriOf(p), (d) => d && d.length > 0, 8000);
  expect(ds.length).toBeGreaterThan(0);
});
test('23 deleting a shebang script clears its published problems', async () => {
  await server.waitForDiagnostics(uriOf(shebangScript2), (d) => d && d.length > 0, 8000);
  fs.rmSync(shebangScript2);
  server.notifyWatchedFileChange(uriOf(shebangScript2), 3 /* Deleted */);
  const ds = await server.waitForDiagnostics(uriOf(shebangScript2), (d) => d && d.length === 0, 8000);
  expect(ds.length).toBe(0);
});
