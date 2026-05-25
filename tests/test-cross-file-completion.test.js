// E2e member completion across imported files (real temp modules so imports
// resolve). Covers: a named-imported object VALUE completing its own properties
// (not the module's exports), aliased, and the namespace-import regression.

import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLSPTestServer } = require('./lsp-test-helpers');

let getCompletions, dir;
const labelsOf = (c) => (Array.isArray(c) ? c : (c && c.items) || []).map((i) => i.label).sort();

beforeAll(async () => {
  const server = createLSPTestServer();
  await server.initialize();
  getCompletions = server.getCompletions;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xfc-'));
  fs.writeFileSync(path.join(dir, 'lib.uc'),
    'export let CONF = { host: "h", port: 80 };\n' +
    'export function create() { return 1; }\n' +
    'export function make() { return { x: 1, y: "s" }; }\n' +
    'function buildLocal() { return { aa: 1, bb: 2 }; }\n' +
    'export { buildLocal };\n' +
    'export default function build() { return { alpha: 1, beta: 2 }; }\n');
});
afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} });

const run = (code, line, ch) => {
  const main = path.join(dir, 'main_' + Math.random().toString(36).slice(2) + '.uc');
  fs.writeFileSync(main, code);
  return getCompletions(code, main, line, ch);
};

describe('Cross-file member completion (e2e)', () => {
  test('named-imported object value completes its OWN properties', async () => {
    const labels = labelsOf(await run("import { CONF } from './lib.uc';\nCONF.\n", 1, 5));
    expect(labels).toEqual(['host', 'port']);
  });

  test('aliased named import resolves via the original export name', async () => {
    const labels = labelsOf(await run("import { CONF as c } from './lib.uc';\nc.\n", 1, 2));
    expect(labels).toEqual(['host', 'port']);
  });

  test('namespace import still completes the MODULE exports (regression)', async () => {
    const labels = labelsOf(await run("import * as L from './lib.uc';\nL.\n", 1, 2));
    expect(labels).toContain('CONF');
    expect(labels).toContain('create');
  });

  test('default-export factory return object completes (already worked)', async () => {
    const labels = labelsOf(await run("import build from './lib.uc';\nlet o = build();\no.\n", 2, 2));
    expect(labels).toEqual(['alpha', 'beta']);
  });

  test('named-export factory return object completes', async () => {
    const labels = labelsOf(await run("import { make } from './lib.uc';\nlet o = make();\no.\n", 2, 2));
    expect(labels).toEqual(['x', 'y']);
  });

  test('aliased named-export factory return object completes', async () => {
    const labels = labelsOf(await run("import { make as mk } from './lib.uc';\nlet o = mk();\no.\n", 2, 2));
    expect(labels).toEqual(['x', 'y']);
  });

  test('named factory via export { } specifier completes', async () => {
    const labels = labelsOf(await run("import { buildLocal } from './lib.uc';\nlet o = buildLocal();\no.\n", 2, 2));
    expect(labels).toEqual(['aa', 'bb']);
  });

  test('named non-object factory does not fabricate properties', async () => {
    // create() returns a number — o. should NOT offer object properties
    const labels = labelsOf(await run("import { create } from './lib.uc';\nlet o = create();\no.\n", 2, 2));
    expect(labels).not.toContain('x');
    expect(labels).not.toContain('alpha');
  });
});
