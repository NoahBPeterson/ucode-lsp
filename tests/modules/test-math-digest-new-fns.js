const assert = require('assert');
const path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');

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

  // ext_maths set (ucode 0beaa9d..3ec4e5c): acos/asin/atan/tan, cosh/sinh/tanh,
  // expm1/log1p/log10/log2, cbrt/hypot/copysign, fmin/fmax/clamp, sign/signbit/
  // signnz, isinf, and floor/ceil/round/trunc with the output_type toggle.
  it('all new ext_maths functions are known exports (no unknown-export diagnostic)', async function() {
    const names = ['acos','asin','atan','tan','cosh','sinh','tanh','expm1','log1p',
      'log10','log2','cbrt','hypot','copysign','fmin','fmax','clamp','sign',
      'signbit','signnz','isinf','floor','ceil','round','trunc'];
    const code = `import { ${names.join(', ')} } from 'math';\n`;
    const file = path.join(__dirname, '..', 'test-math-ext.uc');
    const diags = await getDiagnostics(code, file);
    const bad = diags.filter(d => /not.*export|unknown/i.test(d.message || ''));
    assert.ok(bad.length === 0,
      `all ext_maths fns should be known exports, got: ${JSON.stringify(bad.map(d => d.message))}`);
  });

  it('clamp hovers with (x, upper, lower) and a double return', async function() {
    const code = "import { clamp } from 'math';\nlet a = clamp(5, 10, 0);\n";
    const file = path.join(__dirname, '..', 'test-math-clamp.uc');
    await getDiagnostics(code, file);
    const text = hoverText(await getHover(code, file, 0, 10));
    assert.ok(/clamp\(x: number, upper: number, lower: number\): double/.test(text),
      `clamp signature wrong, got: ${JSON.stringify(text)}`);
  });

  it('floor exposes the optional output_type toggle and returns number', async function() {
    const code = "import { floor } from 'math';\nlet a = floor(3.7, true);\n";
    const file = path.join(__dirname, '..', 'test-math-floor.uc');
    await getDiagnostics(code, file);
    const text = hoverText(await getHover(code, file, 0, 10));
    assert.ok(/floor\(x: number, \[output_type: boolean\]\): number/.test(text),
      `floor signature wrong, got: ${JSON.stringify(text)}`);
  });

  it('isinf returns boolean', async function() {
    const code = "import { isinf } from 'math';\nlet a = isinf(1);\n";
    const file = path.join(__dirname, '..', 'test-math-isinf.uc');
    await getDiagnostics(code, file);
    const text = hoverText(await getHover(code, file, 0, 10));
    assert.ok(/isinf\(x: number\): boolean/.test(text),
      `isinf signature wrong, got: ${JSON.stringify(text)}`);
  });
});
