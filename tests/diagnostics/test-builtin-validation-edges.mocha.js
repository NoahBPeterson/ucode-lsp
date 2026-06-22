// SERVER-DRIVEN coverage for checkers/builtinValidation.ts — drives many builtins with
// edge/invalid arguments so their per-builtin validators run in the bundle. Assertive:
// checks the specific expected diagnostic where the message is well-defined.
const assert = require('assert');
const path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');

describe('builtin argument validation edges (server-driven)', function () {
  this.timeout(15000);
  let s;
  before(async () => { s = createLSPTestServer(); await s.initialize(); });
  after(() => { if (s && s.shutdown) s.shutdown(); });

  const file = (n) => path.join('/tmp', `bv-${n}.uc`);
  const msgs = (ds) => ds.map(d => d.message);
  async function diag(label, code) { return s.getDiagnostics(code, file(label)); }

  it('signal(): out-of-range number is flagged', async () => {
    const ds = await diag('sig-range', `signal(99, function() {});\n`);
    assert.ok(msgs(ds).some(m => /Signal number must be between 1 and 31/.test(m)),
      `expected signal-range error, got: ${JSON.stringify(msgs(ds))}`);
  });

  it('signal(): invalid signal name is flagged', async () => {
    const ds = await diag('sig-name', `signal("NOSUCHSIG", function() {});\n`);
    assert.ok(msgs(ds).some(m => /Invalid signal name/.test(m)),
      `expected invalid-signal-name, got: ${JSON.stringify(msgs(ds))}`);
  });

  it('signal(): bad handler string is flagged', async () => {
    const ds = await diag('sig-handler', `signal(2, "notahandler");\n`);
    assert.ok(msgs(ds).some(m => /ignore|default|handler/i.test(m)),
      `expected handler-string warning, got: ${JSON.stringify(msgs(ds))}`);
  });

  it('signal(): uncatchable signal is flagged', async () => {
    const ds = await diag('sig-kill', `signal("KILL", function() {});\n`);
    assert.ok(msgs(ds).some(m => /cannot be caught|ignored/i.test(m)),
      `expected uncatchable-signal warning, got: ${JSON.stringify(msgs(ds))}`);
  });

  it('loadstring(): wrong argument count is flagged', async () => {
    const ds = await diag('ls-count', `loadstring("x", {}, "extra");\n`);
    assert.ok(msgs(ds).some(m => /loadstring\(\) expects 1-2 arguments/.test(m)),
      `expected loadstring arg-count error, got: ${JSON.stringify(msgs(ds))}`);
  });

  it('loadstring(): 2nd arg as an options object is accepted', async () => {
    const ds = await diag('ls-opts', `loadstring("let x = 1;", { raw_mode: true });\n`);
    assert.ok(!msgs(ds).some(m => /loadstring\(\) expects/.test(m)), `2-arg loadstring should be valid, got: ${JSON.stringify(msgs(ds))}`);
  });

  it('replace(): wrong-typed arguments are flagged', async () => {
    const ds = await diag('replace', `replace("hello", 123, [1,2]);\n`);
    assert.ok(msgs(ds).some(m => /replace/.test(m) && /expects|argument/i.test(m)),
      `expected replace arg-type diagnostic, got: ${JSON.stringify(msgs(ds))}`);
  });

  it('a sweep of builtins with too few/many args each yields a diagnostic', async () => {
    const cases = [
      `lc();`, `uc();`, `hexenc();`, `substr();`, `index();`,
      `length(1, 2);`, `keys();`, `values();`, `exists();`, `json();`,
    ];
    for (const c of cases) {
      const ds = await diag('sweep-' + c.replace(/\W/g, ''), c + '\n');
      assert.ok(ds.length >= 1, `expected a diagnostic for "${c}", got none`);
    }
  });
});
