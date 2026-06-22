const assert = require('assert');
const path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');

// `{` is a completion trigger character ONLY so that JSDoc type annotations
// (`@param {string}`) complete as you type the brace. But the same trigger
// fires when you open an ordinary code block — `function f(x) {` then Enter —
// where the general-completion fallback used to surface a stray global (ARGV).
// VS Code auto-selects the top item, so Enter accepted that completion instead
// of inserting a newline. These tests pin the fix: `{`-triggered completion is
// suppressed everywhere EXCEPT JSDoc, while manual invocation is unaffected.
describe('Brace ({) trigger completion behavior', function() {
  this.timeout(15000);

  let lspServer;
  let getCompletions;
  const braceTrigger = { triggerKind: 2, triggerCharacter: '{' };

  before(async function() {
    lspServer = createLSPTestServer();
    await lspServer.initialize();
    getCompletions = lspServer.getCompletions;
  });

  after(function() {
    if (lspServer) {
      lspServer.shutdown();
    }
  });

  it('opening a code block with `{` returns NO completions (Enter inserts a newline)', async function() {
    // Cursor sits between the auto-closed braces: function f(x) {<cursor>}
    const content = 'function f(x) {}';
    const filePath = path.join(__dirname, '..', 'test-brace-block.uc');
    const cursor = content.indexOf('{') + 1; // char 15, right after `{`

    const completions = await getCompletions(content, filePath, 0, cursor, braceTrigger);

    assert.ok(Array.isArray(completions), 'expected an array of completions');
    assert.strictEqual(completions.length, 0,
      `expected zero completions on block-open via { trigger, got ${completions.length}: ` +
      `${completions.map(c => c.label).slice(0, 8).join(', ')}`);
  });

  it('JSDoc `@param {` via `{` trigger STILL returns type completions', async function() {
    const content = [
      '/**',
      ' * @param {',
      ' */',
      'function f(x) {}'
    ].join('\n');
    const filePath = path.join(__dirname, '..', 'test-brace-jsdoc.uc');
    // Line 1 = " * @param {"; cursor right after the `{`.
    const cursorChar = ' * @param {'.length; // 11

    const completions = await getCompletions(content, filePath, 1, cursorChar, braceTrigger);

    assert.ok(Array.isArray(completions) && completions.length > 0,
      'expected JSDoc type completions');
    const labels = completions.map(c => c.label);
    for (const t of ['string', 'number', 'object', 'array']) {
      assert.ok(labels.includes(t), `expected JSDoc type "${t}" in completions, got: ${labels.join(', ')}`);
    }
    assert.ok(!labels.includes('ARGV'), 'JSDoc type completion must not leak globals like ARGV');
  });

  it('manual invocation (Ctrl+Space) at the same block position is UNAFFECTED', async function() {
    const content = 'function f(x) {}';
    const filePath = path.join(__dirname, '..', 'test-brace-block-manual.uc');
    const cursor = content.indexOf('{') + 1;

    // triggerKind 1 (Invoked) — no triggerCharacter; the guard must not fire.
    const completions = await getCompletions(content, filePath, 0, cursor, { triggerKind: 1 });

    assert.ok(Array.isArray(completions) && completions.length > 0,
      'manual invocation should still offer completions');
    const labels = completions.map(c => c.label);
    assert.ok(labels.includes('print'), `expected builtins on manual invoke, got: ${labels.slice(0, 8).join(', ')}`);
  });
});
