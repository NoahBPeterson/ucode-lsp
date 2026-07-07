// uci `get_all` returns a section shape (ucode lib/uci.c: section_to_uval / package_to_uval)
// and `changes` returns a documented per-config array-of-change-records object
// (changes_to_uval / change_to_uval). This suite exercises the `uci.section` object type
// (open-membered, with the dotted meta keys) and the documented return shapes, plus the
// batch-L2 audit fixes to `math.rand` (integer | double) and `socket.getopt` (adds boolean).
const { test, expect, beforeAll, afterAll } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');
const { OBJECT_REGISTRIES } = require('../../src/analysis/moduleDispatch');
const { uciSectionObjectType } = require('../../src/analysis/uciTypes');

let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });
const uri = () => `/tmp/ucisec-${n++}.uc`;

const errs = async (code) => (await server.getDiagnostics(code, uri()) || []).filter((x) => x.severity === 1).map((x) => x.message);
const codes = async (code) => (await server.getDiagnostics(code, uri()) || []).filter((x) => x.severity === 1).map((x) => x.code);
const hover = async (code, l, c) => {
  const h = await server.getHover(code, uri(), l, c);
  const v = h && h.contents && (h.contents.value || h.contents);
  return (typeof v === 'string' ? v : JSON.stringify(v || '')).replace(/\n/g, ' ');
};
const labels = (cmp) => (Array.isArray(cmp) ? cmp : (cmp && cmp.items) || []).map((i) => i.label);

// ── A. Registry: uci.section is registered, open-membered, with the C meta keys ──────
test('01 uci.section is a registered object type', () => {
  expect(OBJECT_REGISTRIES['uci.section']).toBeDefined();
});
test('02 uci.section is open-membered (option values resolve unknown, not UC5004)', () => {
  expect(OBJECT_REGISTRIES['uci.section'].openMembers).toBe(true);
});
test('03 uci.section exposes the C meta keys .anonymous/.type/.name/.index', () => {
  const names = OBJECT_REGISTRIES['uci.section'].getMethodNames();
  expect(names).toEqual(['.anonymous', '.type', '.name', '.index']);
});
test('04 meta-key types match section_to_uval (bool/string/string/integer)', () => {
  const reg = OBJECT_REGISTRIES['uci.section'];
  const get = (k) => reg.getMethod(k).value.returnType;
  expect(get('.anonymous')).toBe('boolean');
  expect(get('.type')).toBe('string');
  expect(get('.name')).toBe('string');
  expect(get('.index')).toBe('integer');
});
test('05 the object type is property-based', () => {
  expect(uciSectionObjectType.isPropertyBased).toBe(true);
});

// ── B. get_all return type flows to the call result ──────────────────────────────────
test('06 get_all(config, section) result hovers as uci.section | object | null', async () => {
  const code = `import { cursor } from 'uci';\nlet c = cursor();\nlet sec = c.get_all('network', 'lan');\n`;
  expect(await hover(code, 2, 4)).toContain('uci.section');
});
test('07 get_all method hover documents the section shape', async () => {
  const code = `import { cursor } from 'uci';\nlet c = cursor();\nc.get_all('network', 'lan');\n`;
  const h = await hover(code, 2, 3);
  expect(h).toContain('uci.section');
  expect(h).toContain('.type');
});

// ── C. Open membership: option access does NOT false-positive ─────────────────────────
test('08 option member access on a section is clean (no UC5004)', async () => {
  const code = `import { cursor } from 'uci';\nlet sec = cursor().get_all('network', 'lan');\nlet p = sec.proto;\n`;
  expect(await codes(code)).not.toContain('UC5004');
});
test('09 computed meta-key access sec[".type"] is clean', async () => {
  const code = `import { cursor } from 'uci';\nlet sec = cursor().get_all('network', 'lan');\nlet t = sec['.type'];\n`;
  expect(await errs(code)).toEqual([]);
});
test('10 completion after `sec.` offers the meta keys', async () => {
  const code = `import { cursor } from 'uci';\nlet sec = cursor().get_all('n', 'l');\nsec.\n`;
  const l = labels(await server.getCompletions(code, uri(), 2, 4));
  expect(l).toContain('.type');
  expect(l).toContain('.name');
});

// ── D. changes() documented shape ─────────────────────────────────────────────────────
test('11 changes() hover documents the record shape', async () => {
  const code = `import { cursor } from 'uci';\ncursor().changes();\n`;
  const h = await hover(code, 1, 10);
  expect(h).toContain('change records');
  expect(h).toContain('list-add');
});
test('12 changes() still types as object | null (no unsound narrowing)', async () => {
  const code = `import { cursor } from 'uci';\ncursor().changes();\n`;
  expect(await hover(code, 1, 10)).toContain('object | null');
});

// ── E. Audit remainders: math.rand and socket.getopt honest unions ────────────────────
test('13 math.rand() hovers as integer | double (0 args integer, args double)', async () => {
  const code = `import * as math from 'math';\nlet r = math.rand();\n`;
  expect(await hover(code, 1, 13)).toContain('integer | double');
});
test('14 math.rand() call is clean', async () => {
  expect(await errs(`import * as math from 'math';\nlet r = math.rand(1, 10);\n`)).toEqual([]);
});
test('15 socket.getopt() hover includes boolean in the union', async () => {
  const code = `import * as socket from 'socket';\nlet s = socket.create(socket.AF_INET, socket.SOCK_STREAM, 0);\nlet v = s.getopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE);\n`;
  const h = await hover(code, 2, 12);
  expect(h).toContain('integer | boolean | string | object | null');
});
