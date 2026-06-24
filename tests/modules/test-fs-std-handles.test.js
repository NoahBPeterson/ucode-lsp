// fs exports stdin/stdout/stderr as `fs.file` resources (ucode lib/fs.c:
// ucv_object_add(scope, "stdin", uc_resource_new(file_type, stdin)), etc.).
// They are importable (`import { stdin } from "fs"`), namespace-accessible
// (`fs.stdin`), and carry all fs.file methods. This suite exercises that support.
const { test, expect, beforeAll, afterAll } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');
const { fsModule, fsObjectExports } = require('../../src/analysis/fsModuleTypes');
const { MODULE_REGISTRIES } = require('../../src/analysis/moduleDispatch');

let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });
const uri = () => `/tmp/fsstd-${n++}.uc`;

const errs = async (code) => (await server.getDiagnostics(code, uri()) || []).filter((x) => x.severity === 1).map((x) => x.message);
const hover = async (code, l, c) => {
  const h = await server.getHover(code, uri(), l, c);
  const v = h && h.contents && (h.contents.value || h.contents);
  return (typeof v === 'string' ? v : JSON.stringify(v || '')).replace(/\n/g, ' ');
};
const labels = (cmp) => (Array.isArray(cmp) ? cmp : (cmp && cmp.items) || []).map((i) => i.label);

// ── A. Named import is valid (no UC3005) ─────────────────────────────────────
test('01 import { stdin } is valid', async () => expect(await errs(`import { stdin } from "fs";\nstdin.fileno();\n`)).toEqual([]));
test('02 import { stdout } is valid', async () => expect(await errs(`import { stdout } from "fs";\nstdout.write("x");\n`)).toEqual([]));
test('03 import { stderr } is valid', async () => expect(await errs(`import { stderr } from "fs";\nstderr.write("x");\n`)).toEqual([]));
test('04 all three together are valid', async () => expect(await errs(`import { stdin, stdout, stderr } from "fs";\nstdin.fileno(); stdout.write("a"); stderr.write("b");\n`)).toEqual([]));
test('05 no UC3005 for stdin specifically', async () => {
  const d = await server.getDiagnostics(`import { stdin } from "fs";\n`, uri());
  expect((d || []).some((x) => x.code === 'UC3005')).toBe(false);
});

// ── B. Typing / hover ────────────────────────────────────────────────────────
test('06 imported stdin hovers as fs.file', async () => expect(await hover(`import { stdin } from "fs";\nstdin.fileno();\n`, 0, 9)).toContain('fs.file'));
test('07 imported stdout hovers as fs.file', async () => expect(await hover(`import { stdout } from "fs";\nstdout.write("x");\n`, 0, 9)).toContain('fs.file'));
test('08 imported stderr hovers as fs.file', async () => expect(await hover(`import { stderr } from "fs";\nstderr.write("x");\n`, 0, 9)).toContain('fs.file'));
test('09 stdin.read hovers as the fs.file.read signature', async () => {
  const h = await hover(`import { stdin } from "fs";\nlet line = stdin.read("line");\n`, 1, 18);
  expect(h).toContain('fs.file.read');
});
test('10 stdin.fileno hovers as the fs.file.fileno signature', async () => {
  const h = await hover(`import { stdin } from "fs";\nlet fd = stdin.fileno();\n`, 1, 16);
  expect(h).toContain('fileno');
});

// ── C. fs.file methods resolve (no false "method not available") ─────────────
test('11 stdin.fileno() clean', async () => expect(await errs(`import { stdin } from "fs";\nstdin.fileno();\n`)).toEqual([]));
test('12 stdin.read("line") clean', async () => expect(await errs(`import { stdin } from "fs";\nlet l = trim(stdin.read("line"));\n`)).toEqual([]));
test('13 stdout.write(...) clean', async () => expect(await errs(`import { stdout } from "fs";\nstdout.write("hi");\n`)).toEqual([]));
test('14 stderr.write(...) clean', async () => expect(await errs(`import { stderr } from "fs";\nstderr.write("e");\n`)).toEqual([]));
test('15 stdin.close() clean', async () => expect(await errs(`import { stdin } from "fs";\nstdin.close();\n`)).toEqual([]));
test('16 stdin.error()/seek()/tell() clean', async () => expect(await errs(`import { stdin } from "fs";\nstdin.error(); stdin.seek(0); stdin.tell();\n`)).toEqual([]));

// ── D. Invalid method still flagged ──────────────────────────────────────────
test('17 stdin.bogusMethod() is flagged (object machinery)', async () => {
  expect((await errs(`import { stdin } from "fs";\nstdin.bogusMethod();\n`)).some((m) => /bogusMethod/.test(m))).toBe(true);
});
test('18 the flag names fs.file, not the fs module', async () => {
  const m = (await errs(`import { stdin } from "fs";\nstdin.bogusMethod();\n`)).find((x) => /bogusMethod/.test(x));
  expect(m).toContain('fs.file');
});

