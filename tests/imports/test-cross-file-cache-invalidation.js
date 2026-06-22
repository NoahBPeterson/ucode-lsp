const assert = require('assert');
const path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');

// Two-part regression coverage:
//   (A) inference: a named-imported function whose body returns `string` in the
//       happy path and `null` from a catch must surface as `string | null` at
//       the call site — not `unknown`. Without this, downstream diagnostics
//       on the call result decay to a generic "is unknown" instead of the
//       specific `nullable-argument`. (fileResolver: collectReturnTypes now
//       walks TryStatement; inferFunctionReturnType now unions mixed returns.)
//   (B) invalidation: editing the imported file's content must cause the
//       server to push an updated publishDiagnostics for any open importer.
//       Previously the importer's analysisCache entry stayed stale until it
//       was re-opened. (server.ts: reverseDeps + invalidateDependents.)
describe('Cross-file cache invalidation + non-object return inference', function() {
  this.timeout(20000);

  const wsRoot = path.resolve(__dirname, '..', 'fixtures', 'cache-inv');
  const importerFile = path.join(wsRoot, 'importer.uc');
  const commandsFile = path.join(wsRoot, 'commands.uc');
  const importerUri = `file://${importerFile}`;
  const commandsUri = `file://${commandsFile}`;

  // commands.uc with a try/catch — catch returns null, try returns string.
  const commandsWithNull = [
    "'use strict';",
    "export function run_command(cmd) {",
    "    try {",
    "        return 'ok-' + cmd;",
    "    } catch (e) {",
    "        return null;",
    "    }",
    "}",
    ''
  ].join('\n');

  // commands.uc that always returns string — no null branch.
  const commandsStringOnly = [
    "'use strict';",
    "export function run_command(cmd) {",
    "    return 'ok-' + cmd;",
    "}",
    ''
  ].join('\n');

  const importerCode = [
    "'use strict';",
    "import { run_command } from './commands.uc';",
    "let out = run_command('x');",
    "let i = index(out, 'ok');",
    "print(i);",
    ''
  ].join('\n');

  let lspServer;
  before(async function() {
    lspServer = createLSPTestServer({ workspaceRoot: wsRoot });
    await lspServer.initialize();
  });
  after(function() {
    if (lspServer) lspServer.shutdown();
  });

  it('A named-export function with try/catch returning string|null surfaces as a union at the call site', async function() {
    // Seed commands.uc on disk via didOpen, then ask for importer's diagnostics.
    lspServer.openOrChangeDocument(commandsUri, commandsWithNull);
    const diags = await lspServer.getDiagnostics(importerCode, importerFile);
    const nullable = diags.find(d => d.code === 'nullable-argument');
    assert.ok(nullable, `expected nullable-argument diagnostic, got: ${JSON.stringify(diags.map(d => d.code))}`);
    // Specifically NOT the generic "is unknown" form
    const unknownArg = diags.find(d => d.code === 'incompatible-function-argument' && /unknown/i.test(d.message));
    assert.ok(!unknownArg, `should not report "argument is unknown" for a string|null return: ${JSON.stringify(diags.map(d => d.message))}`);
  });

  it('Editing the imported file pushes fresh diagnostics for the open importer (no re-open required)', async function() {
    // Switch commands.uc to the no-null version. Importer is NOT re-opened.
    // The server should detect importer depends on commands.uc and re-analyze
    // it, sending an unsolicited publishDiagnostics with no diagnostics.
    lspServer.openOrChangeDocument(commandsUri, commandsStringOnly);
    const fresh = await lspServer.waitForDiagnostics(importerUri, ds => ds.length === 0, 3000);
    assert.strictEqual(fresh.length, 0, `expected importer diagnostics to clear, got: ${JSON.stringify(fresh)}`);
  });

  it('Editing the imported file back to string|null re-pushes the nullable warning', async function() {
    // Reverse: a previously-clean importer should pick up the new nullable
    // return when commands.uc gets the catch branch back. This proves the
    // invalidation isn't just one-shot.
    lspServer.openOrChangeDocument(commandsUri, commandsWithNull);
    const dirty = await lspServer.waitForDiagnostics(
      importerUri,
      ds => ds.some(d => d.code === 'nullable-argument'),
      3000
    );
    assert.ok(dirty.find(d => d.code === 'nullable-argument'),
      `expected nullable-argument after re-introducing the null branch, got: ${JSON.stringify(dirty.map(d => d.code))}`);
  });
});
