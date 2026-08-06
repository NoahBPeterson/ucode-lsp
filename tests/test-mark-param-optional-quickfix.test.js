// UC2003 too-few-args quick fix: rewrite the CALLEE's `@param {T} name` into the
// optional form `@param {T} [name]` — the exact reconciliation the diagnostic message
// describes (real-world shape: luci-app-podman's podman_request(method, path, body, raw)
// called as podman_request('GET', path) ~40×; one edit clears them all).
const { test, expect, describe, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('./lsp-test-helpers');
setDefaultTimeout(30000);

let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const SRC = [
  '/**',
  ' * @param {string} method',
  ' * @param {string} path',
  ' * @param {string} body',
  ' */',
  'function request(method, path, body) {',
  '\treturn [ method, path, body ];',
  '}',
  "request('GET', '/x');",
  '',
].join('\n');

async function fixFor(code, uri) {
  const ds = (await server.getDiagnostics(code, uri)) || [];
  const d = ds.find((x) => x.code === 'UC2003' && /declare it optional/.test(x.message));
  if (!d) return { d: null, acts: [] };
  const acts = (await server.getCodeActions(uri, [d], d.range.start.line, d.range.start.character)) || [];
  return { d, acts };
}

describe('mark-@param-optional quick fix', () => {
  test('offers the fix and the edit brackets exactly the param name in the JSDoc', async () => {
    const uri = `/tmp/mpo-${n++}.uc`;
    const { d, acts } = await fixFor(SRC, uri);
    expect(d).toBeTruthy();
    const act = acts.find((a) => /Mark 'body' optional/.test(a.title));
    expect(act).toBeTruthy();
    const edits = act.edit.changes[Object.keys(act.edit.changes)[0]];
    expect(edits.length).toBe(1);
    // The edit targets line 3 (` * @param {string} body`), replacing `body` → `[body]`.
    expect(edits[0].range.start.line).toBe(3);
    expect(edits[0].newText).toBe('[body]');
    // Applying it yields the optional form — and re-analysis is clean of UC2003.
    const lines = SRC.split('\n');
    lines[3] = ' * @param {string} [body]';
    const fixedDs = (await server.getDiagnostics(lines.join('\n'), `/tmp/mpo-${n++}.uc`)) || [];
    expect(fixedDs.filter((x) => x.code === 'UC2003')).toEqual([]);
  });

  test('no fix for an IMPORTED callee (its JSDoc lives in another file)', async () => {
    const fs = require('fs');
    fs.writeFileSync('/tmp/mpo-dep.uc',
      '/**\n * @param {string} a\n * @param {string} b\n */\nexport function two(a, b) { return [a, b]; };\n');
    const code = "import { two } from './mpo-dep.uc';\ntwo('x');\n";
    const uri = `/tmp/mpo-${n++}.uc`;
    const { d, acts } = await fixFor(code, uri);
    expect(d).toBeTruthy(); // the diagnostic still fires…
    expect(acts.find((a) => /Mark 'b' optional/.test(a.title))).toBeUndefined(); // …but no cross-file edit
  });
});
