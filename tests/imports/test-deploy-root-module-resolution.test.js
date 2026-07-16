// Regression for docs/tc-module-search-roots-deploy-layout.md and
// docs/tc-module-root-mapping.md — module resolution needs to reach a few
// deploy-layout shapes the pre-existing mirror-root walk (0.7.48,
// share/ucode|lib/ucode ancestors) didn't cover:
//
//  1. utest-style: a package `X` keeps its installed payload flattened under
//     `X/src/` (verified: utest.sh's UTEST_SRC=/usr/share/ucode + the package
//     Makefile install `src/*` there), with `X/src/X.uc` as the package's own
//     entry point — a same-package, existence-gated heuristic
//     (tc-module-search-roots-deploy-layout.md tier 1/2).
//  2. hostap-style: an ABSOLUTE import (`/usr/share/hostap/common.uc`) that
//     exists in the SAME package under a `files/`- or `root/`-named deploy
//     root (tier 1, sound: only ever returns a path that exists on disk).
//  3. firewall4-style: a bare/dotted search-path name (`require("fw4")` /
//     `import fw4 from 'fw4'`) whose install root
//     (`<deployRoot>/usr/share/ucode/`) is a SIBLING of the importer, not an
//     ancestor (docs/tc-module-root-mapping.md).
//  4. Cross-package deploy-time siblings (two DIFFERENT packages that each
//     install into the same runtime directory, e.g. both `/lib/netifd/`) are
//     DELIBERATELY NOT resolved — genuinely ambiguous without a workspace-wide
//     deploy-path index; documented as out of scope (tier 3, "partially
//     solvable") rather than guessed at.

import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
const path = require('path');
const fs = require('fs');
const { createLSPTestServer } = require('../lsp-test-helpers');

const base = '/tmp/test-deploy-root-resolution';
const ws = path.join(base, 'ws');
const FILES = {
  // --- Shape 1: utest-style "X/src/X.uc" package-src mirror ---
  'utestlike/src/utestlike.uc': "export const helper = function() { return 1; };\n",
  'utestlike/src/utestlike/inner.uc': "export function deep() { return 2; }\n",
  'utestlike/examples/unit/.keep': '',

  // --- Shape 2: hostap-style files/ deploy root + absolute import ---
  'wifipkg/files/usr/share/hostap/common.uc': 'export function is_equal(a, b) { return a == b; }\n',
  'wifipkg/files/usr/share/hostap/consumer.uc': '.keep',

  // --- Shape 3: firewall4-style root/ deploy root, sibling usr/share/ucode ---
  'fw4like/root/usr/share/ucode/fw4.uc': 'return { read_state: function() { return { ok: true }; } };\n',
  'fw4like/root/usr/share/fw4like/.keep': '',

  // --- Cross-package sibling (deliberately unresolved) ---
  'pkgA/files/lib/netifd/utils.uc': 'export function is_equal(a, b) { return a == b; }\n',
  'pkgB/files/lib/netifd/consumer.uc': '.keep',
};

let server;
beforeAll(async () => {
  for (const [name, content] of Object.entries(FILES)) {
    const p = path.join(ws, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content === '.keep' ? '' : content);
  }
  server = createLSPTestServer({ workspaceRoot: ws });
  await server.initialize();
});
afterAll(() => { try { server.shutdown(); } catch {} try { fs.rmSync(base, { recursive: true, force: true }); } catch {} });

const diagsAt = (content, file) => server.getDiagnostics(content, path.join(ws, file));
const moduleNotFound = (d) => d.filter((x) => x.code === 'UC3002');

// The zero-config "X/src/X.uc" package-src-mirror auto-detection (`packageSrcMirror`)
// was REMOVED pending re-review: it invents a search root with no ucode analog and,
// for a package that installs src/ namespaced rather than flat, would resolve the wrong
// file and suppress a real UC3002 (docs/tc-module-search-roots-deploy-layout.md). What
// REMAINS is ordinary importer-relative resolution; only the cross-directory bare-name
// jump (examples/ → src) went away with the mirror.
describe('package src-mirror convention removed; importer-relative still works', () => {
  test('a utest-style X/src bare import from a SIBLING examples/ dir is now unresolved', async () => {
    // This was the packageSrcMirror-only case: nothing on disk connects
    // examples/unit/ to src/ without the invented root, so UC3002 now (correctly) fires.
    const d = await diagsAt(
      'import { helper } from "utestlike";\nhelper();\n',
      'utestlike/examples/unit/app_test.uc'
    );
    expect(moduleNotFound(d).length).toBe(1);
  });

  test('a dotted import from INSIDE the src tree still resolves (importer-relative, not the mirror)', async () => {
    const d = await diagsAt(
      'import { deep } from "utestlike.inner";\ndeep();\n',
      'utestlike/src/utestlike/sibling.uc'
    );
    expect(moduleNotFound(d)).toEqual([]);
  });

  test('a package with no src/<name>.uc marker is NOT treated as a search root', async () => {
    const d = await diagsAt(
      'import { nope } from "wifipkg";\nnope();\n',
      'wifipkg/files/usr/share/hostap/other.uc'
    );
    expect(moduleNotFound(d).length).toBe(1);
  });
});

describe('files/-deploy-root mapping for absolute imports (hostap-style)', () => {
  test('an absolute deploy path resolves under the same package\'s files/ root', async () => {
    const d = await diagsAt(
      'import { is_equal } from "/usr/share/hostap/common.uc";\nis_equal(1, 1);\n',
      'wifipkg/files/usr/share/hostap/consumer.uc'
    );
    expect(moduleNotFound(d)).toEqual([]);
  });
});

describe('root/-deploy-root mapping for bare/dotted names (firewall4-style)', () => {
  test('a bare search-path name resolves under the sibling deploy root\'s usr/share/ucode', async () => {
    // require(), matching the real firewall4 main.uc idiom (fw4.uc has no `export`
    // statements at all — a bare top-level `return {...}` — so an ES6 `import`
    // would separately hit the pre-existing "does not have a default export"
    // check; that's a distinct, out-of-scope gap from resolution itself).
    const d = await diagsAt(
      'let fw4 = require("fw4");\nfw4.read_state();\n',
      'fw4like/root/usr/share/fw4like/main.uc'
    );
    expect(moduleNotFound(d)).toEqual([]);
  });
});

describe('cross-package deploy-time siblings stay unresolved (deliberately out of scope)', () => {
  test('a relative import between two DIFFERENT packages\' deploy roots is not guessed at', async () => {
    const d = await diagsAt(
      'import { is_equal } from "./utils.uc";\nis_equal(1, 1);\n',
      'pkgB/files/lib/netifd/consumer.uc'
    );
    expect(moduleNotFound(d).length).toBe(1);
  });
});
