const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { createLSPTestServer } = require('./lsp-test-helpers');

// Regression coverage for the CheckResult refactor (checkNode now returns the
// rich UcodeDataType directly; the `_fullType` side channel is gone).
//
// These specifically guard the two spots Phase C had to fix, BOTH of which had
// zero prior coverage (which is why a latent regression slipped through an
// otherwise-green Phase B):
//
//   1. for-in over an array now sees an ArrayType OBJECT as the iterable type,
//      not the bare `array` enum. `rightType === UcodeType.ARRAY` would be
//      false → index/element typed UNKNOWN. Fixed by collapsing via
//      dataTypeToBase. (two-var index → integer; single-var element → element.)
//
//   2. nullish coalescing `a ?? b`: the result is `(a without null) ∪ b`. The
//      old code returned the whole left union verbatim (kept null). Now rich
//      types let us narrow it properly.
describe('CheckResult refactor — rich type flows through checkNode', function() {
  this.timeout(20000);

  const wsRoot = '/tmp/test-checkresult-refactor';
  fs.mkdirSync(wsRoot, { recursive: true });
  const file = path.join(wsRoot, 'main.uc');
  let lspServer;
  before(async function() {
    lspServer = createLSPTestServer({ workspaceRoot: wsRoot });
    await lspServer.initialize();
  });
  after(function() { if (lspServer) lspServer.shutdown(); });

  function firstLine(h) {
    if (!h || !h.contents) return '';
    return (typeof h.contents === 'string' ? h.contents : h.contents.value || '').split('\n')[0];
  }
  async function hoverVar(code, varName) {
    const lines = code.split('\n');
    const ln = lines.findIndex(l => l.includes('let ' + varName));
    if (ln < 0) throw new Error(`var ${varName} not declared`);
    return firstLine(await lspServer.getHover(code, file, ln, lines[ln].indexOf(varName) + 2));
  }

  it('two-var for-in over an array: index var is integer', async function() {
    const code = [
      "'use strict';",
      "let arr = [10, 20, 30];",
      "for (let idxvar, valvar in arr) {",
      "    let i_alias = idxvar;",
      "}",
      ''
    ].join('\n');
    const h = await hoverVar(code, 'i_alias');
    assert.ok(/integer/.test(h), `array index should be integer, got: ${h}`);
  });

  it('single-var for-in over an array<integer>: element var is integer', async function() {
    const code = [
      "'use strict';",
      "let arr = [10, 20, 30];",
      "for (let elem in arr) {",
      "    let e_alias = elem;",
      "}",
      ''
    ].join('\n');
    const h = await hoverVar(code, 'e_alias');
    assert.ok(/integer/.test(h), `array element should be integer, got: ${h}`);
  });

  it('nullish coalescing narrows `array<string> | null ?? []` to array<string>', async function() {
    const code = [
      "'use strict';",
      "let coalesced = match('abc', /b/) ?? [];",
      ''
    ].join('\n');
    const h = await hoverVar(code, 'coalesced');
    assert.ok(/array/.test(h) && !/null/.test(h),
      `?? should drop null from the left, got: ${h}`);
  });

  it('a computed array-element access still yields element|null (rich type preserved)', async function() {
    // `arr[i]` returns `string | null`; assigning preserves the union so a
    // downstream length() narrows correctly rather than seeing bare unknown.
    const code = [
      "'use strict';",
      "let names = split('a,b,c', ',');",
      "let first = names[0];",
      ''
    ].join('\n');
    const h = await hoverVar(code, 'first');
    assert.ok(/string/.test(h), `array<string> element access should include string, got: ${h}`);
  });
});
