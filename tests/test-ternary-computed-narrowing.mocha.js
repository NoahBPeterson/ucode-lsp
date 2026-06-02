const assert = require('assert');
const { createLSPTestServer } = require('./lsp-test-helpers');

// Truthiness narrowing must work (a) in a TERNARY (`cond ? a : b`), not just an
// if-statement, and (b) for a CONSTANT-index computed member access
// (`parts[5]`, `obj["k"]`), not just identifiers and dotted paths. The repro:
// `const m = parts[5] ? uc(parts[5]) : null;` where parts is array<string>|null —
// inside the consequent parts[5] is non-null, so uc() must NOT warn.
describe('Ternary + computed-member truthiness narrowing', function () {
  this.timeout(15000);
  let lspServer, getDiagnostics;
  const FP = '/tmp/tern-narrow.uc';
  // `v`/`parts[n]` are string|null (split() → array<string>|null, then element access).
  const nullableArg = async (code) =>
    (await getDiagnostics(code, FP)).filter(d => /possibly 'null'|nullable/i.test(d.message || ''));
  const PRE = `function f(line) {\n  let parts = split(line, ',');\n  let v = parts[5];\n`;

  before(async function () { lspServer = createLSPTestServer(); await lspServer.initialize(); getDiagnostics = lspServer.getDiagnostics; });
  after(function () { if (lspServer) lspServer.shutdown(); });

  it('narrows a computed member in a ternary (the repro)', async () => {
    assert.strictEqual((await nullableArg(`${PRE}  let m = parts[5] ? uc(parts[5]) : null;\n}`)).length, 0);
  });

  it('narrows a plain variable in a ternary', async () => {
    assert.strictEqual((await nullableArg(`${PRE}  let m = v ? uc(v) : null;\n}`)).length, 0);
  });

  it('narrows a computed member in an if-statement', async () => {
    assert.strictEqual((await nullableArg(`${PRE}  if (parts[5]) { let m = uc(parts[5]); }\n}`)).length, 0);
  });

  it('narrows via an `&&` truthiness chain on a computed member', async () => {
    assert.strictEqual((await nullableArg(`function f(line){ let mm = split(line, ';'); let m = mm[0] && mm[0] !== '' ? uc(mm[0]) : null; }`)).length, 0);
  });

  // ── soundness: only fire where the value is provably non-null ───────────────
  it('still warns with NO guard', async () => {
    assert.ok((await nullableArg(`${PRE}  let m = uc(parts[5]);\n}`)).length >= 1);
  });

  it('still warns in the ALTERNATE branch (value is NOT narrowed there)', async () => {
    assert.ok((await nullableArg(`${PRE}  let m = v ? null : uc(v);\n}`)).length >= 1);
  });

  it('does NOT narrow a VARIABLE-index access (parts[i] can change between guard and use)', async () => {
    assert.ok((await nullableArg(`function f(line, i){ let p = split(line, ','); let m = p[i] ? uc(p[i]) : null; }`)).length >= 1);
  });
});
