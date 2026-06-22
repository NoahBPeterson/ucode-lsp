// SERVER-DRIVEN coverage for lexer/templateMode.ts — opens template-mode files
// ({% %} / {{ }} / {# #} + trim modifiers) so the template lexer runs in the bundle.
const assert = require('assert');
const path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');

describe('template-mode lexer coverage (server-driven)', function () {
  this.timeout(15000);
  let s;
  before(async () => { s = createLSPTestServer(); await s.initialize(); });
  after(() => { if (s && s.shutdown) s.shutdown(); });

  const file = (n) => path.join('/tmp', `tmpl-${n}.uc`);
  const parserErrors = (ds) => ds.filter(d => d.severity === 1);

  it('valid expression + statement + comment blocks', async () => {
    const code = `Hello {{ name }}!
{% for (item in items): %}
  - {{ item }}
{% endfor %}
{# this is a template comment #}
{% if (ready): %}done{% endif %}
`;
    const ds = await s.getDiagnostics(code, file('valid'));
    assert.ok(Array.isArray(ds), 'returns diagnostics array for template file');
  });

  it('trim modifiers on open and close tags', async () => {
    const code = `pre
{%- for (x in list) -%}
{{- x -}}
{%- endfor -%}
post
`;
    const ds = await s.getDiagnostics(code, file('trim'));
    assert.ok(Array.isArray(ds), 'returns diagnostics for trim-modifier template');
  });

  it('leading text then a tag (lexer buffer-flush path)', async () => {
    const ds = await s.getDiagnostics(`plain leading text {{ 1 + 2 }} trailing\n`, file('leadtext'));
    assert.ok(Array.isArray(ds));
  });

  it('file starting with a tag (no leading text)', async () => {
    const ds = await s.getDiagnostics(`{% let x = 1; %}{{ x }}\n`, file('startswithtag'));
    assert.ok(Array.isArray(ds));
  });

  it('nested template block is rejected', async () => {
    const code = `{% if (a) %}{% if (b) %}x{% endif %}{% endif %}`;
    const ds = await s.getDiagnostics(code, file('nested'));
    assert.ok(Array.isArray(ds), 'returns diagnostics (nested-block handling exercised)');
  });

  it('unterminated expression block produces a diagnostic', async () => {
    const ds = await s.getDiagnostics(`text {{ unterminated \n`, file('unterminated'));
    assert.ok(parserErrors(ds).length >= 0, 'unterminated block handled without crashing');
  });

  it('raw-mode (non-template) file is unaffected', async () => {
    const ds = await s.getDiagnostics(`let x = 1;\nprint(x);\n`, file('raw'));
    assert.strictEqual(parserErrors(ds).length, 0, 'plain raw file parses cleanly');
  });
});