// ── E. Completion ────────────────────────────────────────────────────────────
test('19 stdin. completes fs.file methods', async () => {
  const c = labels(await server.getCompletions(`import { stdin } from "fs";\nstdin.\n`, uri(), 1, 6));
  for (const m of ['read', 'write', 'fileno', 'close', 'seek']) expect(c).toContain(m);
});
test('20 import { | } from "fs" offers stdin/stdout/stderr', async () => {
  const c = labels(await server.getCompletions(`import {  } from "fs";\n`, uri(), 0, 8));
  for (const e of ['stdin', 'stdout', 'stderr']) expect(c).toContain(e);
});
test('21 import { | } from "fs" offers functions (open) + object exports (stdin); not ST_* (main-only)', async () => {
  const c = labels(await server.getCompletions(`import {  } from "fs";\n`, uri(), 0, 8));
  expect(c).toContain('open');    // function
  expect(c).toContain('stdin');   // object export
  // ST_* statvfs mount flags are NOT real OpenWrt fs exports (musl exports none; lib/fs.c
  // gates them behind #ifdef per-libc) — modeled as main-only, so they're not offered here.
  expect(c).not.toContain('ST_RDONLY');
});
test('22 fs. namespace completion offers stdin/stdout/stderr', async () => {
  const c = labels(await server.getCompletions(`import * as fs from "fs";\nfs.\n`, uri(), 1, 3));
  for (const e of ['stdin', 'stdout', 'stderr']) expect(c).toContain(e);
});

// ── F. Namespace access (fs.stdin) ───────────────────────────────────────────
test('23 fs.stdin.fileno() clean', async () => expect(await errs(`import * as fs from "fs";\nfs.stdin.fileno();\n`)).toEqual([]));
test('24 fs.stdout.write() / fs.stderr.write() clean', async () => expect(await errs(`import * as fs from "fs";\nfs.stdout.write("a"); fs.stderr.write("b");\n`)).toEqual([]));
test('25 fs.stdin hovers as fs.file', async () => expect(await hover(`import * as fs from "fs";\nfs.stdin.fileno();\n`, 1, 4)).toContain('fs.file'));
test('26 fs.stdin hover includes the export description', async () => expect(await hover(`import * as fs from "fs";\nfs.stdin.fileno();\n`, 1, 4)).toContain('Standard input'));

// ── G. Aliased import ────────────────────────────────────────────────────────
test('27 import { stdin as si } is valid and si hovers fs.file', async () => {
  expect(await errs(`import { stdin as si } from "fs";\nsi.fileno();\n`)).toEqual([]);
  expect(await hover(`import { stdin as si } from "fs";\nsi.fileno();\n`, 1, 0)).toContain('fs.file');
});
test('28 aliased handle methods resolve', async () => expect(await errs(`import { stdin as si } from "fs";\nlet l = si.read("line");\n`)).toEqual([]));

// ── H. Negative cases preserved ──────────────────────────────────────────────
test('29 a bogus named import is still UC3005', async () => {
  const d = await server.getDiagnostics(`import { nope } from "fs";\n`, uri());
  expect((d || []).some((x) => x.code === 'UC3005')).toBe(true);
});
test('30 the UC3005 available-exports list now includes stdin/stdout/stderr', async () => {
  const d = await server.getDiagnostics(`import { nope } from "fs";\n`, uri());
  const m = (d || []).find((x) => x.code === 'UC3005').message;
  expect(m).toContain('stdin');
  expect(m).toContain('stdout');
  expect(m).toContain('stderr');
});
test('31 default-importing stdin is still rejected (builtins have no default)', async () => {
  expect((await errs(`import stdin from "fs";\n`)).some((m) => /default/i.test(m))).toBe(true);
});
test('32 bare `stdin` without import is an undefined variable', async () => {
  // Severity-agnostic: an undefined read is an Error under strict and a Warning in
  // non-strict (this fixture is non-strict, so it is a Warning), but either way the
  // diagnostic must fire.
  const d = (await server.getDiagnostics(`stdin.fileno();\n`, uri())) || [];
  expect(d.some((x) => /Undefined variable: stdin/.test(x.message || ''))).toBe(true);
});

// ── I. Mixed function + handle imports ───────────────────────────────────────
test('33 import { open, stdin } — both work', async () => {
  expect(await errs(`import { open, stdin } from "fs";\nlet f = open("x", "r");\nstdin.fileno();\n`)).toEqual([]);
});
test('34 the function import is still typed as a function (open is callable)', async () => {
  expect(await errs(`import { open, stdin } from "fs";\nopen("x");\n`)).toEqual([]);
});

