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

  // Member hover on a catch param routes to the rich formatPropertyDoc (the
  // isExceptionParam flag is set on the catch-param symbol).
  test('catch param `e.stacktrace` → rich stack-frame doc', async () => {
    const code = 'try {\n  risky();\n} catch (e) {\n  print(e.stacktrace);\n}\n';
    const p = posOf(code, 'stacktrace', 1); // member access (no bare occurrence here)
    const h = await getHover(code, fp('mem-st'), p.line, p.character);
    const doc = text(h);
    expect(doc).toContain('exception property');
    expect(doc).toContain('Stack Frame Structure');
    expect(doc).toContain('filename');
    expect(doc).toContain('context');
  });

  test('catch param `e.message` → exception property doc (rich path)', async () => {
    const code = 'try {\n  risky();\n} catch (e) {\n  print(e.message);\n}\n';
    const p = posOf(code, 'message');
    const h = await getHover(code, fp('mem-msg'), p.line, p.character);
    const doc = text(h);
    expect(doc).toContain('exception property');
    expect(doc.toLowerCase()).toContain('error message');
    // message is not stacktrace → no stack-frame block
    expect(doc).not.toContain('Stack Frame Structure');
  });

  test('differently-named catch param `err.stacktrace` → rich doc', async () => {
    const code = 'try {\n  risky();\n} catch (err) {\n  print(err.stacktrace);\n}\n';
    const p = posOf(code, 'stacktrace');
    const h = await getHover(code, fp('mem-err'), p.line, p.character);
    expect(text(h)).toContain('Stack Frame Structure');
  });

  // A plain object that merely has a property named like an exception field
  // must NOT get the rich exception doc (only catch params are flagged).
  test('non-exception object property is not mistaken for an exception', async () => {
    const code = 'let o = { message: "hi" };\nprint(o.message);\n';
    const p = posOf(code, 'message', 2); // the member access, not the literal key
    const h = await getHover(code, fp('plain'), p.line, p.character);
    expect(text(h)).not.toContain('Error message describing');
  });

  // The bare catch parameter itself (not a member access) should hover richly,
  // not as the generic "(parameter) e: object" — surfacing that it's a catch
  // parameter typed as `exception`, with a usage example up top, the
  // string-coercion note, and the property + stack-frame schemas.
  test('bare catch param → rich (catch parameter) exception hover', async () => {
    const code = 'try {\n  risky();\n} catch (err) {\n  print(err + "\\n");\n}\n';
    const p = posOf(code, 'err + ');
    const h = await getHover(code, fp('bare-err'), p.line, p.character);
    const doc = text(h);
    // Header
    expect(doc).toContain('catch parameter');
    expect(doc).toContain('exception');
    // Typical usage code block is FIRST (above the prose / tables)
    const usageIdx = doc.indexOf('Typical usage');
    const propsIdx = doc.indexOf('Properties');
    expect(usageIdx).toBeGreaterThan(-1);
    expect(propsIdx).toBeGreaterThan(usageIdx); // usage precedes properties
    expect(doc).toContain('for (let frame in err.stacktrace)');
    // Coercion note (between usage and properties)
    expect(doc).toContain('coerces to `err.message`');
    // Property table includes the three known fields with descriptions
    expect(doc).toContain('err.type');
    expect(doc).toContain('err.message');
    expect(doc).toContain('err.stacktrace');
    expect(doc).toContain('Kind of error');
    // Stack-frame schema
    expect(doc).toContain('Stack frame');
    expect(doc).toContain('filename');
    expect(doc).toContain('context');
  });

  // A regular (non-catch) parameter must NOT pick up the exception hover.
  test('regular parameter still shows the plain parameter hover', async () => {
    const code = 'function f(err) { return err; }\nf("x");\n';
    const p = posOf(code, 'err', 2); // the `return err` use (skip the declaration)
    const h = await getHover(code, fp('plain-param'), p.line, p.character);
    expect(text(h)).not.toContain('catch parameter');
  });

});
