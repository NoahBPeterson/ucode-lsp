const assert = require('assert');
const path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');

// `import * as ns from './file.uc'; ns.fn()` used to resolve to `unknown` — the
// namespace shape recorded only that `fn` IS a function, never its return type.
// Now getNamespaceExportInfo carries each exported function's return type (an
// `@returns` JSDoc annotation first, else body inference) into the namespace
// symbol's propertyFunctionReturnTypes, so `ns.fn()` call sites resolve a real
// type. Separately, the named-import path now also prefers `@returns` JSDoc over
// body inference for non-factory functions.
describe('Namespace-member (and named-import) function return types', function() {
  this.timeout(20000);

  const wsRoot = path.resolve(__dirname, '..', 'fixtures', 'nsreturn');
  // Virtual importer path (intentionally NOT on disk) — see the note in
  // test-named-const-import-member.js. Only lib/session.uc needs to exist.
  const file = path.join(wsRoot, 'importer.uc');
  let lspServer, getHover;

  before(async function() {
    lspServer = createLSPTestServer({ workspaceRoot: wsRoot });
    await lspServer.initialize();
    getHover = lspServer.getHover;
  });

  after(function() {
    if (lspServer) lspServer.shutdown();
  });

  // Assign the call result to a (>=2-char) local and hover the local. VS Code-style
  // hover is positionally flaky (empty on some columns within the same identifier),
  // so scan every column across the name and take the first non-empty result — the
  // server returns the correct type, the emptiness is a render-position artifact.
  async function hoverType(code, lineIdx, name) {
    const start = code.split('\n')[lineIdx].indexOf(name);
    for (let col = start; col <= start + name.length; col++) {
      const h = await getHover(code, file, lineIdx, col);
      const line = (typeof h?.contents === 'string' ? h.contents : h?.contents?.value || '').split('\n')[0];
      if (line) return line;
    }
    return '';
  }

  it('namespace member with @returns JSDoc propagates (object | null, was unknown)', async function() {
    const code = [
      "import * as session from './lib/session.uc';",
      "let sess = session.get('x');",
      ''
    ].join('\n');
    const t = await hoverType(code, 1, 'sess');
    assert.ok(/object/.test(t) && /null/.test(t), `expected object|null, got: ${JSON.stringify(t)}`);
  });

  it('namespace member without JSDoc still gets body-inferred return (null | integer)', async function() {
    const code = [
      "import * as session from './lib/session.uc';",
      "let cnt = session.tally(1);",
      ''
    ].join('\n');
    const t = await hoverType(code, 1, 'cnt');
    assert.ok(/integer/.test(t) && /null/.test(t), `expected null|integer, got: ${JSON.stringify(t)}`);
  });

  it('namespace member that is a function-valued const export carries its return', async function() {
    const code = [
      "import * as session from './lib/session.uc';",
      "let nm = session.name_of('a');",
      ''
    ].join('\n');
    const t = await hoverType(code, 1, 'nm');
    assert.ok(/string/.test(t), `expected string, got: ${JSON.stringify(t)}`);
  });

  it('named import of a function with @returns JSDoc prefers it over body inference', async function() {
    const code = [
      "import { get } from './lib/session.uc';",
      "let sess = get('x');",
      ''
    ].join('\n');
    const t = await hoverType(code, 1, 'sess');
    // Body inference alone would yield `null | unknown` (json() is unknown);
    // the JSDoc @returns {object|null} must win.
    assert.ok(/object/.test(t) && /null/.test(t) && !/unknown/.test(t),
      `expected object|null (no unknown), got: ${JSON.stringify(t)}`);
  });

  // Regression: the resolved type must FLOW to downstream read sites, not just the
  // declaration. The SSA history (read by hover at use sites) is populated by the
  // typeChecker, which dropped union return hints like "object | null" to UNKNOWN —
  // so `sess` reverted to `unknown` at every use after the declaration.
  it('namespace-member return type flows to downstream read sites (inside a function)', async function() {
    const code = [
      "import * as session from './lib/session.uc';",
      "function do_call(sid) {",
      "    let sess = session.get(sid);",
      "    let alias = sess;",
      "    return sess;",
      "}",
      ''
    ].join('\n');
    const atDecl  = await hoverType(code, 2, 'sess');
    const atAlias = await hoverType(code, 3, 'sess');   // read on the RHS of `let alias = sess`
    const atRet   = await hoverType(code, 4, 'sess');   // read in `return sess`
    assert.ok(/object/.test(atDecl) && /null/.test(atDecl), `decl: ${JSON.stringify(atDecl)}`);
    assert.ok(/object/.test(atAlias) && /null/.test(atAlias) && !/unknown/.test(atAlias),
      `downstream read (alias) must keep object|null, got: ${JSON.stringify(atAlias)}`);
    assert.ok(/object/.test(atRet) && /null/.test(atRet) && !/unknown/.test(atRet),
      `downstream read (return) must keep object|null, got: ${JSON.stringify(atRet)}`);
  });

  it('downstream member access on the (object|null) result is flagged possibly-null (UC5006)', async function() {
    const code = [
      "import * as session from './lib/session.uc';",
      "function do_call(sid) {",
      "    let sess = session.get(sid);",
      "    return sess.timeout;",   // sess is object|null → unguarded access
      "}",
      ''
    ].join('\n');
    const diags = await lspServer.getDiagnostics(code, file);
    const nullWarn = diags.find(d => d.code === 'UC5006' && /sess/.test(d.message));
    assert.ok(nullWarn, `expected UC5006 on sess.timeout, got: ${JSON.stringify(diags.map(d => d.code))}`);
  });
});
