// Add-JSDoc usage inference (Source 7): a parameter passed to a MEMBER call
// `recv.method(arg)` — where recv is a module namespace or an object handle — is
// suggested as the method's declared parameter type. Suggestion-only: the param's
// hover stays `unknown` (we never ASSUME a type from how it's used in the body).
const { test, expect, beforeAll, afterAll } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');

let server;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

// Text the Add-JSDoc quick fix would insert for the (strict-mode) function.
async function addJsDoc(content, tag) {
  const fp = `/tmp/mcpi-${tag}.uc`;
  const d = await server.getDiagnostics(content, fp);
  const jd = (d || []).find((x) => x.code === 'UC7003');
  if (!jd) return 'no-trigger';
  const acts = await server.getCodeActions(fp, [jd], jd.range.start.line, jd.range.start.character);
  const fix = (acts || []).find((a) => /JSDoc/i.test(a.title));
  return fix ? Object.values(fix.edit.changes)[0][0].newText : 'no-jsdoc';
}
const firstLine = (h) => (h && h.contents) ? (typeof h.contents === 'string' ? h.contents : h.contents.value || '').split('\n')[0] : '';

test('object-handle method: inst.unpack(mac) suggests string', async () => {
  const c = `'use strict';\nimport * as struct from 'struct';\nlet st = struct.new("6B");\nfunction f(mac) { return st.unpack(mac); }\n`;
  expect(await addJsDoc(c, 'inst')).toContain('@param {string} mac');
});

test('module-member call: struct.unpack(fmt, mac) suggests string at arg position 1', async () => {
  const c = `'use strict';\nimport * as struct from 'struct';\nfunction g(mac) { return struct.unpack("6B", mac); }\n`;
  expect(await addJsDoc(c, 'mod')).toContain('@param {string} mac');
});

test('another object handle: socket.send(data) suggests string', async () => {
  const c = `'use strict';\nimport * as socket from 'socket';\nlet sk = socket.create();\nfunction f(d) { return sk.send(d); }\n`;
  expect(await addJsDoc(c, 'sock')).toContain('@param {string} d');
});

test('nullable receiver (struct.instance | null) still resolves the method', async () => {
  // st is `struct.instance | null` — extractModuleType handles the union.
  const c = `'use strict';\nimport * as struct from 'struct';\nlet st = struct.new("6B");\nfunction f(mac) { return st.pack(mac); }\n`;
  // struct.instance.pack(values: any) is loosely typed -> stays unknown (control below);
  // use unpack which is string-typed for the positive assertion:
  const c2 = `'use strict';\nimport * as struct from 'struct';\nlet st = struct.new("6B");\nfunction f(mac) { return st.unpack(mac); }\n`;
  expect(await addJsDoc(c2, 'nullable')).toContain('@param {string} mac');
});

test('a loosely-typed (any) param is NOT constrained (fs.file.write)', async () => {
  const c = `'use strict';\nimport * as fs from 'fs';\nlet fh = fs.open("/x", "w");\nfunction h(d) { return fh.write(d); }\n`;
  expect(await addJsDoc(c, 'any')).toContain('@param {unknown} d');
});

test('an unresolvable receiver yields no constraint', async () => {
  const c = `'use strict';\nfunction f(x) { let r = mystery(); return r.frobnicate(x); }\n`;
  expect(await addJsDoc(c, 'unres')).toContain('@param {unknown} x');
});

test('a method not in the registry yields no constraint', async () => {
  const c = `'use strict';\nimport * as struct from 'struct';\nlet st = struct.new("6B");\nfunction f(x) { return st.nonexistentMethod(x); }\n`;
  expect(await addJsDoc(c, 'nomethod')).toContain('@param {unknown} x');
});

test('a computed member call obj["unpack"](x) is not handled', async () => {
  const c = `'use strict';\nimport * as struct from 'struct';\nlet st = struct.new("6B");\nfunction f(x) { return st["unpack"](x); }\n`;
  expect(await addJsDoc(c, 'computed')).toContain('@param {unknown} x');
});

test('suggestion-only: the param hover stays unknown (no assumed type)', async () => {
  const c = `import * as struct from 'struct';\nlet st = struct.new("6B");\nfunction f(mac) { return st.unpack(mac); }\n`;
  const fp = '/tmp/mcpi-hover.uc';
  await server.getDiagnostics(c, fp);
  const h = await server.getHover(c, fp, 2, c.split('\n')[2].indexOf('(mac') + 1);
  expect(firstLine(h)).toContain('unknown');
});

test('an explicit @param annotation still wins over the suggestion', async () => {
  const c = `'use strict';\nimport * as struct from 'struct';\nlet st = struct.new("6B");\n/**\n * @param {object} mac\n */\nfunction f(mac) { return st.unpack(mac); }\n`;
  const fp = '/tmp/mcpi-annot.uc';
  await server.getDiagnostics(c, fp);
  const h = await server.getHover(c, fp, 6, c.split('\n')[6].indexOf('(mac') + 1);
  expect(firstLine(h)).toContain('object');
});
