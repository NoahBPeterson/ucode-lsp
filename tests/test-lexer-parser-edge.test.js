// E2e lexer/parser edge-case + error-recovery coverage, driven through the real
// LSP server (createLSPTestServer → spawned dist/server.js), so it exercises the
// lexer/parser code paths that count toward coverage:e2e.
//
// Targets previously-uncovered, REACHABLE branches: the lexer's stray-`/`
// diagnostics and scientific-notation/template-literal scanning, and the parser's
// export-all / re-export forms plus malformed import/export error recovery.
// (Template block syntax {{ }}/{% %}/{# #} is NOT covered here — the server lexes
// in rawMode, so those states are unreachable through it.)

import { test, expect, describe, beforeAll } from 'bun:test';
const { createLSPTestServer } = require('./lsp-test-helpers');

let getDiagnostics;
let n = 0;
const uniquePath = (tag) => `/tmp/edge-${tag}-${n++}.uc`;
const msgs = (diags) => (diags || []).map((d) => d.message);

beforeAll(async () => {
  const server = createLSPTestServer();
  await server.initialize();
  getDiagnostics = server.getDiagnostics;
});

describe('Lexer/parser edge cases (e2e)', () => {
  // ---- Valid-but-rarely-tested syntax: should NOT produce a parser "Expected" error ----
  const valid = [
    ['scientific notation', 'let a = 1e10; let b = 1.5e-3; let c = 2E+5; print(a, b, c);'],
    ['template literal w/ escapes + interpolation', 'let x = 1;\nlet s = `tab\\tnl\\n${x} end`;\nprint(s);'],
    ['template literal w/ all escape kinds', 'let s = `cr\\r bs\\\\ bt\\` dol\\$ unknown\\q`;\nprint(s);'],
    ['export * as name from', "export * as ns from './m.uc';"],
    ['export * from (bare)', "export * from './m.uc';"],
    ['re-export named with source', "export { a, b as c } from './m.uc';"],
    ['valid regex flags', 'let r = /foo/gis; print(r);'],
  ];

  for (const [label, code] of valid) {
    test(`valid: ${label} → no parser error`, async () => {
      const diags = await getDiagnostics(code, uniquePath('valid'));
      const parserErrors = msgs(diags).filter((m) => /^Expected\b/.test(m));
      expect(parserErrors).toEqual([]);
    });
  }

  // ---- Lexer stray-`/` recovery: should emit the comment hint ----
  const straySlash = [
    ['slash at end of line', 'let a = 5;\nb = /\n'],
    ['slash before block comment', 'x = / /* c */ 5;\n'],
    ['slash before keyword', '/ export\nlet x = 1;\n'],
    ['unterminated regex (line break)', 'let r = /foo\nprint(1);\n'],
  ];

  for (const [label, code] of straySlash) {
    test(`stray slash: ${label} → comment hint diagnostic`, async () => {
      const diags = await getDiagnostics(code, uniquePath('slash'));
      const hit = msgs(diags).some((m) => /Did you mean to use a comment|Unexpected token '\/'/.test(m));
      expect(hit).toBe(true);
    });
  }

  test('unsupported regex flag → flag error', async () => {
    const diags = await getDiagnostics('let r = /foo/x; print(r);', uniquePath('rxflag'));
    expect(msgs(diags).some((m) => /Unsupported regex flag/.test(m))).toBe(true);
  });

  // ---- Malformed import/export: should emit the matching parser error ----
  const malformed = [
    ["import * w/o as", "import * x from './m.uc';", /Expected 'as' after '\*'/],
    ["import w/o from", 'import { x };', /Expected 'from'/],
    ["import bad source", 'import { x } from 5;', /Expected string literal after 'from'/],
    ["export * w/o from", 'export * ns;', /Expected 'from' after export \*/],
    ["function w/o name", 'function() { return 1; }', /Expected function name/],
    ["mixed import * w/o as", "import a, * b from './m.uc';", /Expected 'as' after '\*'/],
    ["mixed import junk", "import a, 5 from './m.uc';", /Expected '\{' or '\*' after ','/],
    ["export junk", 'export 5;', /Expected declaration or export specifiers/],
    ["export * bad source", 'export * from 5;', /Expected string literal after 'from'/],
    ["re-export bad source", "export { x } from 5;", /Expected string literal after 'from'/],
  ];

  for (const [label, code, re] of malformed) {
    test(`malformed: ${label} → parser error`, async () => {
      const diags = await getDiagnostics(code, uniquePath('bad'));
      const hit = msgs(diags).some((m) => re.test(m));
      expect(hit).toBe(true);
    });
  }
});
