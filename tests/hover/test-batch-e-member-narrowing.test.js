// Ticket 139: hovering a KNOWN object-literal member path inside a truthiness guard
// must show the narrowed type, not the un-narrowed assignment-history type.
// `let o = { x: readfile('/a') }; if (o.x) { o.x }` → hover `o.x` inside the guard = string.
import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
const { createLSPTestServer } = require('../lsp-test-helpers');

let server, getHover;
let n = 0;
const fp = () => `/tmp/batchE-mem-${n++}.uc`;

function typeFrom(h) {
  const t = h && (typeof h.contents === 'string' ? h.contents : h.contents.value);
  return t ? (t.replace(/\n/g, ' ').match(/`[^`]*`/)?.[0]?.replace(/`/g, '') || '?') : '(none)';
}

beforeAll(async () => {
  server = createLSPTestServer();
  await server.initialize();
  getHover = server.getHover;
});
afterAll(() => { try { server.shutdown(); } catch {} });

describe('139: member hover narrows inside a truthiness guard', () => {
  const code = [
    "import { readfile } from 'fs';",
    "let o = { x: readfile('/a') };",
    "if (o.x) { substr(o.x, 0, 2); o.x; }",
  ].join('\n');

  test('o.x inside the guard (substr arg) hovers as string (not string | null)', async () => {
    // Target the `x` of `o.x` in `substr(o.x, ...)` — this is inside the consequent,
    // where the narrowing applies (NOT the guard test's own `o.x`).
    const line2 = code.split('\n')[2];
    const col = line2.indexOf('substr(o.x') + 'substr(o.'.length;
    const h = await getHover(code, fp(), 2, col);
    expect(typeFrom(h)).toBe('string');
  });

  test('bare o.x after the substr also hovers as string', async () => {
    const line2 = code.split('\n')[2];
    const col = line2.lastIndexOf('o.x') + 2;
    const h = await getHover(code, fp(), 2, col);
    expect(typeFrom(h)).toBe('string');
  });

  test('outside any guard, o.x hovers as string | null', async () => {
    const code2 = [
      "import { readfile } from 'fs';",
      "let o = { x: readfile('/a') };",
      "let y = o.x;",
    ].join('\n');
    const col = code2.split('\n')[2].indexOf('o.x') + 2;
    const h = await getHover(code2, fp(), 2, col);
    expect(typeFrom(h)).toBe('string | null');
  });
});
