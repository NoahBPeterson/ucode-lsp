// `@param` JSDoc on an object-literal property function/arrow is now captured (anchored
// at the property key) and propagated to the value's params — previously the comment was
// orphaned (the function anchors at `function`, with `key:` in between) so params stayed
// `unknown`. Covers function + arrow values, multiple params, types, position edges, and
// no-regression cases.
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('./lsp-test-helpers');

setDefaultTimeout(20000);
let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const errs = async (code) => (await server.getDiagnostics(code, `/tmp/jop-${n++}.uc`) || []).filter((x) => x.severity === 1);
async function typeOf(code, needle) {
  const idx = code.lastIndexOf(needle);
  const pre = code.slice(0, idx);
  const line = (pre.match(/\n/g) || []).length;
  const col = idx - (pre.lastIndexOf('\n') + 1);
  const h = await server.getHover(code, `/tmp/jop-${n++}.uc`, line, col);
  const v = h && h.contents && (h.contents.value || h.contents);
  return (typeof v === 'string' ? v : JSON.stringify(v || '')).replace(/\n/g, ' ');
}

// ── Core: param gets its JSDoc type ──────────────────────────────────────────
test('01 function-value @param {string} types the param', async () => {
  expect(await typeOf('let o = {\n  /** @param {string} m */\n  f: function(m) { let z = m; }\n};\n', 'z = m')).toContain('string');
});
test('02 arrow-value @param {string} types the param', async () => {
  expect(await typeOf('let o = {\n  /** @param {string} m */\n  f: (m) => { let z = m; }\n};\n', 'z = m')).toContain('string');
});
test('03 the original mocklib case: require(m) no longer "unknown"', async () => {
  const code = 'global.mocklib = {\n  /** @param {string} module */\n  require: function(module) { return require(module); }\n};\n';
  const m = (await errs(code)).map((d) => d.message);
  expect(m.some((x) => /Argument 1 of require/.test(x) || /\bunknown\b/i.test(x))).toBe(false);
});

// ── Types other than string ──────────────────────────────────────────────────
test('04 @param {object} types the param as object', async () => {
  expect(await typeOf('let o = {\n  /** @param {object} cfg */\n  f: function(cfg) { let z = cfg; }\n};\n', 'z = cfg')).toContain('object');
});
test('05 @param {array} types the param as array', async () => {
  expect(await typeOf('let o = {\n  /** @param {array} xs */\n  f: function(xs) { let z = xs; }\n};\n', 'z = xs')).toContain('array');
});

// ── Multiple params ──────────────────────────────────────────────────────────
test('06 multiple @param tags type each param', async () => {
  const code = 'let o = {\n  /**\n   * @param {string} a\n   * @param {object} b\n   */\n  f: function(a, b) { let za = a; let zb = b; }\n};\n';
  expect(await typeOf(code, 'za = a')).toContain('string');
  expect(await typeOf(code, 'zb = b')).toContain('object');
});

// ── Position edges ───────────────────────────────────────────────────────────
test('07 first property (adjacent to `{`) is captured', async () => {
  expect(await typeOf('let o = { /** @param {string} m */ f: function(m) { let z = m; } };\n', 'z = m')).toContain('string');
});
test('08 a later property (after another property + comma) is captured', async () => {
  const code = 'let o = {\n  a: 1,\n  /** @param {string} m */\n  f: function(m) { let z = m; }\n};\n';
  expect(await typeOf(code, 'z = m')).toContain('string');
});
test('09 only the annotated property is typed; an adjacent unannotated one is not', async () => {
  const code = 'let o = {\n  /** @param {string} m */\n  f: function(m) { let zf = m; },\n  g: function(p) { let zg = p; }\n};\n';
  expect(await typeOf(code, 'zf = m')).toContain('string');
  expect(await typeOf(code, 'zg = p')).toContain('unknown');
});

// ── No regression ────────────────────────────────────────────────────────────
test('10 a property function WITHOUT JSDoc keeps unknown params', async () => {
  expect(await typeOf('let o = {\n  f: function(m) { let z = m; }\n};\n', 'z = m')).toContain('unknown');
});
test('11 a plain data property with leading JSDoc does not break a sibling typed method', async () => {
  const code = 'let o = {\n  /** the count */\n  count: 5,\n  /** @param {string} m */\n  f: function(m) { let z = m; }\n};\n';
  expect(await typeOf(code, 'z = m')).toContain('string');
});
test('12 a shorthand property with leading JSDoc parses cleanly (no syntax error)', async () => {
  const code = 'let m = 5;\nlet o = {\n  /** shorthand */\n  m\n};\nlet z = o;\n';
  const e = (await errs(code)).map((d) => d.message);
  expect(e.some((x) => /Expected|Unexpected|syntax/i.test(x))).toBe(false);
});
test('13 nested object method @param is captured', async () => {
  const code = 'let o = {\n  inner: {\n    /** @param {string} m */\n    f: function(m) { let z = m; }\n  }\n};\n';
  expect(await typeOf(code, 'z = m')).toContain('string');
});
