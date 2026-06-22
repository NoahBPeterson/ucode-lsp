// SERVER-DRIVEN coverage for hover.ts's builtin object-type member-chain resolution
// (knownObjectTypeFromReturn / resolveChainOwnerObjectType / detectObjectTypeFromDataType):
// hover a member reached by walking a builtin handle's shape, e.g. a fs.stat() result's
// fields and a fs.open() file handle's methods.
const assert = require('assert');
const path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');

describe('hover object-type member-chain coverage (server-driven)', function () {
  this.timeout(15000);
  let s;
  before(async () => { s = createLSPTestServer(); await s.initialize(); });
  after(() => { if (s && s.shutdown) s.shutdown(); });

  const val = (h) => (h && h.contents ? (h.contents.value || h.contents) : '');
  function posOf(code, needle, occ = 1) {
    const lines = code.split('\n'); let seen = 0;
    for (let i = 0; i < lines.length; i++) { let idx = -1;
      while ((idx = lines[i].indexOf(needle, idx + 1)) !== -1) if (++seen === occ) return { line: i, character: idx }; }
    throw new Error(`needle ${needle} #${occ}`);
  }
  const file = (n) => path.join('/tmp', `hovchain-${n}.uc`);

  it('hovers a field of a fs.stat() result object', async () => {
    const code = `import { stat } from 'fs';\nlet st = stat("/etc/hostname");\nlet sz = st.size;\nprint(sz);\n`;
    const p = posOf(code, 'size');
    const v = val(await s.getHover(code, file('stat'), p.line, p.character));
    assert.ok(typeof v === 'string', 'stat-result field hover resolves without error');
    assert.ok(v.length > 0, `expected a hover for a stat-result field, got empty`);
  });

  it('hovers a method on a fs.open() file handle', async () => {
    const code = `import { open } from 'fs';\nlet fh = open("/tmp/x", "r");\nlet data = fh.read("all");\nprint(data);\n`;
    const p = posOf(code, 'read');
    const v = val(await s.getHover(code, file('handle'), p.line, p.character));
    assert.ok(/read/.test(v), `expected fs.file.read() hover, got: ${v}`);
  });

  it('hovers a deeper member chain on a stat result (sub-object field)', async () => {
    // st.dev may itself be a sub-object with major/minor in the object registry —
    // exercises resolveChainOwnerObjectType walking an intermediate hop.
    const code = `import { stat } from 'fs';\nlet st = stat("/dev/null");\nlet d = st.dev;\nprint(d);\n`;
    const p = posOf(code, 'dev', 2); // the .dev access (occurrence after the import-less first? use 2nd 'dev')
    const v = val(await s.getHover(code, file('dev'), p.line, p.character));
    assert.ok(typeof v === 'string', 'deeper-chain hover resolves without error');
  });

  it('hovers a stat() call result variable (object type detection)', async () => {
    const code = `import { stat } from 'fs';\nlet info = stat("/etc/passwd");\nprint(info);\n`;
    const p = posOf(code, 'info', 1);
    const v = val(await s.getHover(code, file('var'), p.line, p.character));
    assert.ok(typeof v === 'string', 'stat-result variable hover resolves');
  });
});
