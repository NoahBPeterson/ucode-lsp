const assert = require('assert');
const path = require('path');
const { createLSPTestServer } = require('./lsp-test-helpers');

// New module functions ported from ucode upstream:
//   math.deg2rad / math.rad2deg (81066c5)
//   digest.fnv1a64 / digest.fnv1a64_file (eff52f0)
describe('New math/digest module functions', function() {
  this.timeout(15000);

  let getHover, getDiagnostics;

  before(async function() {
    const s = createLSPTestServer();
    await s.initialize();
    getHover = s.getHover;
    getDiagnostics = s.getDiagnostics;
  });

  function hoverText(h) {
    if (!h || !h.contents) return '';
    return (typeof h.contents === 'string' ? h.contents : h.contents.value || '').split('\n')[0];
  }

  it('math.deg2rad / rad2deg are known exports with the right signature', async function() {
    const code = "import { deg2rad, rad2deg } from 'math';\nlet a = deg2rad(180);\nlet b = rad2deg(a);\n";
    const file = path.join(__dirname, '..', 'test-math-new.uc');
    const diags = await getDiagnostics(code, file);
    assert.ok(!diags.some(d => /not.*export|unknown/i.test(d.message || '')),
      `deg2rad/rad2deg should be known exports, got: ${JSON.stringify(diags.map(d => d.message))}`);
    assert.ok(/deg2rad\(.*\): double/.test(hoverText(await getHover(code, file, 0, 12))),
      'deg2rad should hover as a double-returning function');
  });

  it('digest.fnv1a64 / fnv1a64_file are known exports returning string | null', async function() {
    const code = "import { fnv1a64, fnv1a64_file } from 'digest';\nlet h = fnv1a64('x');\nlet f = fnv1a64_file('/p');\n";
    const file = path.join(__dirname, '..', 'test-digest-new.uc');
    const diags = await getDiagnostics(code, file);
    assert.ok(!diags.some(d => /not.*export|unknown/i.test(d.message || '')),
      `fnv1a64/fnv1a64_file should be known exports, got: ${JSON.stringify(diags.map(d => d.message))}`);
    const text = hoverText(await getHover(code, file, 0, 12));
    assert.ok(/fnv1a64\(str: string\): string \| null/.test(text),
      `fnv1a64 should hover as string | null, got: ${JSON.stringify(text)}`);
  });
});
