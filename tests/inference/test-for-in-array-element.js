const assert = require('assert');
const path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');

// Two linked fixes:
//   1. `string[]` in a return type (e.g. uci `.get` → "string | string[] | null")
//      parses to array<string>, not a bare array.
//   2. for-in over an array<T> types the loop variable as T — even when the
//      declared type is a union the loop narrows (`string | array<T> | null`).
describe('for-in element typing + string[] parsing', function() {
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

  it('uci `.get` result types string[] as array<string>', async function() {
    const code = [
      "import { cursor } from 'uci';",
      'let ctx = cursor();',
      "let opt = ctx.get('dhcp', 'lan', 'dhcp_option');",
      ''
    ].join('\n');
    const file = path.join(__dirname, '..', 'test-forin-get.uc');
    const text = hoverText(await getHover(code, file, 2, 5)); // hover `opt`
    assert.ok(/array<string>/.test(text), `expected array<string> (not bare array), got: ${JSON.stringify(text)}`);
  });

  it('for-in over array<string> types the loop variable as string', async function() {
    const code = [
      'let arr = [ "a", "b" ];',
      'for (let v in arr) {',
      '    print(v);',
      '}',
      ''
    ].join('\n');
    const file = path.join(__dirname, '..', 'test-forin-plain.uc');
    const text = hoverText(await getHover(code, file, 1, 9)); // hover `v`
    assert.ok(/\bstring\b/.test(text), `expected string loop var, got: ${JSON.stringify(text)}`);
  });

  it('for-in after union narrowing types the loop var as string and split() is happy', async function() {
    const code = [
      "import { cursor } from 'uci';",
      'function f(iface) {',
      '    let ctx = cursor();',
      "    let dhcp_option = ctx.get('dhcp', iface, 'dhcp_option');",
      "    if (type(dhcp_option) != 'array') return;",
      '    for (let opt in dhcp_option) {',
      '        let parts = split(opt, ",");',
      '        print(parts);',
      '    }',
      '}',
      ''
    ].join('\n');
    const file = path.join(__dirname, '..', 'test-forin-narrow.uc');
    const text = hoverText(await getHover(code, file, 5, 13)); // hover `opt`
    assert.ok(/\bstring\b/.test(text), `expected string opt, got: ${JSON.stringify(text)}`);
    const diags = await getDiagnostics(code, file);
    const splitWarn = diags.find(d => d.code === 'incompatible-function-argument' || d.code === 'nullable-argument');
    assert.ok(!splitWarn, `split(opt, …) should not warn, got: ${JSON.stringify(diags.map(d => d.code))}`);
  });
});
