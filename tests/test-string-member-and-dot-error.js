const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { createLSPTestServer } = require('./lsp-test-helpers');

// 0.6.86 — two unrelated paper cuts caught from the same real file:
//
//   (1) `line.\n /* comment */ \n if (...)` — the parser's "Expected property
//       name after '.' or '?.'" diagnostic landed on the `if` token two lines
//       down (whatever peek() returned), not on the dot itself. Now anchored
//       at the dot via errorAt(operatorToken).
//
//   (2) `parts[0].toUpperCase()` — string-method access on the result of an
//       array element access didn't trigger the "string has no member
//       variables or functions" diagnostic. The receiver's base UcodeType
//       collapses to UNKNOWN (because array[i] yields STRING|NULL), so the
//       old check on objectType alone missed it. Now also consults _fullType
//       and unwraps unions for the STRING-member case.
describe('Parser dot-error placement + string-method detection via _fullType', function() {
  this.timeout(20000);

  const wsRoot = '/tmp/test-string-member-and-dot-error';
  fs.mkdirSync(wsRoot, { recursive: true });
  const file = path.join(wsRoot, 'main.uc');
  let lspServer;
  before(async function() {
    lspServer = createLSPTestServer({ workspaceRoot: wsRoot });
    await lspServer.initialize();
  });
  after(function() {
    if (lspServer) lspServer.shutdown();
  });

  it('"Expected property name after \'.\'" diagnostic anchors at the DOT, not the next token', async function() {
    const code = [
      "'use strict';",
      "let line = 'x';",
      "line.",
      "/* skip */",
      "if (line == '') {}",
      ''
    ].join('\n');
    const diags = await lspServer.getDiagnostics(code, file);
    const propErr = diags.find(d => /Expected property name after/.test(d.message));
    assert.ok(propErr, `expected the "Expected property name" diagnostic, got: ${JSON.stringify(diags.map(d => d.message))}`);
    // The dot is at line 2 (0-indexed), char 4 (`line` is 4 chars wide, dot at col 4)
    assert.strictEqual(propErr.range.start.line, 2,
      `diagnostic must land on the dot's line (line 2), got line ${propErr.range.start.line}`);
    assert.strictEqual(propErr.range.start.character, 4,
      `diagnostic must land at the dot's column (4), got col ${propErr.range.start.character}`);
  });

  it('`array_of_string[i].toUpperCase()` errors — string has no member methods', async function() {
    const code = [
      "'use strict';",
      "function f() {",
      "    const parts = split('a,b,c', ',');",
      "    return parts[0].toUpperCase();",
      "}",
      "f();",
      ''
    ].join('\n');
    const diags = await lspServer.getDiagnostics(code, file);
    const stringErr = diags.find(d => /does not exist on string type/.test(d.message));
    assert.ok(stringErr,
      `expected "does not exist on string type" diagnostic for parts[0].toUpperCase(), got: ${JSON.stringify(diags.map(d => d.message))}`);
  });

  it('direct `someStr.toUpperCase()` errors too (the simple JS-port mistake)', async function() {
    const code = [
      "'use strict';",
      "function f() {",
      "    let s = 'hello';",
      "    return s.toUpperCase();",
      "}",
      "f();",
      ''
    ].join('\n');
    const diags = await lspServer.getDiagnostics(code, file);
    const stringErr = diags.find(d => /does not exist on string type/.test(d.message));
    assert.ok(stringErr, 'should error on direct string.method() call');
  });
});
