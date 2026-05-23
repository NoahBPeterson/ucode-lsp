// E2e hover coverage for exception object properties, via the spawned server.
// Exercises exceptionTypes.ts: formatPropertyDoc (incl. the `stacktrace` special
// doc) through member access on a catch param, and exceptionTypeRegistry.
// getPropertyDocumentation through a bare identifier matching a property name.

import { test, expect, describe, beforeAll } from 'bun:test';
const { createLSPTestServer } = require('./lsp-test-helpers');

let getHover;
let n = 0;
const fp = (t) => `/tmp/exc-${t}-${n++}.uc`;
const text = (h) => (!h || !h.contents) ? '' : (typeof h.contents === 'string' ? h.contents : (h.contents.value || ''));
function posOf(code, sub, occ = 1) {
  let i = -1;
  for (let k = 0; k < occ; k++) { i = code.indexOf(sub, i + 1); if (i === -1) throw new Error('not found: ' + sub); }
  const pre = code.slice(0, i);
  return { line: (pre.match(/\n/g) || []).length, character: i - (pre.lastIndexOf('\n') + 1) + 1 };
}

beforeAll(async () => {
  const server = createLSPTestServer();
  await server.initialize();
  getHover = server.getHover;
});

describe('Exception property hover/completion (e2e)', () => {
  // Bare identifier matching an exception property name (not a declared symbol):
  // reaches the exceptionTypeRegistry.getPropertyDocumentation fallback.
  test('bare `stacktrace` → exception property doc (registry fallback)', async () => {
    const code = 'print(stacktrace);\n';
    const p = posOf(code, 'stacktrace');
    const h = await getHover(code, fp('bare'), p.line, p.character);
    expect(text(h)).toContain('exception property');
  });

  test('bare `message` → exception property doc (registry fallback)', async () => {
    const code = 'print(message);\n';
    const p = posOf(code, 'message');
    const h = await getHover(code, fp('barem'), p.line, p.character);
    expect(text(h).toLowerCase()).toContain('error message');
  });

});

// NOTE: exceptionTypes.formatPropertyDoc (incl. the rich `stacktrace` stack-frame
// doc) and the exceptionObjectType registry are unreachable through the server:
// catch params are typed as a plain OBJECT (createExceptionObjectDataType returns
// UcodeType.OBJECT), never the 'exception' KnownObjectType, so neither member
// hover nor `e.` completion routes to OBJECT_REGISTRIES['exception']. Covering
// that would require typing catch params as the exception object type — a
// behavior change out of scope here.
