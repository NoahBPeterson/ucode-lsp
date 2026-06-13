const assert = require('assert');
const path = require('path');
const { createLSPTestServer } = require('./lsp-test-helpers');

// Two upstream syntax updates:
//   - `export function f() {}` no longer requires a trailing semicolon (552ca3c) —
//     the PARSER accepts it. It's valid only on ucode newer than 25.12, so the
//     default (latest-stable) target flags it UC6005 (see test-target-version-gating).
//   - `function f;` forward declarations (d9e24e4) — enable use-before-definition
//     and mutual recursion. A forward declaration never completed by a real
//     definition (and not exported) is flagged, since it would otherwise mask the
//     "undefined function" diagnostic.
describe('Function forward declarations + optional export semicolon', function() {
  this.timeout(15000);

  let getDiagnostics;

  before(async function() {
    const s = createLSPTestServer();
    await s.initialize();
    getDiagnostics = s.getDiagnostics;
  });

  const codes = (diags) => diags.map(d => d.code);

  it('`export function f() {}` without a semicolon PARSES (no syntax error)', async function() {
    const d = await getDiagnostics('export function f() { return 1; }\n', path.join(__dirname, '..', 'test-fd-exp.uc'));
    // The parser accepts it — no hard syntax/parse error (UC6001-UC6004) or
    // code-less diagnostic.
    assert.ok(!codes(d).some(c => c === undefined || /^UC600[1-4]$/.test(String(c))),
      `unexpected parse error: ${JSON.stringify(d.map(x => x.message))}`);
    // On the default target (latest stable, which predates the no-`;` feature) it's
    // a UC6005 portability warning; targeting `main` clears it (covered by
    // test-target-version-gating.test.js).
    assert.deepStrictEqual(codes(d), ['UC6005'], `expected only UC6005, got: ${JSON.stringify(d.map(x => x.message))}`);
  });

  it('forward declaration + later definition + call: no diagnostics', async function() {
    const d = await getDiagnostics('function f;\nfunction f() { return 1; }\nf();\n', path.join(__dirname, '..', 'test-fd-def.uc'));
    assert.deepStrictEqual(d, [], `expected clean, got: ${JSON.stringify(d.map(x => x.message))}`);
  });

  it('mutual recursion via forward declarations: no diagnostics', async function() {
    const code = [
      'function is_even;',
      'function is_odd;',
      'function is_even(n) { return n == 0 || is_odd(n - 1); }',
      'function is_odd(n) { return n != 0 && is_even(n - 1); }',
      'is_even(4);',
      ''
    ].join('\n');
    const d = await getDiagnostics(code, path.join(__dirname, '..', 'test-fd-mutual.uc'));
    assert.deepStrictEqual(d, [], `expected clean, got: ${JSON.stringify(d.map(x => x.message))}`);
  });

  it('forward declaration called but never defined (not exported) is flagged', async function() {
    const d = await getDiagnostics('function ghost;\nghost();\n', path.join(__dirname, '..', 'test-fd-orphan.uc'));
    assert.ok(codes(d).includes('forward-declaration-never-defined'),
      `expected forward-declaration-never-defined, got: ${JSON.stringify(codes(d))}`);
  });

  it('forward declaration that is exported is not flagged', async function() {
    const d = await getDiagnostics('function ghost;\nexport { ghost };\n', path.join(__dirname, '..', 'test-fd-exported.uc'));
    assert.ok(!codes(d).includes('forward-declaration-never-defined'),
      `exported forward decl should not warn, got: ${JSON.stringify(codes(d))}`);
  });
});
