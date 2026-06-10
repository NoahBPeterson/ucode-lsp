// auto-docs/02: importing a symbol whose name matches a ucode builtin (assert, split,
// keys, match, …) raised a false UC3001 "already declared", and the builtin then shadowed
// the import so member/call checks used the builtin. An import legally shadows a builtin
// (verified vs the interpreter) and must win for resolution.
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLSPTestServer } = require('./lsp-test-helpers');

setDefaultTimeout(20000);
let server, dir, n = 0;
beforeAll(async () => {
  server = createLSPTestServer();
  await server.initialize();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-builtin-'));
  fs.writeFileSync(path.join(dir, 'lib.uc'),
    'let assert = { match: function(a, b) { return a == b; }, equal: function(a, b) { return a == b; } };\n' +
    'function split(s) { return [s]; }\n' +
    'function myhelper(x) { return x; }\n' +
    'export { assert, split, myhelper };\n');
});
afterAll(() => { try { server.shutdown(); } catch {} try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

// run consumer code as a file in the fixture dir so `./lib.uc` resolves
const errs = async (code) => (await server.getDiagnostics(code, path.join(dir, `consumer-${n++}.uc`)) || []).filter((x) => x.severity === 1).map((x) => x.message);
const msgs = async (code) => (await server.getDiagnostics(code, path.join(dir, `consumer-${n++}.uc`)) || []).map((x) => `${x.severity} ${x.message}`);

// ── No false UC3001 on a builtin-named import ────────────────────────────────
test('01 importing `assert` (a builtin name) raises no UC3001', async () => {
  expect((await errs('import { assert } from "./lib.uc";\nassert.match(1, 1);\n')).some((m) => /already declared/.test(m))).toBe(false);
});
test('02 importing several builtin-named symbols at once: none flagged', async () => {
  expect((await errs('import { assert, split } from "./lib.uc";\nassert.equal(1,1);\nsplit("x");\n')).some((m) => /already declared/.test(m))).toBe(false);
});

// ── The import wins over the builtin for resolution ──────────────────────────
test('03 `assert.match` resolves to the imported object (no "does not exist on function type")', async () => {
  expect((await errs('import { assert } from "./lib.uc";\nassert.match(1, 1);\n')).some((m) => /does not exist on function type/.test(m))).toBe(false);
});
test('04 an imported function shadowing `split` uses ITS signature, not the builtin arity', async () => {
  // builtin split needs >=2 args; the imported split(s) takes 1 — must not flag arity
  expect((await errs('import { split } from "./lib.uc";\nsplit("x");\n')).some((m) => /split.*expects at least 2/.test(m))).toBe(false);
});
test('05 the whole demo shape is clean (no errors)', async () => {
  const code = 'import { assert, split } from "./lib.uc";\nassert.match(1, 1);\nassert.equal(2, 2);\nprint(split("x"), "\\n");\n';
  expect(await errs(code)).toEqual([]);
});

// ── Soundness preserved ──────────────────────────────────────────────────────
test('06 an unresolvable module is still flagged (and does not cascade into member errors)', async () => {
  const all = await msgs('import { assert } from "./does-not-exist.uc";\nassert.match(1, 1);\n');
  expect(all.some((x) => /find module|Cannot (find|resolve)|UC3002/i.test(x))).toBe(true);  // real missing-module diagnostic preserved
  expect(all.some((x) => /does not exist on function type/.test(x))).toBe(false);            // no builtin-shadow cascade
});
test('07 a real duplicate import of the same name is still UC3001', async () => {
  const m = await errs('import { assert } from "./lib.uc";\nimport { assert } from "./lib.uc";\n');
  expect(m.some((x) => /already declared/.test(x))).toBe(true);
});
test('08 a non-builtin-named import still works (regression)', async () => {
  expect((await errs('import { myhelper } from "./lib.uc";\nmyhelper(1);\n')).some((m) => /already declared|does not exist/.test(m))).toBe(false);
});
test('09 importing `assert` does not emit a builtin-shadowing warning either', async () => {
  const m = await msgs('import { assert } from "./lib.uc";\nassert.match(1,1);\n');
  expect(m.some((x) => /shadows builtin|UC1008/.test(x))).toBe(false);
});

// ── `let` shadowing a builtin is unchanged (the fix is import-only) ───────────
test('10 `let assert = …` shadowing a builtin still resolves to the local (regression)', async () => {
  // not an import — should not error out; local wins
  expect((await errs('let assert = { match: function(a,b){ return a==b; } };\nassert.match(1,1);\n')).some((m) => /does not exist on function type/.test(m))).toBe(false);
});

// ── A function DECLARATION named like a builtin legally shadows it ────────────
test('11 `function split(s) {…}` (a builtin name) raises no UC1007 "already declared"', async () => {
  expect((await errs('function split(s) { return [s]; }\n')).some((m) => /already declared in this scope/.test(m))).toBe(false);
});
test('12 a builtin-named local function is called with ITS arity, not the builtin\'s', async () => {
  // local split(s) takes 1 arg; the builtin needs >=2 — must not flag the 1-arg call
  expect((await errs('function split(s) { return [s]; }\nprint(split("x"), "\\n");\n')).some((m) => /split.*expects at least 2/.test(m))).toBe(false);
});
test('13 the export-library shape (object + function, both builtin-named) has no errors', async () => {
  const code = 'let assert = { match: function(a,b){ return a==b; } };\nfunction split(s) { return [s]; }\nexport { assert, split };\n';
  expect(await errs(code)).toEqual([]); // (a UC1008 "shadows builtin" *warning* on `let assert` is separate/by-design)
});

// ── Hover reflects the local shadow, not the builtin ─────────────────────────
async function hoverAt(code, marker, id) {
  const mi = code.lastIndexOf(marker);
  const i = mi + marker.indexOf(id);
  const pre = code.slice(0, i);
  const line = (pre.match(/\n/g) || []).length;
  const col = i - (pre.lastIndexOf('\n') + 1);
  const h = await server.getHover(code, path.join(dir, `consumer-${n++}.uc`), line, col);
  const v = h && h.contents && (h.contents.value || h.contents);
  return (typeof v === 'string' ? v : JSON.stringify(v || ''));
}
test('14 hover on a `let` that shadows a builtin shows the local, not the builtin', async () => {
  const t = await hoverAt('let assert = { match: function(a,b){ return a==b; } };\nlet z = assert;\n', 'let assert', 'assert');
  expect(t).toContain('object');
  expect(t).not.toMatch(/built-in function/);
});
test('15 hover on a USAGE of the shadowing local shows the local', async () => {
  const code = 'let assert = { match: function(a,b){ return a==b; } };\nlet z = assert;\n';
  const t = await hoverAt(code, 'z = assert', 'assert');
  expect(t).toContain('object');
  expect(t).not.toMatch(/built-in function/);
});
test('16 hover on a function that shadows a builtin shows the function, not the builtin', async () => {
  const t = await hoverAt('function split(s) { return [s]; }\nlet z = split;\n', 'z = split', 'split');
  expect(t).toContain('function');
  expect(t).not.toMatch(/built-in function/);
});
test('17 the still-genuine builtin (not shadowed) still hovers as the builtin (regression)', async () => {
  const t = await hoverAt('let x = length([1,2]);\nprint(length);\n', 'print(length', 'length');
  expect(t).toMatch(/built-in|length/);
});
