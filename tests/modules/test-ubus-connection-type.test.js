// ubus.connection object type: connect() returns a typed connection handle whose
// methods (call/list/defer/disconnect/…) get hover, signature help, and completion
// — mirroring the fs.file pattern.
const { test, expect, beforeAll, afterAll } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');

const fp = '/tmp/test-ubus-conn.uc';
const SRC = `import { connect } from 'ubus';
const conn = connect();
const st = conn.call('network.wireless', 'status');
let names = conn.list();
conn.disconnect();
`;
const lines = SRC.split('\n');

let server;
beforeAll(async () => {
  server = createLSPTestServer();
  await server.initialize();
  await server.getDiagnostics(SRC, fp);
});
afterAll(() => { try { server.shutdown(); } catch {} });

const firstLine = (h) => (h && h.contents) ? (typeof h.contents === 'string' ? h.contents : h.contents.value || '').split('\n')[0] : '';

test('connect() result is typed ubus.connection (not a bare object)', async () => {
  const h = await server.getHover(SRC, fp, 1, lines[1].indexOf('conn'));
  expect(firstLine(h)).toContain('ubus.connection');
});

test('a connection method shows hover documentation', async () => {
  const h = await server.getHover(SRC, fp, 2, lines[2].indexOf('call'));
  expect(firstLine(h)).toContain('ubus.connection.call');
});

test('signature help on conn.call lists its parameters', async () => {
  const sh = await server.getSignatureHelp(SRC, fp, 2, lines[2].indexOf('call(') + 5);
  const labels = sh && sh.signatures ? sh.signatures.map((s) => s.label) : [];
  expect(labels).toContain('conn.call(object, method, data?, return_mode?, fd?, fd_cb?)');
});

test('completion on conn. offers the connection methods', async () => {
  const comp = await server.getCompletions(SRC, fp, 2, lines[2].indexOf('conn.') + 5);
  const names = (Array.isArray(comp) ? comp : (comp && comp.items) || []).map((c) => c.label);
  for (const m of ['call', 'list', 'defer', 'publish', 'subscriber', 'listener', 'event', 'error', 'disconnect']) {
    expect(names).toContain(m);
  }
});

test('hover on a connection method that returns null-able works (list)', async () => {
  const h = await server.getHover(SRC, fp, 3, lines[3].indexOf('list'));
  expect(firstLine(h)).toContain('ubus.connection.list');
});

// Secondary ubus handles: conn.defer/publish/subscriber/listener and
// open_channel return typed handles whose methods resolve (multi-hop chaining).
const SRC2 = `import * as ubus from 'ubus';
let conn = ubus.connect();
let d = conn.defer("o", "m");
let r = d.await();
let o = conn.publish("x");
let n = o.notify("t");
let sub = conn.subscriber();
let ch = ubus.open_channel(3);
let rq = ch.request("m");
`;
const fp2 = '/tmp/test-ubus-conn2.uc';
const l2 = SRC2.split('\n');
async function hoverIn(src, file, lineIdx, token) {
  await server.getDiagnostics(src, file);
  const h = await server.getHover(src, file, lineIdx, src.split('\n')[lineIdx].indexOf(token));
  return firstLine(h);
}

test('conn.defer() returns a typed ubus.deferred handle', async () => {
  expect(await hoverIn(SRC2, fp2, 2, 'd ')).toContain('ubus.deferred');
  expect(await hoverIn(SRC2, fp2, 3, 'await')).toContain('ubus.deferred.await');
});

test('conn.publish() returns ubus.object; object.notify() returns ubus.notify', async () => {
  expect(await hoverIn(SRC2, fp2, 4, 'o ')).toContain('ubus.object');
  expect(await hoverIn(SRC2, fp2, 5, 'notify')).toContain('ubus.object.notify');
});

test('conn.subscriber() returns a typed ubus.subscriber handle', async () => {
  expect(await hoverIn(SRC2, fp2, 6, 'sub')).toContain('ubus.subscriber');
});

test('open_channel() returns ubus.channel; channel.request() returns ubus.request', async () => {
  expect(await hoverIn(SRC2, fp2, 7, 'ch ')).toContain('ubus.channel');
  expect(await hoverIn(SRC2, fp2, 8, 'request')).toContain('ubus.channel.request');
});
