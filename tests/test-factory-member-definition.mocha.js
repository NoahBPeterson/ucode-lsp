const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLSPTestServer } = require('./lsp-test-helpers');

// Go-to-definition + rich hover on factory-returned members reached through a
// `@param {import('./sys.uc')}` annotation. The factory `create_sys` returns
// { quote, exec } where each is a local function; `sh.exec` should jump to
// `exec` in sys.uc and hover should show the method's inferred return type.
describe('Factory-returned member: go-to-definition + hover', function () {
  this.timeout(15000);

  let lspServer;
  let getDefinition;
  let getHover;
  let getCompletions;
  let tmpDir;
  let sysFile;
  let consumerFile;

  const itemList = (res) => (Array.isArray(res) ? res : (res && res.items) || []);

  const SYS_SRC = `function create_sys(fs_mod) {
\tfunction quote(s) {
\t\treturn "'" + s + "'";
\t}
\tfunction exec(cmd) {
\t\tlet data = "output";
\t\treturn trim(data);
\t}
\treturn { quote, exec };
}
export default create_sys;
`;

  before(async function () {
    lspServer = createLSPTestServer();
    await lspServer.initialize();
    getDefinition = lspServer.getDefinition;
    getHover = lspServer.getHover;
    getCompletions = lspServer.getCompletions;

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ucode-factory-'));
    sysFile = path.join(tmpDir, 'sys.uc');
    consumerFile = path.join(tmpDir, 'nft.uc');
    fs.writeFileSync(sysFile, SYS_SRC);
  });

  after(function () {
    try { fs.unlinkSync(sysFile); } catch (e) {}
    try { fs.unlinkSync(consumerFile); } catch (e) {}
    try { fs.rmdirSync(tmpDir); } catch (e) {}
    if (lspServer) lspServer.shutdown();
  });

  // Consumer: `sh` typed via the factory's default export. `sh.exec` on line 2.
  //   line 0: /** @param {import('./sys.uc')} sh */
  //   line 1: function create_nft(sh) {
  //   line 2: \tlet r = sh.exec("ls");
  const CONSUMER = `/** @param {import('./sys.uc')} sh */
function create_nft(sh) {
\tlet r = sh.exec("ls");
\treturn r;
}
`;
  // char of 'exec' on line 2: "\tlet r = sh.exec" → tab(0) l(1)e(2)t(3) (4)r(5) (6)=(7) (8)s(9)h(10).(11)e(12)
  const EXEC_LINE = 2;
  const EXEC_CHAR = 13; // inside "exec"

  it('go-to-definition on sh.exec lands in sys.uc', async () => {
    const def = await getDefinition(CONSUMER, consumerFile, EXEC_LINE, EXEC_CHAR);
    assert.ok(def, 'expected a definition result for sh.exec');
    const loc = Array.isArray(def) ? def[0] : def;
    assert.ok(loc && loc.uri, 'definition should have a uri');
    assert.ok(loc.uri.endsWith('sys.uc'), `definition uri should be sys.uc, got: ${loc.uri}`);

    // The range should point at the `exec` function declaration in sys.uc.
    const sysText = fs.readFileSync(sysFile, 'utf-8');
    const lines = sysText.split('\n');
    const targetLine = lines[loc.range.start.line];
    assert.ok(
      targetLine.includes('exec'),
      `definition range should land on the exec declaration, got line: "${targetLine}"`
    );
  });

  it('hover on sh.exec shows method + inferred return type + defined-in', async () => {
    const hover = await getHover(CONSUMER, consumerFile, EXEC_LINE, EXEC_CHAR);
    assert.ok(hover && hover.contents, 'expected a hover result for sh.exec');
    const text = typeof hover.contents === 'string' ? hover.contents : (hover.contents.value || '');
    assert.ok(text.includes('exec'), `hover should mention exec, got: ${text}`);
    assert.ok(text.includes('string'), `hover should show inferred return type string, got: ${text}`);
    assert.ok(/function/i.test(text), `hover should label exec as callable, got: ${text}`);
    assert.ok(text.includes('sys.uc'), `hover should note it is defined in sys.uc, got: ${text}`);
  });

  it('go-to-definition on an unknown member returns nothing', async () => {
    // line 2 here is "\tlet r = sh.nope();" → 'nope' at same char offset as exec.
    const src = `/** @param {import('./sys.uc')} sh */
function create_nft(sh) {
\tlet r = sh.nope();
\treturn r;
}
`;
    const def = await getDefinition(src, consumerFile, 2, 13);
    const empty = def === null || def === undefined || (Array.isArray(def) && def.length === 0);
    assert.ok(empty, `unknown member should yield no definition, got: ${JSON.stringify(def)}`);
  });

  // --- Discoverability: completion inside @param {} ---

  it('completion in @param {} offers import() for sibling .uc modules', async () => {
    // line 0: "/** @param {} x */" — cursor right after the `{` (char 12).
    const src = `/** @param {} x */
function f(x) { return x; }
`;
    const res = await getCompletions(src, consumerFile, 0, 12);
    const labels = itemList(res).map(i => i.label);
    assert.ok(
      labels.includes("import('./sys.uc')"),
      `expected an import('./sys.uc') completion, got: ${JSON.stringify(labels)}`
    );
    // The static generic snippet should still be present as a fallback.
    assert.ok(
      labels.some(l => l === "import('module').type"),
      `expected the generic import() snippet, got: ${JSON.stringify(labels)}`
    );
  });

  it('completion inside import(\'\') offers ./-prefixed file paths (so they resolve)', async () => {
    // line 0: "/** @param {import('')} x */" — cursor inside the quotes (char 20).
    const src = `/** @param {import('')} x */
function f(x) { return x; }
`;
    const res = await getCompletions(src, consumerFile, 0, 20);
    const items = itemList(res);
    const sys = items.find(i => i.label === './sys.uc');
    assert.ok(
      sys,
      `expected a ./sys.uc file-path completion inside import(''), got: ${JSON.stringify(items.map(i => i.label))}`
    );
    // A bare 'sys.uc' would warn (UC7001) — the inserted text must be relative,
    // while the filter text stays bare so a typed "s" still matches.
    assert.strictEqual(sys.insertText, './sys.uc', `insertText should be ./-prefixed, got: ${sys.insertText}`);
    assert.strictEqual(sys.filterText, 'sys.uc', `filterText should be the bare name, got: ${sys.filterText}`);
  });

  it('completion inside import(\'./\') does not double-prefix', async () => {
    // line 0: "/** @param {import('./')} x */" — cursor after the slash (char 22).
    const src = `/** @param {import('./')} x */
function f(x) { return x; }
`;
    const res = await getCompletions(src, consumerFile, 0, 22);
    const labels = itemList(res).map(i => i.label);
    assert.ok(
      labels.includes('sys.uc') && !labels.includes('././sys.uc'),
      `with ./ already typed, expect bare 'sys.uc' append (no double ./), got: ${JSON.stringify(labels)}`
    );
  });

  // --- go-to-definition on a factory-returned VALUE member via a local binding,
  //     where a same-named local would otherwise shadow it (pbr's platform.env). ---

  it('go-to-definition on a factory-returned member resolves through a local binding even when a same-named local exists', async () => {
    const platFile = path.join(tmpDir, 'platform.uc');
    fs.writeFileSync(platFile, `function create_platform(fs_mod) {
\tlet env = { board_name: "x" };
\tfunction detect() { return 1; }
\treturn { env, detect };
}
export default create_platform;
`);
    // Consumer: `let env = platform.env;` — the local `env` (LHS) must NOT win
    // over the member `platform.env` (RHS) for go-to-definition.
    //   line 3: "\tlet env = platform.env;" → '.'=19, e=20, n=21
    const CONSUMER = `import create_platform from './platform.uc';
function create_pbr() {
\tlet platform = create_platform();
\tlet env = platform.env;
\treturn env;
}
`;
    try {
      const def = await getDefinition(CONSUMER, consumerFile, 3, 21);
      assert.ok(def, 'expected a definition for platform.env');
      const loc = Array.isArray(def) ? def[0] : def;
      assert.ok(loc && loc.uri.endsWith('platform.uc'),
        `platform.env should resolve into platform.uc, got: ${loc && loc.uri}`);
      const platText = fs.readFileSync(platFile, 'utf-8');
      const targetLine = platText.split('\n')[loc.range.start.line];
      assert.ok(/\benv\b/.test(targetLine),
        `definition should land on the env member in the factory, got line: "${targetLine}"`);
    } finally {
      try { fs.unlinkSync(platFile); } catch (e) {}
    }
  });
});
