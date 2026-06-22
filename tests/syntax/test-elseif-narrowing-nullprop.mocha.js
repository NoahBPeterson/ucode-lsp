const assert = require('assert');
const { createLSPTestServer } = require('../lsp-test-helpers');

// Regression: a variable narrowed to string by an early-exit guard
// (`if (type(x) != "string") return/continue;`) must STAY narrowed through an
// if / else-if / else-if chain whose branch conditions are null-propagating
// builtin comparisons (`substr(x,…) == 'wlan'`). Previously the else branch
// negated each such null-propagation guard ("x is null"), and two of them
// compounded to collapse x to `null` — producing a bogus "argument 1 of
// rindex()/substr() is null/unknown" error in the 3rd+ branch.
describe('else-if narrowing with null-propagation guards', function () {
  this.timeout(15000);
  let lspServer, getDiagnostics;
  const FP = '/tmp/elseif-narrow.uc';
  const argErrs = async (code) =>
    (await getDiagnostics(code, FP)).filter(d =>
      /expects (string|array)|argument 1/i.test(d.message || ''));

  before(async function () { lspServer = createLSPTestServer(); await lspServer.initialize(); getDiagnostics = lspServer.getDiagnostics; });
  after(function () { if (lspServer) lspServer.shutdown(); });

  const H = `function f(iface_name) {\n  if (type(iface_name) != "string") return;\n  let t = 0;\n`;

  it('keeps the narrowing across a 3-branch else-if chain (the repro)', async () => {
    const code = H +
      `  if (substr(iface_name, 0, 4) == 'wlan') { t = 1; }\n` +
      `  else if (substr(iface_name, 0, 3) == 'eth') { t = 2; }\n` +
      `  else if (rindex(iface_name, 'mesh') != -1) { t = 1; }\n}`;
    assert.strictEqual((await argErrs(code)).length, 0);
  });

  it('keeps the narrowing across a 4-branch chain too', async () => {
    const code = H +
      `  if (substr(iface_name, 0, 4) == 'wlan') {}\n` +
      `  else if (substr(iface_name, 0, 3) == 'eth') {}\n` +
      `  else if (substr(iface_name, 0, 3) == 'ath') {}\n` +
      `  else if (rindex(iface_name, 'mesh') != -1) {}\n}`;
    assert.strictEqual((await argErrs(code)).length, 0);
  });

  it('works with an array-element base narrowed by continue (the original code)', async () => {
    const code = `function f(arr) {
      for (let j = 0; j < length(arr); j++) {
        let iface_name = arr[j];
        if (type(iface_name) != "string") continue;
        let t = 0;
        if (substr(iface_name, 0, 4) == 'wlan') { t = 1; }
        else if (substr(iface_name, 0, 3) == 'eth') { t = 2; }
        else if (rindex(iface_name, 'mesh') != -1) { t = 1; }
      }
    }`;
    assert.strictEqual((await argErrs(code)).length, 0);
  });

  // The same unsound negation also lived in the early-exit OR / AND chain paths.
  it('keeps the narrowing across an early-exit OR chain with a null-prop term', async () => {
    const code = `function f(x) {
      if (type(x) != "string") return;
      if (substr(x, 0, 1) == 'a' || !x) return;
      let y = rindex(x, 'm');
    }`;
    assert.strictEqual((await argErrs(code)).length, 0);
  });

  it('keeps the narrowing across an early-exit AND chain with a null-prop term', async () => {
    const code = `function f(x) {
      if (type(x) != "string") return;
      if (substr(x, 0, 1) == 'a' && length(x) > 0) return;
      let y = rindex(x, 'm');
    }`;
    assert.strictEqual((await argErrs(code)).length, 0);
  });

  it('still warns when there is NO type guard (an un-narrowed arg is genuinely unknown)', async () => {
    // No `type(x)=="string"` — x is only known truthy, not string|array, so the
    // "narrow this arg" warning is correct and must NOT be suppressed.
    const code = `function f(x) { if (substr(x, 0, 1) == 'a' || !x) return; let y = rindex(x, 'm'); }`;
    assert.ok((await argErrs(code)).length >= 1);
  });

  it('still flags a genuinely wrong-typed builtin arg (fix is not over-broad)', async () => {
    // No narrowing here — arr[j] is unknown, but passing an array LITERAL to
    // substr must still be caught.
    const code = `let r = substr([1,2], 0, 3);`;
    assert.ok((await argErrs(code)).length >= 1);
  });
});
