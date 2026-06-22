// SERVER-DRIVEN coverage for the control-flow parser (parser/statements/
// controlFlowStatements.ts) and the AST visitor. Direct-import parser tests don't
// count toward coverage:e2e (which measures the spawned dist/server.js); these drive
// the real server via getDiagnostics so every control-flow construct is parsed +
// visited inside the bundle. Assertions are intentionally lenient (valid code => no
// hard errors) — the point is exercising each branch end-to-end.
const assert = require('assert');
const path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');

describe('control-flow parser coverage (server-driven)', function () {
  this.timeout(15000);
  let s;
  before(async () => { s = createLSPTestServer(); await s.initialize(); });
  after(() => { if (s && s.shutdown) s.shutdown(); });

  const file = (n) => path.join('/tmp', `cf-${n}.uc`);
  // valid code => should not produce parser ERRORS (severity 1 from ucode-parser)
  const parserErrors = (ds) => ds.filter(d => d.severity === 1 && d.source === 'ucode-parser');

  async function expectParses(label, code) {
    const ds = await s.getDiagnostics(code, file(label));
    const errs = parserErrors(ds);
    assert.strictEqual(errs.length, 0, `${label}: unexpected parser errors: ${JSON.stringify(errs.map(e => e.message))}`);
  }

  it('if / else-if / else chains', async () => {
    await expectParses('if', `
function f(x) {
  if (x > 10) return "big";
  else if (x > 5) return "mid";
  else if (x > 0) { let y = x * 2; return "" + y; }
  else return "neg";
}`);
  });

  it('while loops (incl. infinite + break)', async () => {
    await expectParses('while', `
function f(n) {
  let i = 0, s = 0;
  while (i < n) { s += i; i++; }
  while (true) { if (s > 100) break; s += 1; }
  return s;
}`);
  });

  it('C-style for, for-in (array + object), nested', async () => {
    await expectParses('for', `
function f(arr, obj) {
  let total = 0;
  for (let i = 0; i < length(arr); i++) total += arr[i];
  for (let v in arr) total += v;
  for (let k in obj) { for (let j = 0; j < 2; j++) total += j; }
  return total;
}`);
  });

  it('switch with cases, fall-through, default, break', async () => {
    await expectParses('switch', `
function f(x) {
  let r = "";
  switch (x) {
    case 1:
    case 2: r = "low"; break;
    case 3: r = "three"; break;
    default: r = "other";
  }
  return r;
}`);
  });

  it('try / catch (with and without binding)', async () => {
    await expectParses('try', `
function f() {
  try { die("boom"); } catch (e) { return "caught: " + e; }
  try { return 1; } catch { return 0; }
}`);
  });

  it('break / continue inside loops', async () => {
    await expectParses('breakcont', `
function f(arr) {
  let n = 0;
  for (let v in arr) {
    if (v == null) continue;
    if (v > 100) break;
    n++;
  }
  while (true) { break; }
  return n;
}`);
  });

  it('return forms: value, bare, before closing brace', async () => {
    await expectParses('return', `
function a() { return 42; }
function b() { return; }
function c(x) { if (x) { return x } return 0 }
function d() { return { a: 1, b: 2 } }`);
  });

  it('deeply nested control flow', async () => {
    await expectParses('nested', `
function f(m) {
  for (let k in m) {
    switch (k) {
      case "a":
        if (m[k] > 0) { while (m[k] > 0) m[k]--; } else { m[k] = 0; }
        break;
      default:
        try { m[k] = m[k] + 1; } catch (e) { m[k] = -1; }
    }
  }
  return m;
}`);
  });

  it('malformed control flow still produces diagnostics without crashing', async () => {
    // exercises the parser's error-recovery branches
    const ds = await s.getDiagnostics(`function f() { if ( { return 1; }`, file('bad'));
    assert.ok(Array.isArray(ds), 'returns diagnostics array even for malformed input');
  });
});
