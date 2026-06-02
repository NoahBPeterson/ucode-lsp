const assert = require('assert');
const { createLSPTestServer } = require('./lsp-test-helpers');

// Early-exit narrowing (`if (!x) { …terminates… }` ⇒ x is non-null afterward)
// must recognise a block that terminates via a try/catch (both branches return)
// or an if/else (both branches return), not only a bare trailing return. The
// repro: `if (!raw_tr_content) { try { …; return true; } catch(e) { return false; } }`
// then `split(trim(raw_tr_content), …)` — raw_tr_content is non-null there.
describe('Early-exit narrowing through a terminating try/catch or if/else block', function () {
  this.timeout(15000);
  let lspServer, getDiagnostics;
  const FP = '/tmp/term-block.uc';
  const flagged = async (code) =>
    (await getDiagnostics(code, FP)).filter(d =>
      /nullable|possibly 'null'|may be null|is unknown|argument 1/i.test(d.message || ''));
  const PRE = `import * as fs from 'fs';\nfunction f(p) {\n  let c = fs.readfile(p);\n`;   // c: string|null
  const USE = `\n  let lines = split(trim(c), '\\n');\n}`;

  before(async function () { lspServer = createLSPTestServer(); await lspServer.initialize(); getDiagnostics = lspServer.getDiagnostics; });
  after(function () { if (lspServer) lspServer.shutdown(); });

  it('narrows after `if (!x) { try { return } catch { return } }` (the repro)', async () => {
    assert.strictEqual((await flagged(`${PRE}  if (!c) { try { fs.writefile("x", ""); return true; } catch (e) { return false; } }${USE}`)).length, 0);
  });

  it('narrows after `if (!x) { if (cond) { return } else { return } }`', async () => {
    assert.strictEqual((await flagged(`${PRE}  if (!c) { if (p) { return true; } else { return false; } }${USE}`)).length, 0);
  });

  it('still narrows after a plain `if (!x) return` (regression)', async () => {
    assert.strictEqual((await flagged(`${PRE}  if (!c) return false;${USE}`)).length, 0);
  });

  // ── soundness: blocks that DON'T always terminate must NOT narrow ───────────
  it('does NOT narrow when the catch falls through (block can complete)', async () => {
    assert.ok((await flagged(`${PRE}  if (!c) { try { return true; } catch (e) { print("x"); } }${USE}`)).length >= 1);
  });

  it('does NOT narrow after a bare `if` with no else (can fall through)', async () => {
    assert.ok((await flagged(`${PRE}  if (!c) { if (p) { return true; } }${USE}`)).length >= 1);
  });

  it('does NOT narrow with no guard at all (control)', async () => {
    assert.ok((await flagged(`${PRE}${USE}`)).length >= 1);
  });
});
