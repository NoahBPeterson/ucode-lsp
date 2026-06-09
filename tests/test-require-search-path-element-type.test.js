// REQUIRE_SEARCH_PATH is an array of search-path strings (verified vs the interpreter),
// so it's typed array<string> like ARGV. A for-in element is therefore `string`, and
// match()/string builtins on it type-check (no false "argument is unknown").
const { test, expect, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('./lsp-test-helpers');

setDefaultTimeout(20000);
let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const errs = async (code) => (await server.getDiagnostics(code, `/tmp/rsp-${n++}.uc`) || []).filter((x) => x.severity === 1);
async function typeOf(code, needle) {
  const idx = code.lastIndexOf(needle);
  const pre = code.slice(0, idx);
  const line = (pre.match(/\n/g) || []).length;
  const col = idx - (pre.lastIndexOf('\n') + 1);
  const h = await server.getHover(code, `/tmp/rsp-${n++}.uc`, line, col);
  const v = h && h.contents && (h.contents.value || h.contents);
  return (typeof v === 'string' ? v : JSON.stringify(v || '')).replace(/\n/g, ' ');
}

test('01 for-in over REQUIRE_SEARCH_PATH binds a string element', async () => {
  expect(await typeOf('for (let p in REQUIRE_SEARCH_PATH) { let x = p; }\n', 'p')).toContain('string');
});
test('02 match(pattern, /re/) on a REQUIRE_SEARCH_PATH element type-checks (no UC unknown-arg)', async () => {
  const code = 'for (let pattern in REQUIRE_SEARCH_PATH) { if (match(pattern, /\\.uc$/)) print(pattern); }\n';
  const m = (await errs(code)).map((d) => d.message);
  expect(m.some((x) => /Argument 1 of match/.test(x) || /\bunknown\b/i.test(x))).toBe(false);
});
test('03 REQUIRE_SEARCH_PATH hovers as array<string>', async () => {
  expect(await typeOf('let sp = REQUIRE_SEARCH_PATH;\n', 'REQUIRE_SEARCH_PATH')).toContain('array<string>');
});
