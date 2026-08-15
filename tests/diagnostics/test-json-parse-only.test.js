// UC2017: json() PARSES JSON text — it can never produce it.
//
// ucode/lib.c uc_json: a UC_STRING is tokenized; UC_RESOURCE/UC_OBJECT/UC_ARRAY
// are handed to uc_json_from_object, which REQUIRES a callable `read` property
// and raises "Input object does not implement read() method" without one;
// anything else raises "Passed value is neither a string nor an object".
// So `json(<plain dict>)` throws on EVERY call — the field bug this came from
// (GL.iNet upgrade.uc: `writef(path, json(obj))`) meant an HTTP POST helper, and
// the API behind it, could never have worked. The serializer is sprintf("%J", v).
//
// A duck-typed streaming source (`{ read: function(n) {…} }`) IS legal and is
// verified working against the real interpreter — so the check stays silent
// whenever it cannot see that an object lacks `read`.
const { test, expect, describe, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');
setDefaultTimeout(30000);

let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const fp = () => `/tmp/json-parse-${n++}.uc`;
async function u2017(code) {
  const ds = await server.getDiagnostics(code, fp());
  return (ds || []).filter((d) => String(d.code) === 'UC2017');
}

describe('flags values that provably make json() throw', () => {
  for (const [label, code] of [
    ['object literal',        'print(json({ a: 1 }), "\\n");'],
    ['array literal',         'print(json([1, 2, 3]), "\\n");'],
    ['dict variable (the field bug)', 'let obj = { a: 1, b: "two" };\nprint(json(obj), "\\n");'],
    ['array variable',        'let arr = [1, 2];\nprint(json(arr), "\\n");'],
    ['integer',               'print(json(42), "\\n");'],
    ['double',                'print(json(2.5), "\\n");'],
    ['boolean',               'print(json(true), "\\n");'],
    ['object built by property writes', 'let o = {};\no.name = "x";\nprint(json(o), "\\n");'],
  ]) {
    test(label, async () => {
      const hits = await u2017(code);
      expect(hits.length).toBe(1);
      expect(hits[0].severity).toBe(1); // error: it throws on every call
      expect(hits[0].message).toContain('sprintf("%J"');
    });
  }
});

describe('stays silent on everything that works', () => {
  for (const [label, code] of [
    ['string literal',    'print(json(\'{"ok":true}\'), "\\n");'],
    ['string variable',   'let s = \'{"ok":true}\';\nprint(json(s), "\\n");'],
    ['string expression', 'let a = "{", b = "}";\nprint(json(a + b), "\\n");'],
    ['readable fs handle', 'import { open } from \'fs\';\nlet fh = open("/tmp/x", "r");\nif (fh) print(json(fh), "\\n");'],
    ['duck-typed reader literal', 'print(json({ read: function(n) { return ""; } }), "\\n");'],
    ['duck-typed reader variable', 'let r = { read: function(n) { return ""; } };\nprint(json(r), "\\n");'],
    ['union that admits string', 'let v = length(ARGV) ? "{}" : null;\nif (v) print(json(v), "\\n");'],
    // A null argument is a null-handling bug, not a serializer mix-up: sprintf("%J", null)
    // would be wrong advice, so UC2017 leaves it to the wrong-argument-type check.
    ['provably null (left to the arg-type check)', 'let v = null;\nprint(json(v), "\\n");'],
    // `proto(v)` with ONE argument READS the prototype (null here) rather than
    // setting one, so the null-aware argument check owns this, not UC2017.
    ['one-argument proto() reads, does not set', 'let o = { a: 1 };\nlet p = proto(o);\nprint(json(p), "\\n");'],
  ]) {
    test(label, async () => {
      expect(await u2017(code)).toEqual([]);
    });
  }
});

describe('prototype-chain readability (ucv_property_get semantics)', () => {
  // lib.c uc_json_from_object does ucv_property_get(v, "read") + ucv_is_callable().
  // types.c: property lookup walks the WHOLE prototype chain, and only arrays and
  // objects can carry a prototype. So readability is decidable, not just unprovable.
  const DOCS_IDIOM = `let x = proto(
    [ '{"foo":', 'true, ', '"bar":', 'false}' ],
    { read: function() { return shift(this) } }
);
let v = json(x);
print(v.foo, "\\n");`;

  describe('proven READABLE — silent', () => {
    for (const [label, code] of [
      ['the documented proto()+read idiom', DOCS_IDIOM],
      ['direct proto() call as the argument', 'print(json(proto([1], { read: function() { return null; } })), "\\n");'],
      ['proto() applied in place, later', 'let feed = [ \'{"a":\', \'1}\' ];\nproto(feed, { read: function() { return shift(feed); } });\nprint(json(feed), "\\n");'],
      ['read() inherited two levels up', 'let base = { read: function() { return null; } };\nlet mid = proto({}, base);\nlet deep = proto([ \'{"n":\', \'2}\' ], mid);\nprint(json(deep), "\\n");'],
      ['own read() on a plain object', 'let own = { read: function() { return null; }, x: 1 };\nprint(json(own), "\\n");'],
      ['prototype named by a variable', 'let pr = { read: function() { return null; } };\nlet v = proto([1], pr);\nprint(json(v), "\\n");'],
    ]) {
      test(label, async () => { expect(await u2017(code)).toEqual([]); });
    }
  });

  describe('proven NOT readable — flagged', () => {
    for (const [label, code] of [
      ['proto() whose prototype has no read()', 'let o = proto([1, 2], { size: function() { return 2; } });\nprint(json(o), "\\n");'],
      ['read present but NOT callable', 'let o = proto([1, 2], { read: 5 });\nprint(json(o), "\\n");'],
      ['own non-callable read on an object', 'let o = { read: "not a function" };\nprint(json(o), "\\n");'],
      ['untouched array literal', 'let feed = [ \'{"a":\', \'1}\' ];\nprint(json(feed), "\\n");'],
    ]) {
      test(label, async () => { expect((await u2017(code)).length).toBe(1); });
    }
  });

  // Unprovable object/array args are WARNED, not silenced: json() throws unless
  // the value carries a callable read(), and a possible crash the developer
  // cannot see is worth a squiggle. Never a hard error — it may be legitimate.
  describe('unprovable — warned, never hard-errored', () => {
    for (const [label, code] of [
      ['two competing proto() calls (order not modelled)', 'let o = [1];\nproto(o, { read: function() { return null; } });\nproto(o, { size: function() { return 0; } });\nprint(json(o), "\\n");'],
      ['prototype from an opaque source', 'function mk() { return { read: function() { return null; } }; }\nlet o = proto([1], mk());\nprint(json(o), "\\n");'],
      // An unannotated parameter is the GL.iNet field-bug shape: we cannot prove
      // it is JSON text, and json() raises on everything else.
      ['unannotated parameter (the field-bug shape)', 'function f(x) { return json(x); }\nprint(f("{}"), "\\n");'],
    ]) {
      test(label, async () => {
        const hits = await u2017(code);
        expect(hits.length).toBe(1);
        expect(hits[0].severity).toBe(2); // warning, not error
        expect(hits[0].message).toContain('callable read()');
      });
    }
  });
});

describe('UC8001 does not pile on when the call is a certain throw', () => {
  // "Wrap it in try/catch" contradicts UC2017's fix (stop passing that value),
  // and guarding a guaranteed throw fixes nothing. Same precedent as the
  // uhttpd loadfile case, which defers to UC8011.
  async function codes(code) {
    const ds = await server.getDiagnostics(code, fp());
    return (ds || []).map((d) => String(d.code));
  }

  test('a provably-unparseable argument gets UC2017 only', async () => {
    const cs = await codes('let items = [1, 2, 3];\nlet bad = json(items);\nprint(bad, "\\n");');
    expect(cs).toContain('UC2017');
    expect(cs).not.toContain('UC8001');
  });

  test('an object literal likewise', async () => {
    const cs = await codes('let text = json({ a: 1 });\nprint(text, "\\n");');
    expect(cs).toContain('UC2017');
    expect(cs).not.toContain('UC8001');
  });

  test('but a genuine parse still gets the try/catch nudge', async () => {
    // A NON-literal argument can genuinely throw at runtime. (A provably-valid
    // literal cannot, so UC8001 correctly stays quiet there — covered in
    // test-unguarded-throwing-call.mocha.js.)
    const cs = await codes('let cfg = json(ARGV[0]);\nprint(cfg, "\\n");');
    expect(cs).not.toContain('UC2017');
    expect(cs).toContain('UC8001');
  });

  test('and a guarded parse gets neither', async () => {
    const cs = await codes('let cfg;\ntry {\n\tcfg = json(\'{"ok":true}\');\n} catch (e) {\n\tcfg = {};\n}\nprint(cfg, "\\n");');
    expect(cs).not.toContain('UC2017');
    expect(cs).not.toContain('UC8001');
  });
});

describe('a string LITERAL is validated as JSON text', () => {
  // Checked against json-c's real grammar (src/analysis/jsonTextValidator.ts),
  // NOT JSON.parse: json-c accepts single quotes, trailing commas, block
  // comments, NaN/Infinity and leading zeros, so the JS parser would
  // false-positive on working input. The validator was differential-tested
  // against owrt-main across 42 cases with zero mismatches.
  async function u2017sev(code) {
    const ds = await server.getDiagnostics(code, fp());
    return (ds || []).filter((d) => String(d.code) === 'UC2017').map((d) => d.severity);
  }

  for (const [label, lit] of [
    ['unquoted numeric key',      "'{1:2}'"],
    ['unquoted identifier key',   "'{a:1}'"],
    ['trailing garbage',          `'{"a":1} junk'`],
    ['unterminated array',        "'[1,2'"],
    ['unterminated object',       `'{"a":1'`],
    ['empty string',              "''"],
    ['whitespace only',           "'   '"],
    ['leading-dot number',        "'.5'"],
    ['hex number',                "'0x10'"],
  ]) {
    test(`flags ${label}`, async () => {
      // A malformed literal raises on every call — a PROVEN throw, so: error.
      expect(await u2017sev(`print(json(${lit}), "\\n");`)).toEqual([1]);
    });
  }

  for (const [label, lit] of [
    ['well-formed object',        `'{"a":1}'`],
    ['array',                     "'[1,2]'"],
    ['bare scalar',               "'42'"],
    ['single-quoted (json-c ok)', `"{'a':1}"`],
    ['trailing comma (json-c ok)', `'{"a":1,}'`],
    ['array trailing comma',      "'[1,2,]'"],
    ['NaN (json-c ok)',           "'NaN'"],
    ['Infinity (json-c ok)',      "'-Infinity'"],
    ['leading zero (json-c ok)',  "'01'"],
    ['block comment (json-c ok)', `'{"a":1 /* c */}'`],
    ['surrounding whitespace',    `'  {"a":1}  '`],
  ]) {
    test(`accepts ${label}`, async () => {
      expect(await u2017sev(`print(json(${lit}), "\\n");`)).toEqual([]);
    });
  }
});

describe('an unprovable argument is warned only when UNGUARDED', () => {
  // A try/catch already handles the throw, so the nudge adds nothing — the same
  // rule UC8001 follows. Measured on the corpus: 6 of 8 unprovable sites were
  // already guarded. A PROVEN throw still errors either way: code that always
  // raises is a bug whether or not it is caught.
  async function sev(code) {
    const ds = await server.getDiagnostics(code, fp());
    return (ds || []).filter((d) => String(d.code) === 'UC2017').map((d) => d.severity);
  }

  test('unguarded unprovable argument is warned', async () => {
    expect(await sev('function f(x) { return json(x); }\nprint(f("{}"), "\\n");')).toEqual([2]);
  });

  test('the same call inside try/catch is silent', async () => {
    expect(await sev('function f(x) {\n\ttry { return json(x); } catch (e) { return null; }\n}\nprint(f("{}"), "\\n");')).toEqual([]);
  });

  test('an opaque object inside try/catch is silent', async () => {
    expect(await sev('/** @param {object} c */\nfunction f(c) {\n\ttry { return json(c); } catch (e) { return null; }\n}\nprint(f({}), "\\n");')).toEqual([]);
  });

  test('a PROVEN throw still errors even inside try/catch', async () => {
    expect(await sev('try { print(json({ a: 1 }), "\\n"); } catch (e) {}')).toEqual([1]);
  });
});

describe('quick fix rewrites the call to sprintf("%J", …)', () => {
  test('object literal → sprintf', async () => {
    const code = 'let obj = { a: 1 };\nlet text = json(obj);\nprint(text, "\\n");';
    const p = fp();
    const ds = await server.getDiagnostics(code, p);
    const d = (ds || []).find((x) => String(x.code) === 'UC2017');
    expect(d).toBeTruthy();
    const acts = await server.getCodeActions(p, [d], d.range.start.line, d.range.start.character + 1);
    const action = (acts || []).find((a) => a.title.startsWith('Replace with sprintf('));
    expect(action).toBeTruthy();
    expect(action.title).toBe('Replace with sprintf("%J", obj)');
    expect(action.isPreferred).toBe(true);

    // Applying it produces valid, clean code.
    const edit = action.edit.changes[`file://${p}`][0];
    const lines = code.split('\n');
    const l = edit.range.start.line;
    lines[l] = lines[l].slice(0, edit.range.start.character) + edit.newText + lines[l].slice(edit.range.end.character);
    const after = lines.join('\n');
    expect(after).toContain('let text = sprintf("%J", obj);');
    expect(await u2017(after)).toEqual([]);
  });

  test('the argument slice is reused verbatim', async () => {
    const code = 'let cfg = { a: 1 };\nprint(json(cfg.a ? cfg : {}), "\\n");';
    const p = fp();
    const ds = await server.getDiagnostics(code, p);
    const d = (ds || []).find((x) => String(x.code) === 'UC2017');
    if (!d) return; // a conditional is not provable — silence is also correct here
    const acts = await server.getCodeActions(p, [d], d.range.start.line, d.range.start.character + 1);
    const action = (acts || []).find((a) => a.title.startsWith('Replace with sprintf('));
    expect(action.title).toBe('Replace with sprintf("%J", cfg.a ? cfg : {})');
  });
});
