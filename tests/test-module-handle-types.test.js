// Module handle/object types: socket, struct.instance, struct.buffer,
// zlib.deflate, zlib.inflate, rtnl.listener — their producing calls return a typed
// handle whose methods get hover + completion (the fs.file / ubus.connection pattern).
const { test, expect, beforeAll, afterAll } = require('bun:test');
const { createLSPTestServer } = require('./lsp-test-helpers');

let server;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const firstLine = (h) => (h && h.contents) ? (typeof h.contents === 'string' ? h.contents : h.contents.value || '').split('\n')[0] : '';

// Hover the token on a line; returns the first line of the hover.
async function hover(content, fp, lineIdx, token) {
  await server.getDiagnostics(content, fp);
  const line = content.split('\n')[lineIdx];
  return firstLine(await server.getHover(content, fp, lineIdx, line.indexOf(token)));
}
async function completionAt(content, fp, lineIdx, afterToken) {
  await server.getDiagnostics(content, fp);
  const line = content.split('\n')[lineIdx];
  const ch = line.indexOf(afterToken) + afterToken.length;
  const comp = await server.getCompletions(content, fp, lineIdx, ch);
  return (Array.isArray(comp) ? comp : (comp && comp.items) || []).map((c) => c.label);
}

test('socket handle: variable typed + method hover + completion', async () => {
  const c = `import * as socket from 'socket';\nlet sk = socket.create();\nlet n = sk.send("hi");\n`;
  const fp = '/tmp/h-socket.uc';
  expect(await hover(c, fp, 1, 'sk')).toContain('socket');
  expect(await hover(c, fp, 2, 'send')).toContain('socket.send');
  const names = await completionAt(c, fp, 2, 'sk.');
  for (const m of ['connect', 'send', 'recv', 'accept', 'close', 'listen']) expect(names).toContain(m);
});

test('struct.instance: struct.new() method hover', async () => {
  const c = `import * as struct from 'struct';\nlet st = struct.new("II");\nlet b = st.pack(1, 2);\n`;
  const fp = '/tmp/h-structi.uc';
  expect(await hover(c, fp, 1, 'st ')).toContain('struct.instance');
  expect(await hover(c, fp, 2, 'pack')).toContain('struct.instance.pack');
});

test('struct.buffer: struct.buffer() method hover', async () => {
  const c = `import * as struct from 'struct';\nlet b = struct.buffer();\nlet g = b.get("I");\n`;
  const fp = '/tmp/h-structb.uc';
  expect(await hover(c, fp, 1, 'b ')).toContain('struct.buffer');
  expect(await hover(c, fp, 2, 'get')).toContain('struct.buffer.get');
});

test('zlib.deflate: deflater() method hover + completion', async () => {
  const c = `import * as zlib from 'zlib';\nlet d = zlib.deflater();\nd.write("x");\n`;
  const fp = '/tmp/h-zlibd.uc';
  expect(await hover(c, fp, 1, 'd ')).toContain('zlib.deflate');
  expect(await hover(c, fp, 2, 'write')).toContain('zlib.deflate.write');
  const names = await completionAt(c, fp, 2, 'd.');
  for (const m of ['write', 'read', 'error']) expect(names).toContain(m);
});

test('zlib.inflate: inflater() method hover', async () => {
  const c = `import * as zlib from 'zlib';\nlet i = zlib.inflater();\nlet s = i.read();\n`;
  const fp = '/tmp/h-zlibi.uc';
  expect(await hover(c, fp, 1, 'i ')).toContain('zlib.inflate');
  expect(await hover(c, fp, 2, 'read')).toContain('zlib.inflate.read');
});

test('rtnl.listener: listener() method hover', async () => {
  const c = `import * as rtnl from 'rtnl';\nlet l = rtnl.listener(() => {});\nl.close();\n`;
  const fp = '/tmp/h-rtnl.uc';
  expect(await hover(c, fp, 1, 'l ')).toContain('rtnl.listener');
  expect(await hover(c, fp, 2, 'close')).toContain('rtnl.listener.close');
});
