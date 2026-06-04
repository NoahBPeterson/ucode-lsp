// Signature help for factory-returned methods: `sh.exec(…)` where `sh = create_sys(…)`.
// The method's params are read from the factory's source-file definition.
const { test, expect, afterEach } = require('bun:test');
const path = require('path');
const fs = require('fs');
const { createLSPTestServer } = require('./lsp-test-helpers');

const ws = '/tmp/test-sig-suite';
function writeFiles(files) {
  fs.mkdirSync(ws, { recursive: true });
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(ws, name), content);
}
afterEach(() => { try { fs.rmSync(ws, { recursive: true, force: true }); } catch {} });

async function sigLabels(openName, line, afterText) {
  const s = createLSPTestServer({ workspaceRoot: ws });
  try {
    await s.initialize();
    const fp = path.join(ws, openName);
    const content = fs.readFileSync(fp, 'utf8');
    const ch = content.split('\n')[line].indexOf(afterText) + afterText.length;
    const sh = await s.getSignatureHelp(content, fp, line, ch);
    return (sh && sh.signatures ? sh.signatures.map((x) => x.label) : []);
  } finally {
    s.shutdown();
  }
}

test('cross-file factory method shows its params', async () => {
  writeFiles({
    'sys.uc': `export default function create_sys(fs, pkg) {\n    return { exec: function(cmd, timeout) { return ""; } };\n}\n`,
    'main.uc': `import create_sys from './sys';\nlet sh = create_sys(1, 2);\nlet r = sh.exec();\n`,
  });
  const labels = await sigLabels('main.uc', 2, 'exec(');
  expect(labels).toContain('sh.exec(cmd, timeout)');
});

test('a rest parameter on a factory method is shown with ...', async () => {
  writeFiles({
    'lib.uc': `export function make() {\n    return { run: function(first, ...rest) { return first; } };\n}\n`,
    'main.uc': `import { make } from './lib';\nlet w = make();\nlet r = w.run();\n`,
  });
  const labels = await sigLabels('main.uc', 2, 'run(');
  expect(labels).toContain('w.run(first, ...rest)');
});

// NOTE: same-file factory methods (`let w = make(); w.run()` with make local) do
// NOT yet show signature help — the analyzer's local factory inference records
// member return types but not member definition locations (only the cross-file
// FileResolver path does). Tracked as a follow-up; the imported-factory case above
// is the actual frontier gap and works.
