// loadfile(path[, options]) / loadstring(code[, options]) accept an optional ParseConfig
// object (verified vs the interpreter + ucode C source). The arity validators allow 1-2
// args and type the 2nd as an object, and the options object autocompletes the full
// ParseConfig key set (raw_mode, strict_declarations, lstrip_blocks, trim_blocks,
// module_search_path, force_dynlink_list).
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('./lsp-test-helpers');

setDefaultTimeout(20000);
let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const ALL_KEYS = ['lstrip_blocks', 'trim_blocks', 'strict_declarations', 'raw_mode', 'module_search_path', 'force_dynlink_list'];
const labels = (r) => ((r && r.items) || r || []).map((i) => i.label);
const items = (r) => ((r && r.items) || r || []);
async function complete(code, marker, ctx) {
  const at = code.indexOf(marker) + marker.length; // cursor right after `marker`
  const pre = code.slice(0, at);
  const line = (pre.match(/\n/g) || []).length;
  const character = at - (pre.lastIndexOf('\n') + 1);
  return await server.getCompletions(code, `/tmp/lfo-${n++}.uc`, line, character, ctx || { triggerKind: 1 });
}
const errs = async (code) => (await server.getDiagnostics(code, `/tmp/lfo-${n++}.uc`) || []).filter((x) => x.severity === 1).map((x) => x.message);

// ── Autocomplete: all ParseConfig keys ───────────────────────────────────────
test('01 loadfile options object offers ALL ParseConfig keys', async () => {
  const got = labels(await complete('let f = loadfile("x.uc", {  });\n', '{ '));
  for (const k of ALL_KEYS) expect(got).toContain(k);
});
test('02 loadstring options object offers ALL ParseConfig keys', async () => {
  const got = labels(await complete('let f = loadstring("1+1", {  });\n', '{ '));
  for (const k of ALL_KEYS) expect(got).toContain(k);
});
test('03 keys are offered on the `{` trigger character', async () => {
  const got = labels(await complete('let f = loadfile("x.uc", {', '{', { triggerKind: 2, triggerCharacter: '{' }));
  expect(got).toContain('raw_mode');
});
test('04 already-present keys are filtered out; the rest still offered', async () => {
  const got = labels(await complete('let f = loadstring("y", { raw_mode: true,  });\n', 'true, '));
  expect(got).not.toContain('raw_mode');
  expect(got).toContain('trim_blocks');
  expect(got).toContain('strict_declarations');
});
test('05 each suggestion carries a ParseConfig detail + documentation', async () => {
  const its = items(await complete('let f = loadfile("x.uc", {  });\n', '{ ')).filter((i) => ALL_KEYS.includes(i.label));
  expect(its.length).toBe(ALL_KEYS.length);
  expect(its.every((i) => /ParseConfig\./.test(i.detail || '') && i.documentation)).toBe(true);
});

// ── Autocomplete: must NOT fire elsewhere ────────────────────────────────────
test('06 not offered inside an unrelated object literal', async () => {
  expect(labels(await complete('let o = {  };\n', '{ '))).not.toContain('raw_mode');
});
test('07 not offered in value position (after `key:`)', async () => {
  const got = labels(await complete('let f = loadfile("x", { raw_mode:  });\n', 'raw_mode: '));
  expect(got).not.toContain('trim_blocks');
  expect(got).not.toContain('raw_mode');
});
test('08 not offered when the object is the FIRST argument (not the options arg)', async () => {
  expect(labels(await complete('let f = loadfile({  });\n', '{ '))).not.toContain('raw_mode');
});

// ── Validator: arity 1-2 + object 2nd arg ────────────────────────────────────
test('09 loadfile(path, {options}) raises no arity error', async () => {
  expect((await errs('loadfile("x.uc", { raw_mode: true });\n')).some((m) => /expects/.test(m))).toBe(false);
});
test('10 loadstring(code, {options}) raises no arity error', async () => {
  expect((await errs('loadstring("1+1", { strict_declarations: true });\n')).some((m) => /expects/.test(m))).toBe(false);
});
test('11 single-arg loadfile(path) is still fine', async () => {
  expect((await errs('loadfile("x.uc");\n')).some((m) => /loadfile\(\) expects/.test(m))).toBe(false);
});
test('12 loadfile with 3 args is flagged "expects 1-2 arguments"', async () => {
  expect((await errs('loadfile("a", "b", "c");\n')).some((m) => /loadfile\(\) expects 1-2 arguments, got 3/.test(m))).toBe(true);
});
test('13 loadfile(path, <non-object>) flags the 2nd arg', async () => {
  expect((await errs('loadfile("x", 5);\n')).some((m) => /loadfile.*(object|argument 2)/i.test(m))).toBe(true);
});
test('14 loadstring(code, <non-object>) flags the 2nd arg', async () => {
  expect((await errs('loadstring("x", "nope");\n')).some((m) => /loadstring.*(object|argument 2)/i.test(m))).toBe(true);
});

// ── ParseConfig property value types (warnings — ucode coerces/drops, never errors) ──
const warns = async (code) => (await server.getDiagnostics(code, `/tmp/lfo-${n++}.uc`) || []).filter((x) => x.severity === 2).map((x) => x.message);
test('15 boolean key with a string value warns (expects a boolean)', async () => {
  expect((await warns("loadfile('./c.uc', { raw_mode: 'lol' });\n")).some((m) => /'raw_mode' expects a boolean/.test(m))).toBe(true);
});
test('16 boolean key with a boolean value is clean', async () => {
  expect((await warns("loadfile('./c.uc', { raw_mode: true });\n")).some((m) => /raw_mode/.test(m))).toBe(false);
});
test('17 array key with a string value warns (expects an array) — value is silently dropped by ucode', async () => {
  expect((await warns("loadfile('./c.uc', { force_dynlink_list: 'lol' });\n")).some((m) => /'force_dynlink_list' expects an array/.test(m))).toBe(true);
});
test('18 array key with an array value is clean', async () => {
  expect((await warns("loadfile('./c.uc', { module_search_path: ['/x'] });\n")).some((m) => /module_search_path/.test(m))).toBe(false);
});
test('19 boolean key with an integer value warns', async () => {
  expect((await warns("loadstring('1', { strict_declarations: 5 });\n")).some((m) => /'strict_declarations' expects a boolean/.test(m))).toBe(true);
});
test('20 an unknown ParseConfig key warns (likely typo)', async () => {
  expect((await warns("loadfile('./c.uc', { raw_modee: true });\n")).some((m) => /Unknown ParseConfig option 'raw_modee'/.test(m))).toBe(true);
});
test('21 a value of unknown type (a variable) is NOT flagged (could be a boolean at runtime)', async () => {
  expect((await warns("function f(flag){ return loadfile('./c.uc', { raw_mode: flag }); }\n")).some((m) => /raw_mode/.test(m))).toBe(false);
});
test('22 these are warnings, not errors', async () => {
  const e = (await server.getDiagnostics("loadfile('./c.uc', { raw_mode: 'lol' });\n", `/tmp/lfo-${n++}.uc`) || []).filter((x) => x.severity === 1 && /raw_mode/.test(x.message));
  expect(e.length).toBe(0);
});
