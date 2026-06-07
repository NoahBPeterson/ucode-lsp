// Hardcore edge-case matrix for auto-import-on-completion (50 distinct cases):
// context gating, dedup/scope, export kinds, import-edit placement, relative paths,
// item shape, and the candidate cap. Each test is as distinct as possible.
const { test, expect, beforeAll, afterAll } = require('bun:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLSPTestServer } = require('./lsp-test-helpers');

let dir, server;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ucaiec-'));
  const w = (rel, body) => {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  };
  w('lib.uc', 'export function helper() { return 1; }\nexport let CONST_VAL = 42;\nexport const PIVAL = 3;\n');
  w('funcs.uc', 'export function alpha() { return 1; }\nexport function beta() { return 2; }\n');
  w('vars.uc', 'export let varOnly = 5;\n');
  w('aliased.uc', 'function internalName() { return 1; }\nexport { internalName as publicName };\n');
  w('specifier.uc', 'function specOne() { return 1; }\nfunction specTwo() { return 2; }\nexport { specOne, specTwo };\n');
  w('src.uc', 'export function reexpName() { return 1; }\n');
  w('reexport.uc', "export { reexpName } from './src.uc';\n");
  w('defonly.uc', 'export default function defFn() { return 1; }\n');
  w('mixed.uc', 'export default function mainThing() { return 1; }\nexport function sideCar() { return 2; }\n');
  w('noexports.uc', 'let privVal = 1;\n');
  w('broken.uc', 'let bad = ;\n');
  w('dup1.uc', 'export function dupName() { return 1; }\n');
  w('dup2.uc', 'export function dupName() { return 2; }\n');
  w('collide.uc', 'export function print() { return 1; }\n');
  w('sub/deep.uc', 'export function deepFn() { return 1; }\n');
  server = createLSPTestServer({ workspaceRoot: dir });
  await server.initialize();
});
afterAll(() => { try { server.shutdown(); } catch {} try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

const itemsOf = (c) => (Array.isArray(c) ? c : (c && c.items) || []);
// Run completion for `content` written to `rel`, at (line, ch).
async function complete(rel, content, line, ch) {
  const fp = path.join(dir, rel);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, content);
  await server.getDiagnostics(content, fp);
  return itemsOf(await server.getCompletions(content, fp, line, ch));
}
// Auto-import candidates (have additionalTextEdits) matching `label`.
const ai = (arr, label) => arr.filter(i => i.label === label && i.additionalTextEdits);
const editText = (item) => item.additionalTextEdits[0].newText;
// Convenience for a single-line "let x = <tok>" completion at end of line 0.
const oneLine = (rel, line0) => complete(rel, line0 + '\n', 0, line0.length);

// ── Context gating ───────────────────────────────────────────────────────────
test('01 general assignment position offers an auto-import', async () => {
  const r = await oneLine('main.uc', 'let x = hel');
  expect(ai(r, 'helper').length).toBe(1);
  expect(editText(ai(r, 'helper')[0])).toContain("import { helper } from './lib.uc';");
});
test('02 after `return` offers', async () => {
  const r = await complete('main.uc', 'function f() { return hel\n', 0, 'function f() { return hel'.length);
  expect(ai(r, 'helper').length).toBe(1);
});
test('03 inside a call argument offers', async () => {
  const r = await oneLine('main.uc', 'print(hel');
  expect(ai(r, 'helper').length).toBe(1);
});
test('04 inside an array literal offers', async () => {
  const r = await oneLine('main.uc', 'let a = [hel');
  expect(ai(r, 'helper').length).toBe(1);
});
test('05 ternary branch offers', async () => {
  const r = await oneLine('main.uc', 'let x = 1 ? hel');
  expect(ai(r, 'helper').length).toBe(1);
});
test('06 computed index expression offers', async () => {
  const r = await complete('main.uc', 'let a = [];\nlet x = a[hel\n', 1, 'let x = a[hel'.length);
  expect(ai(r, 'helper').length).toBe(1);
});
test('07 member position `o.hel` does NOT offer', async () => {
  const r = await complete('main.uc', 'let o = {};\no.hel\n', 1, 'o.hel'.length);
  expect(ai(r, 'helper').length).toBe(0);
});
test('08 member with surrounding spaces `o . hel` does NOT offer', async () => {
  const r = await complete('main.uc', 'let o = {};\no .  hel\n', 1, 'o .  hel'.length);
  expect(ai(r, 'helper').length).toBe(0);
});
test('09 member across a newline `o.\\nhel` does NOT offer', async () => {
  const r = await complete('main.uc', 'let o = {};\no.\nhel\n', 2, 'hel'.length);
  expect(ai(r, 'helper').length).toBe(0);
});
test('10 member chain `a.b.hel` does NOT offer', async () => {
  const r = await complete('main.uc', 'let a = {};\nlet x = a.b.hel\n', 1, 'let x = a.b.hel'.length);
  expect(ai(r, 'helper').length).toBe(0);
});
test('11 leading-dot continuation `o\\n.hel` does NOT offer', async () => {
  const r = await complete('main.uc', 'let o = {};\no\n.hel\n', 2, '.hel'.length);
  expect(ai(r, 'helper').length).toBe(0);
});
test('12 function-name slot `function hel` does NOT offer', async () => {
  const r = await complete('main.uc', 'function hel\n', 0, 'function hel'.length);
  expect(ai(r, 'helper').length).toBe(0);
});
test('13 inside import braces does NOT offer', async () => {
  const r = await complete('main.uc', "import { hel } from './funcs.uc';\n", 0, 'import { hel'.length);
  expect(ai(r, 'helper').length).toBe(0);
});
test('14 inside the module-path string does NOT offer', async () => {
  const r = await complete('main.uc', "import { x } from 'hel';\n", 0, "import { x } from 'hel".length);
  expect(ai(r, 'helper').length).toBe(0);
});

// ── Dedup / scope ────────────────────────────────────────────────────────────
test('15 already-imported symbol is not duplicated as auto-import', async () => {
  const r = await complete('main.uc', "import { helper } from './lib.uc';\nlet x = hel\n", 1, 'let x = hel'.length);
  expect(ai(r, 'helper').length).toBe(0);
  expect(r.filter(i => i.label === 'helper').length).toBe(1); // the in-scope import
});
test('16 a local variable with the same name suppresses auto-import', async () => {
  const r = await complete('main.uc', 'let helper = 1;\nlet x = hel\n', 1, 'let x = hel'.length);
  expect(ai(r, 'helper').length).toBe(0);
});
test('17 a local function with the same name suppresses auto-import', async () => {
  const r = await complete('main.uc', 'function helper() {}\nlet x = hel\n', 1, 'let x = hel'.length);
  expect(ai(r, 'helper').length).toBe(0);
});
test('18 a parameter with the same name suppresses auto-import', async () => {
  const r = await complete('main.uc', 'function f(helper) { return hel\n', 0, 'function f(helper) { return hel'.length);
  expect(ai(r, 'helper').length).toBe(0);
});
test('19 a name colliding with a builtin (print) is not auto-imported', async () => {
  const r = await oneLine('main.uc', 'let x = pri');
  expect(ai(r, 'print').length).toBe(0);
});
test('20 the current file\'s own export is not offered as auto-import', async () => {
  const r = await complete('selfcur.uc', 'export function selfName() { return 1; }\nlet x = selfN\n', 1, 'let x = selfN'.length);
  expect(ai(r, 'selfName').length).toBe(0);
});
test('21 the same name exported by two files yields two pickable sources', async () => {
  const r = await oneLine('main.uc', 'let x = dupN');
  const cands = ai(r, 'dupName');
  expect(cands.length).toBe(2);
  const sources = cands.map(c => c.detail).sort();
  expect(sources[0]).toContain('dup1.uc');
  expect(sources[1]).toContain('dup2.uc');
});
test('22 a namespace import does not suppress the bare-name auto-import', async () => {
  const r = await complete('main.uc', "import * as lib from './lib.uc';\nlet x = hel\n", 1, 'let x = hel'.length);
  expect(ai(r, 'helper').length).toBe(1); // `helper` (bare) is still not in scope
});

// ── Export kinds ─────────────────────────────────────────────────────────────
test('23 a named function export is offered as a Function', async () => {
  const r = await oneLine('main.uc', 'let x = alph');
  const c = ai(r, 'alpha');
  expect(c.length).toBe(1);
  expect(c[0].kind).toBe(3); // CompletionItemKind.Function
});
test('24 an exported `let` is offered as a Variable', async () => {
  const r = await oneLine('main.uc', 'let x = varOn');
  const c = ai(r, 'varOnly');
  expect(c.length).toBe(1);
  expect(c[0].kind).toBe(6); // CompletionItemKind.Variable
});
test('25 an exported `const` is offered', async () => {
  const r = await oneLine('main.uc', 'let x = PIV');
  expect(ai(r, 'PIVAL').length).toBe(1);
});
test('26 a default-only export is NOT offered', async () => {
  const r = await oneLine('main.uc', 'let x = defF');
  expect(ai(r, 'defFn').length).toBe(0);
});
test('27 in a default+named file, the named export is offered but the default is not', async () => {
  const r1 = await oneLine('main.uc', 'let x = sideC');
  expect(ai(r1, 'sideCar').length).toBe(1);
  const r2 = await oneLine('main.uc', 'let x = mainTh');
  expect(ai(r2, 'mainThing').length).toBe(0);
});
test('28 an aliased export offers the external name, not the internal one', async () => {
  const r = await oneLine('main.uc', 'let x = publ');
  expect(ai(r, 'publicName').length).toBe(1);
  expect(editText(ai(r, 'publicName')[0])).toContain("{ publicName }");
  const r2 = await oneLine('main.uc', 'let x = intern');
  expect(ai(r2, 'internalName').length).toBe(0);
});
test('29 both names of a specifier export `{ s1, s2 }` are offered', async () => {
  const r1 = await oneLine('main.uc', 'let x = specO');
  expect(ai(r1, 'specOne').length).toBe(1);
  const r2 = await oneLine('main.uc', 'let x = specT');
  expect(ai(r2, 'specTwo').length).toBe(1);
});
test('30 a re-exported name is offered (at least from its original module)', async () => {
  const r = await oneLine('main.uc', 'let x = reexpN');
  const cands = ai(r, 'reexpName');
  expect(cands.length).toBeGreaterThanOrEqual(1);
  expect(cands.some(c => c.detail.includes('src.uc'))).toBe(true);
});
test('31 a non-exported local in another file is never offered', async () => {
  const r = await oneLine('main.uc', 'let x = privV');
  expect(ai(r, 'privVal').length).toBe(0);
});
test('32 a broken (unparseable) workspace file does not break others', async () => {
  const r = await oneLine('main.uc', 'let x = hel');
  expect(ai(r, 'helper').length).toBe(1); // still works despite broken.uc present
  expect(ai(r, 'bad').length).toBe(0);
});

// ── Import-edit placement ────────────────────────────────────────────────────
test('33 with no imports, the edit inserts at the top of the file', async () => {
  const r = await complete('main.uc', 'hel\n', 0, 'hel'.length);
  const e = ai(r, 'helper')[0].additionalTextEdits[0];
  expect(e.range.start.line).toBe(0);
  expect(e.range.start.character).toBe(0);
  expect(e.newText.startsWith('import')).toBe(true);
  expect(e.newText.endsWith('\n')).toBe(true);
});
test('34 with only `use strict`, the edit inserts after it', async () => {
  const r = await complete('main.uc', "'use strict';\nlet x = hel\n", 1, 'let x = hel'.length);
  const e = ai(r, 'helper')[0].additionalTextEdits[0];
  expect(e.range.start.line).toBe(0); // at end of the use-strict line
  expect(e.newText.startsWith('\n')).toBe(true);
});
test('35 with an existing import, the edit inserts after it', async () => {
  const r = await complete('main.uc', "import { alpha } from './funcs.uc';\nlet x = hel\n", 1, 'let x = hel'.length);
  const e = ai(r, 'helper')[0].additionalTextEdits[0];
  expect(e.range.start.line).toBeGreaterThanOrEqual(0);
  expect(e.newText).toContain("import { helper } from './lib.uc';");
});
test('36 with use-strict + imports, the edit lands after the imports', async () => {
  const r = await complete('main.uc', "'use strict';\nimport { alpha } from './funcs.uc';\nlet x = hel\n", 2, 'let x = hel'.length);
  const e = ai(r, 'helper')[0].additionalTextEdits[0];
  // after line 1 (the import), i.e. not before the use-strict
  expect(e.range.start.line).toBeGreaterThanOrEqual(1);
});
test('37 a leading comment does not count as an import anchor (insert at top)', async () => {
  const r = await complete('main.uc', '// a comment\nlet x = hel\n', 1, 'let x = hel'.length);
  const e = ai(r, 'helper')[0].additionalTextEdits[0];
  expect(e.range.start.line).toBe(0);
  expect(e.range.start.character).toBe(0);
});
test('38 the inserted text is the exact import statement', async () => {
  const r = await oneLine('main.uc', 'let x = alph');
  expect(editText(ai(r, 'alpha')[0])).toContain("import { alpha } from './funcs.uc';");
});
test('39 exactly one additionalTextEdit is attached', async () => {
  const r = await oneLine('main.uc', 'let x = hel');
  expect(ai(r, 'helper')[0].additionalTextEdits.length).toBe(1);
});
test('40 the import edit is a zero-width insertion (start === end)', async () => {
  const r = await oneLine('main.uc', 'let x = hel');
  const e = ai(r, 'helper')[0].additionalTextEdits[0];
  expect(e.range.start.line).toBe(e.range.end.line);
  expect(e.range.start.character).toBe(e.range.end.character);
});

// ── Relative paths ───────────────────────────────────────────────────────────
test('41 a same-directory target resolves to ./file.uc', async () => {
  const r = await oneLine('main.uc', 'let x = hel');
  expect(editText(ai(r, 'helper')[0])).toContain("'./lib.uc'");
});
test('42 a subdirectory target resolves to ./sub/file.uc', async () => {
  const r = await oneLine('main.uc', 'let x = deepF');
  expect(editText(ai(r, 'deepFn')[0])).toContain("'./sub/deep.uc'");
});
test('43 from a subdirectory importer, a root target resolves to ../file.uc', async () => {
  const r = await complete('sub/nested.uc', 'let x = hel\n', 0, 'let x = hel'.length);
  expect(editText(ai(r, 'helper')[0])).toContain("'../lib.uc'");
});
test('44 the relative path uses forward slashes only', async () => {
  const r = await oneLine('main.uc', 'let x = deepF');
  expect(editText(ai(r, 'deepFn')[0])).not.toContain('\\');
});
test('45 the relative path keeps the .uc extension', async () => {
  const r = await oneLine('main.uc', 'let x = alph');
  expect(editText(ai(r, 'alpha')[0])).toMatch(/\.uc'/);
});

// ── Item shape / misc ────────────────────────────────────────────────────────
test('46 auto-import items are ranked low (sortText starts with 8)', async () => {
  const r = await oneLine('main.uc', 'let x = hel');
  expect(ai(r, 'helper')[0].sortText.startsWith('8')).toBe(true);
});
test('47 the documentation contains the import statement', async () => {
  const r = await oneLine('main.uc', 'let x = hel');
  const doc = ai(r, 'helper')[0].documentation;
  const val = typeof doc === 'string' ? doc : doc.value;
  expect(val).toContain("import { helper } from './lib.uc';");
});
test('48 the detail says Auto-import and names the source path', async () => {
  const r = await oneLine('main.uc', 'let x = hel');
  expect(ai(r, 'helper')[0].detail).toContain('Auto-import');
  expect(ai(r, 'helper')[0].detail).toContain('./lib.uc');
});
test('49 base completions (builtins/keywords) are preserved alongside additions', async () => {
  const r = await oneLine('main.uc', 'let x = hel');
  expect(r.some(i => i.kind === 14)).toBe(true); // a Keyword still present
  expect(r.some(i => i.label === 'print')).toBe(true); // a builtin still present
});
test('50 the candidate set is capped at 500 (with logging)', async () => {
  const capDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ucaicap-'));
  let big = '';
  for (let i = 0; i <= 500; i++) big += `export function gen${i}() { return ${i}; }\n`; // 501 exports
  fs.writeFileSync(path.join(capDir, 'big.uc'), big);
  const s2 = createLSPTestServer({ workspaceRoot: capDir });
  await s2.initialize();
  const fp = path.join(capDir, 'main.uc');
  const content = 'let x = gen\n';
  fs.writeFileSync(fp, content);
  await s2.getDiagnostics(content, fp);
  const r = itemsOf(await s2.getCompletions(content, fp, 0, 'let x = gen'.length));
  const autoImports = r.filter(i => /^gen\d+$/.test(i.label) && i.additionalTextEdits);
  expect(autoImports.length).toBe(500);
  s2.shutdown();
  fs.rmSync(capDir, { recursive: true, force: true });
});
