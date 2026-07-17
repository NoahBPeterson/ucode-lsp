// Adversarial edge cases for the deploy-layout module resolver (fileResolver.ts) — the
// soundness boundary of the "files/ + root/ deploy-root mirror" convention
// (docs/tc-module-search-roots-deploy-layout.md, tc-module-root-mapping.md).
//
// The resolver maps an OpenWrt package's payload subtree (a dir whose basename is exactly
// `files` or `root`) to the installed filesystem root, so an absolute import written against the
// DEPLOYED path resolves inside the same package's source tree. This suite pins the failure modes:
// it must NOT treat look-alike directories as deploy roots, must NOT resolve a missing target,
// must NOT resolve to a DIRECTORY, and must find the correct (nearest existing) level when nested.
//
// Resolution signal: an unresolved ABSOLUTE import emits UC3002 (module-not-found); a resolved one
// does not. Verified against the real resolver via direct instrumentation while authoring.

import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
const path = require('path');
const fs = require('fs');
const { createLSPTestServer } = require('../lsp-test-helpers');

const base = '/tmp/test-deploy-root-edge';
const ws = path.join(base, 'ws');
const FILES = {
  // look-alike dirs whose basename is NOT exactly files/root
  'myfiles/usr/share/hostap/common.uc': 'export function eq(a, b) { return a == b; }\n',
  'myfiles/usr/share/hostap/consumer.uc': '',
  'rootfs/usr/share/hostap/common.uc': 'export function eq(a, b) { return a == b; }\n',
  'rootfs/usr/share/hostap/consumer.uc': '',
  // a genuine files/ deploy root (control + missing-target + directory-target)
  'pkg/files/usr/share/hostap/common.uc': 'export function eq(a, b) { return a == b; }\n',
  'pkg/files/usr/share/hostap/consumer.uc': '',
  'pkg/files/usr/share/hostap/subdir/keep.uc': 'export const k = 1;\n', // subdir/ is a DIRECTORY
  // nested files/: importer under the INNER files, target only under the OUTER files
  'nest/files/usr/share/x/lib.uc': 'export const v = 1;\n',
  'nest/files/deep/files/usr/share/x/consumer.uc': '',
  // a plain package with NO deploy root anywhere on the path
  'plain/src/mod/consumer.uc': '',
};

let server;
beforeAll(async () => {
  for (const [name, content] of Object.entries(FILES)) {
    const p = path.join(ws, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  server = createLSPTestServer({ workspaceRoot: ws });
  await server.initialize();
});
afterAll(() => { try { server.shutdown(); } catch {} try { fs.rmSync(base, { recursive: true, force: true }); } catch {} });

const notFound = async (content, file) =>
  ((await server.getDiagnostics(content, path.join(ws, file))) || []).filter((x) => x.code === 'UC3002').length;

const ABS = 'import { eq } from "/usr/share/hostap/common.uc";\neq(1, 1);\n';

describe('deploy-root basename must be EXACTLY files/ or root/ (no substring match)', () => {
  test('a dir named "myfiles" is NOT a deploy root → unresolved', async () => {
    expect(await notFound(ABS, 'myfiles/usr/share/hostap/consumer.uc')).toBe(1);
  });
  test('a dir named "rootfs" is NOT a deploy root → unresolved', async () => {
    expect(await notFound(ABS, 'rootfs/usr/share/hostap/consumer.uc')).toBe(1);
  });
});

describe('a genuine files/ deploy root', () => {
  test('control: an existing target resolves (no UC3002)', async () => {
    expect(await notFound(ABS, 'pkg/files/usr/share/hostap/consumer.uc')).toBe(0);
  });
  test('a MISSING target stays unresolved (no false resolution)', async () => {
    expect(await notFound('import { eq } from "/usr/share/hostap/missing.uc";\neq(1,1);\n', 'pkg/files/usr/share/hostap/consumer.uc')).toBe(1);
  });
  test('an import that maps to a DIRECTORY does NOT resolve (isFile guard)', async () => {
    // /usr/share/hostap/subdir maps to pkg/files/usr/share/hostap/subdir/ — a directory.
    // Before the isFile guard this wrongly resolved to the directory and suppressed UC3002.
    expect(await notFound('import { k } from "/usr/share/hostap/subdir";\nk;\n', 'pkg/files/usr/share/hostap/consumer.uc')).toBe(1);
  });
});

describe('nested and absent deploy roots', () => {
  test('nested files/: target present under the outer files/ still resolves', async () => {
    expect(await notFound('import { v } from "/usr/share/x/lib.uc";\nv;\n', 'nest/files/deep/files/usr/share/x/consumer.uc')).toBe(0);
  });
  test('no files//root/ ancestor anywhere → absolute import is unresolved', async () => {
    expect(await notFound(ABS, 'plain/src/mod/consumer.uc')).toBe(1);
  });
});
