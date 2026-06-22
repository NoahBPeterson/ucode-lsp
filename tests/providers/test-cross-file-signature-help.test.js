// Signature help — edge-case matrix.
// Factory-returned methods (cross-file & via named/default factories), rest params,
// zero params, active-parameter tracking, nested calls, and regressions for module
// methods / builtins / user functions.
const { test, expect, beforeAll, afterAll } = require('bun:test');
const path = require('path');
const fs = require('fs');
const { createLSPTestServer } = require('../lsp-test-helpers');

const ws = '/tmp/test-sig-matrix';

const FILES = {
  'sys.uc':
`export default function create_sys(fs, pkg) {
    return {
        exec: function(cmd, timeout) { return ""; },
        noargs: function() { return 1; },
        rest: function(first, ...args) { return first; },
    };
}
`,
  'widget.uc':
`export function make_widget(id) {
    return { draw: function(x, y) { return x; } };
}
`,
  'main.uc':
`import create_sys from './sys.uc';
import { make_widget } from './widget.uc';
import * as fs from 'fs';
let sh = create_sys(1, 2);
let w = make_widget(7);
let a = sh.exec();
let b = sh.noargs();
let c = sh.rest();
let d = w.draw();
let e = fs.open();
let f2 = substr("hello", 0, 2);
let g = create_sys();
let z = sh.bogus();
let p = sh.exec(11, 22);
let q = substr(create_sys(), 0);
`,
};

let server;
beforeAll(async () => {
  fs.mkdirSync(ws, { recursive: true });
  for (const [name, content] of Object.entries(FILES)) fs.writeFileSync(path.join(ws, name), content);
  server = createLSPTestServer({ workspaceRoot: ws });
  await server.initialize();
});
afterAll(() => { try { server.shutdown(); } catch {} try { fs.rmSync(ws, { recursive: true, force: true }); } catch {} });

// Signature help with the cursor at `charInLine` (a column on line `lineIdx`).
async function sigAt(file, lineIdx, charInLine) {
  const fp = path.join(ws, file);
  const sh = await server.getSignatureHelp(FILES[file], fp, lineIdx, charInLine);
  return {
    labels: sh && sh.signatures ? sh.signatures.map((s) => s.label) : [],
    activeParameter: sh ? sh.activeParameter : undefined,
    raw: sh,
  };
}
// Column just inside the parens following `marker` on a line.
function afterParen(file, lineIdx, marker) {
  const line = FILES[file].split('\n')[lineIdx];
  return line.indexOf(marker) + marker.length;
}

test('SG1: cross-file (default factory) method shows its params', async () => {
  const { labels } = await sigAt('main.uc', 5, afterParen('main.uc', 5, 'exec('));
  expect(labels).toContain('sh.exec(cmd, timeout)');
});

test('SG2: a method with zero params', async () => {
  const { labels } = await sigAt('main.uc', 6, afterParen('main.uc', 6, 'noargs('));
  expect(labels).toContain('sh.noargs()');
});

test('SG3: a rest parameter is rendered with ...', async () => {
  const { labels } = await sigAt('main.uc', 7, afterParen('main.uc', 7, 'rest('));
  expect(labels).toContain('sh.rest(first, ...args)');
});

test('SG4: cross-file NAMED factory method shows its params', async () => {
  const { labels } = await sigAt('main.uc', 8, afterParen('main.uc', 8, 'draw('));
  expect(labels).toContain('w.draw(x, y)');
});

test('SG5: module method still works (fs.open)', async () => {
  const { labels } = await sigAt('main.uc', 9, afterParen('main.uc', 9, 'open('));
  expect(labels.length).toBeGreaterThanOrEqual(1);
  expect(labels[0]).toContain('open');
});

test('SG6: a global builtin still works (substr)', async () => {
  const { labels } = await sigAt('main.uc', 10, afterParen('main.uc', 10, 'substr('));
  expect(labels.length).toBeGreaterThanOrEqual(1);
  expect(labels[0].toLowerCase()).toContain('substr');
});

test('SG7: a user function (the factory itself) shows its params', async () => {
  const { labels } = await sigAt('main.uc', 11, afterParen('main.uc', 11, 'create_sys('));
  expect(labels).toContain('create_sys(fs, pkg)');
});

test('SG8: a method that does not exist on the factory yields no signature', async () => {
  const { raw } = await sigAt('main.uc', 12, afterParen('main.uc', 12, 'bogus('));
  expect(!raw || !raw.signatures || raw.signatures.length === 0).toBe(true);
});

test('SG9: active parameter is 0 right after the open paren', async () => {
  const { activeParameter } = await sigAt('main.uc', 5, afterParen('main.uc', 5, 'exec('));
  expect(activeParameter).toBe(0);
});

test('SG10: active parameter advances to the second argument', async () => {
  // `let p = sh.exec(11, 22);` — cursor inside the `22`.
  const line = FILES['main.uc'].split('\n')[13];
  const { labels, activeParameter } = await sigAt('main.uc', 13, line.indexOf('22'));
  expect(labels).toContain('sh.exec(cmd, timeout)');
  expect(activeParameter).toBe(1);
});

test('SG11: nested call resolves the INNER callee', async () => {
  // `let q = substr(create_sys(), 0);` — cursor inside create_sys().
  const line = FILES['main.uc'].split('\n')[14];
  const { labels } = await sigAt('main.uc', 14, line.indexOf('create_sys()') + 'create_sys('.length);
  expect(labels).toContain('create_sys(fs, pkg)');
});

test('SG12: outer call resolves when cursor is in its (non-nested) argument', async () => {
  // same line, cursor after the `, ` before `0` — should be substr, active param 1.
  const line = FILES['main.uc'].split('\n')[14];
  const { labels } = await sigAt('main.uc', 14, line.lastIndexOf('0'));
  expect(labels.length).toBeGreaterThanOrEqual(1);
  expect(labels[0].toLowerCase()).toContain('substr');
});

test('SG13: no signature outside any call', async () => {
  const { raw } = await sigAt('main.uc', 3, 0); // start of `let sh = ...`
  expect(!raw || !raw.signatures || raw.signatures.length === 0).toBe(true);
});

test('SG14: the factory call itself (create_sys) tracks active param', async () => {
  // `let sh = create_sys(1, 2);` cursor in the `2`
  const line = FILES['main.uc'].split('\n')[3];
  const { activeParameter, labels } = await sigAt('main.uc', 3, line.lastIndexOf('2'));
  expect(labels).toContain('create_sys(fs, pkg)');
  expect(activeParameter).toBe(1);
});

// SG15: a SAME-FILE factory's returned method also shows signature help (0.6.153 —
// the local factory inference now records member definition locations, like the
// cross-file path).
test('SG15: same-file factory method shows its params', async () => {
  const fp = path.join(ws, 'samefile.uc');
  const content = `function make() { return { run: function(a, b, c) { return a; } }; }\nlet w = make();\nlet r = w.run();\n`;
  fs.writeFileSync(fp, content);
  const sh = await server.getSignatureHelp(content, fp, 2, content.split('\n')[2].indexOf('run(') + 4);
  const labels = sh && sh.signatures ? sh.signatures.map((s) => s.label) : [];
  fs.rmSync(fp, { force: true });
  expect(labels).toContain('w.run(a, b, c)');
});
