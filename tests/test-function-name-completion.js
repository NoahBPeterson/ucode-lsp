const assert = require('assert');
const path = require('path');
const { createLSPTestServer } = require('./lsp-test-helpers');

// While NAMING a function (`function lo|`), completions must be suppressed.
// Otherwise a fuzzy match like `localtime` stays highlighted in the popup, and
// typing `(` — a commit character — accepts it, silently renaming the function
// to a builtin. Completions everywhere else (e.g. an expression position) must
// be unaffected.
describe('Function-name completion suppression', function() {
  this.timeout(15000);

  let lspServer, getCompletions;

  before(async function() {
    lspServer = createLSPTestServer();
    await lspServer.initialize();
    getCompletions = lspServer.getCompletions;
  });

  after(function() {
    if (lspServer) lspServer.shutdown();
  });

  it('`function lo` (typing the name) offers NO completions', async function() {
    const content = 'function lo';
    const file = path.join(__dirname, '..', 'test-fnname-typing.uc');
    const completions = await getCompletions(content, file, 0, content.length);

    assert.ok(Array.isArray(completions), 'expected an array');
    assert.strictEqual(completions.length, 0,
      `expected no completions in function-name position, got ${completions.length}: ` +
      `${completions.map(c => c.label).slice(0, 8).join(', ')}`);
  });

  it('`function ` (cursor right after the keyword) offers NO completions', async function() {
    const content = 'function ';
    const file = path.join(__dirname, '..', 'test-fnname-blank.uc');
    const completions = await getCompletions(content, file, 0, content.length);

    assert.ok(Array.isArray(completions), 'expected an array');
    assert.strictEqual(completions.length, 0,
      `expected no completions right after \`function\`, got ${completions.length}`);
  });

  it('`let x = lo` (expression position) STILL offers completions including localtime', async function() {
    const content = 'let x = lo';
    const file = path.join(__dirname, '..', 'test-fnname-expr.uc');
    const completions = await getCompletions(content, file, 0, content.length);

    assert.ok(Array.isArray(completions) && completions.length > 0,
      'expected completions in an expression position');
    const labels = completions.map(c => c.label);
    assert.ok(labels.includes('localtime'),
      `localtime should still be offered outside function-name position, got: ${labels.slice(0, 10).join(', ')}`);
  });
});