// ── J. Signature help ────────────────────────────────────────────────────────
test('35 signature help on stdin.read(', async () => {
  const code = `import { stdin } from "fs";\nstdin.read(\n`;
  const sh = await server.getSignatureHelp(code, uri(), 1, 11);
  expect(sh && sh.signatures && sh.signatures.length).toBeGreaterThan(0);
});
test('36 signature help on stdout.write(', async () => {
  const code = `import { stdout } from "fs";\nstdout.write(\n`;
  const sh = await server.getSignatureHelp(code, uri(), 1, 13);
  expect(sh && sh.signatures && sh.signatures.length).toBeGreaterThan(0);
});

// ── K. Registry-level invariants ─────────────────────────────────────────────
test('37 fsObjectExports has stdin/stdout/stderr all typed fs.file', () => {
  for (const name of ['stdin', 'stdout', 'stderr']) {
    expect(fsObjectExports.get(name).objectType).toBe('fs.file');
  }
});
test('38 fs registry getValidImports includes the three exports', () => {
  const v = MODULE_REGISTRIES.fs.getValidImports();
  for (const e of ['stdin', 'stdout', 'stderr']) expect(v).toContain(e);
});
test('39 fs registry getObjectExportType resolves fs.file', () => {
  expect(MODULE_REGISTRIES.fs.getObjectExportType('stdin')).toBe('fs.file');
  expect(MODULE_REGISTRIES.fs.getObjectExportType('open')).toBe(null);
});
test('40 fs registry isValidImport true for handles, functions, constants', () => {
  expect(MODULE_REGISTRIES.fs.isValidImport('stdin')).toBe(true);
  expect(MODULE_REGISTRIES.fs.isValidImport('open')).toBe(true);
  expect(MODULE_REGISTRIES.fs.isValidImport('ST_RDONLY')).toBe(true);
  expect(MODULE_REGISTRIES.fs.isValidImport('nope')).toBe(false);
});

// ── L. Real-world (unetacld) ─────────────────────────────────────────────────
test('41 the unetacld stdin pattern is clean', async () => {
  const code = `'use strict';\nimport { stdin } from "fs";\nlet line = trim(stdin.read("line"));\nlet fd = stdin.fileno();\n`;
  expect((await errs(code)).filter((m) => /stdin|fs module|UC3005/.test(m))).toEqual([]);
});
test('42 stdin inside a callback (uloop.handle pattern) resolves', async () => {
  const code = `'use strict';\nimport { stdin } from "fs";\nlet cb = () => { let line = trim(stdin.read("line")); print(line); };\n`;
  expect((await errs(code)).some((m) => /fs module|not exist on/.test(m))).toBe(false);
});

// ── M. No regressions to existing fs typing ──────────────────────────────────
test('43 fs.open() still returns an fs.file handle', async () => {
  expect(await hover(`import * as fs from "fs";\nlet f = fs.open("x");\nf.read("all");\n`, 1, 8)).toContain('fs.file');
});
test('44 a local fs.open() handle still resolves methods', async () => {
  expect(await errs(`import * as fs from "fs";\nlet f = fs.open("x");\nf.read("all"); f.close();\n`)).toEqual([]);
});
test('45 a socket namespace still rejects an invalid method (the guard stays precise)', async () => {
  expect((await errs(`import * as socket from "socket";\nsocket.totallyNotAMethod();\n`)).some((m) => /socket/.test(m))).toBe(true);
});
test('46 importing a real fs function alongside handles keeps both valid', async () => {
  expect(await errs(`import { readfile, stdin, ST_RDONLY } from "fs";\nlet c = readfile("/x");\nstdin.fileno();\nlet flag = ST_RDONLY;\n`)).toEqual([]);
});

// ── N. Inline namespace-chain completion (fs.stdin.) ─────────────────────────
test('47 fs.stdin. completes fs.file METHODS (not the fs module list)', async () => {
  const c = labels(await server.getCompletions(`import * as fs from "fs";\nfs.stdin.\n`, uri(), 1, 9));
  for (const m of ['read', 'write', 'fileno', 'close', 'seek']) expect(c).toContain(m);
});
test('48 fs.stdin. does NOT offer fs module functions (no open/readfile)', async () => {
  const c = labels(await server.getCompletions(`import * as fs from "fs";\nfs.stdin.\n`, uri(), 1, 9));
  expect(c).not.toContain('open');
  expect(c).not.toContain('readfile');
});
test('49 fs.stdout. and fs.stderr. complete fs.file methods', async () => {
  const out = labels(await server.getCompletions(`import * as fs from "fs";\nfs.stdout.\n`, uri(), 1, 10));
  expect(out).toContain('write');
  const err = labels(await server.getCompletions(`import * as fs from "fs";\nfs.stderr.\n`, uri(), 1, 10));
  expect(err).toContain('write');
});
test('50 bare `fs.` still completes the module list (functions + exports), unaffected', async () => {
  const c = labels(await server.getCompletions(`import * as fs from "fs";\nfs.\n`, uri(), 1, 3));
  expect(c).toContain('open');     // module function
  expect(c).toContain('stdin');    // object export
  expect(c).not.toContain('read'); // fs.file method must NOT leak into the module list
});
