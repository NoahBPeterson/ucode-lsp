// Regression for docs/tc-require-user-module-typing.md — `require("<workspace
// module>")` previously only typed KNOWN BUILTIN modules; a user/workspace
// module resolved via the search-path machinery (bare/dotted names, `./`
// relative paths) stayed `unknown` at the declaration AND every member read.
// Covers: the firewall4 corpus idiom (`let fw4 = require("fw4")` from a
// SIBLING deploy root — depends on docs/tc-module-root-mapping.md), a plain
// relative require, a legacy module with NO `export` statements at all (just
// a bare top-level `return {...}` — verified against lib.c
// uc_require_library: require() returns whatever the compiled program
// top-level `return`s), a factory-function default export, a bare
// `name = require(...)` assignment (no `let`/`const`), and the "stays
// unknown, no new diagnostic" contract for an unresolvable module name used
// as a `try {}` feature probe.

import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
const path = require('path');
const fs = require('fs');
const { createLSPTestServer } = require('../lsp-test-helpers');

const base = '/tmp/test-require-user-module-typing';
const ws = path.join(base, 'ws');
const FILES = {
  // --- firewall4-style: bare name resolves under a SIBLING deploy root, and
  // the module is the "legacy" no-`export`-statements shape ---
  'fw4pkg/root/usr/share/ucode/fw4.uc':
    'return { read_state: function() { return { ok: true }; } };\n',

  // --- Plain relative require of a real ESM module (object default export) ---
  'rel_target.uc': 'export default { greet: function() { return "hi"; } };\n',

  // --- Factory-function default export ---
  'factory_target.uc':
    'export default function() { return { count: function() { return 1; } }; }\n',
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

const text = (h) => (!h || !h.contents) ? '' : (typeof h.contents === 'string' ? h.contents : (h.contents.value || ''));
function posOf(code, sub, occ = 1) {
  let i = -1;
  for (let k = 0; k < occ; k++) { i = code.indexOf(sub, i + 1); if (i === -1) throw new Error('not found: ' + sub); }
  const pre = code.slice(0, i);
  return { line: (pre.match(/\n/g) || []).length, character: i - (pre.lastIndexOf('\n') + 1) + 1 };
}
const diagsAt = (content, file) => server.getDiagnostics(content, path.join(ws, file));
const hoverAt = (content, file, sub, occ) => {
  const p = posOf(content, sub, occ);
  return server.getHover(content, path.join(ws, file), p.line, p.character);
};

describe('require() of a bare search-path name under a sibling deploy root (firewall4 shape)', () => {
  const MAIN = 'let fw4 = require("fw4");\nlet fwState = fw4.read_state();\n';
  const FILE = 'fw4pkg/root/usr/share/fw4pkg/main.uc';

  test('the required module resolves (no UC3002)', async () => {
    const d = await diagsAt(MAIN, FILE);
    expect(d.filter((x) => x.code === 'UC3002')).toEqual([]);
  });

  test('a member CALL on the required module is not unknown', async () => {
    const h = await hoverAt(MAIN, FILE, 'read_state');
    expect(text(h)).not.toContain('unknown');
  });

  test('the member read binds to an object shape (not unknown)', async () => {
    const h = await hoverAt(MAIN, FILE, 'fwState');
    expect(text(h)).not.toContain('unknown');
  });
});

describe('require() of a relative path with a real object default export', () => {
  const MAIN = 'let relMod = require("./rel_target.uc");\nlet salutation = relMod.greet();\n';

  test('the member function resolves as a function', async () => {
    const h = await hoverAt(MAIN, 'rel_main.uc', 'greet');
    expect(text(h)).toContain('function');
  });

  test('the call result is not unknown', async () => {
    const h = await hoverAt(MAIN, 'rel_main.uc', 'salutation');
    expect(text(h)).not.toContain('unknown');
  });
});

describe('require() of a factory-function default export', () => {
  // `require("mod")` itself yields the FACTORY FUNCTION (mirrors an ES6 default
  // import of a factory) — calling it separately is the supported shape.
  // `require("mod")()` (immediately-invoked in the same expression) is a
  // different, unverified-in-the-corpus idiom and is NOT covered here. Calling
  // a member FUNCTION of the factory's result (`inst.count()`'s own return
  // type, a third hop) is a separate, pre-existing inference-depth limitation
  // shared identically by the equivalent `import factory from '...'` path —
  // not attempted here.
  const MAIN = 'let factory = require("./factory_target.uc");\nlet inst = factory();\nlet method = inst.count;\n';

  test('the required factory itself types as a function', async () => {
    const h = await hoverAt(MAIN, 'factory_main.uc', 'factory');
    expect(text(h)).toContain('function');
  });

  test('the factory return shape carries through the call (inst: object)', async () => {
    const h = await hoverAt(MAIN, 'factory_main.uc', 'inst');
    expect(text(h)).toContain('object');
  });

  test('a method on the factory\'s return shape resolves as a function (not unknown)', async () => {
    const h = await hoverAt(MAIN, 'factory_main.uc', 'method');
    expect(text(h)).toContain('function');
  });
});

describe('bare `name = require(...)` assignment (no let/const)', () => {
  test('the bare-assigned module member is typed', async () => {
    // "rel_target" is a bare search-path name that resolves importer-relative
    // (rel_target.uc sits next to this file at the workspace root).
    const code = 'm4 = require("rel_target");\nlet greeting2 = m4.greet();\n';
    const h = await hoverAt(code, 'bare_assign_main.uc', 'greeting2');
    expect(text(h)).not.toContain('unknown');
  });
});

describe('unresolvable require() stays unknown with no new diagnostic (feature-probe contract)', () => {
  test('a workspace-absent module name does not gain a diagnostic', async () => {
    const code = 'let missing;\ntry { missing = require("totally_absent_module_xyz"); } catch (e) {}\n';
    const d = await diagsAt(code, 'probe_main.uc');
    // require() has no UC3002-equivalent check — an absent module must not
    // start erroring just because we now resolve SOME non-builtin names.
    expect(d.filter((x) => x.severity === 1)).toEqual([]);
  });
});
