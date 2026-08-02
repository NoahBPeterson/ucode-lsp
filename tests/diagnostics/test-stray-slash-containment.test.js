// Stray-`/` containment battery (0.7.85 review): a single mistyped slash - most
// commonly a `//` comment missing its second slash - must NOT cascade mis-lexed
// regexes through the file. Every stray case asserts its diagnostics stay within
// one line of the stray; every legitimate-slash control asserts silence.
//
// The three mechanisms under test (lexer + parser):
//  - statement-position regexes are LINE-BOUNDED (no closer on the line -> hint);
//  - a regex whose closer is IMMEDIATELY followed by '/' is a broken comment in
//    ANY position (a real regex before a trailing comment has whitespace);
//  - a regex literal is a VALUE, so '/' after one lexes as division, and the
//    parser emits one root-cause hint with same-line echoes suppressed.

const { test, expect, describe, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');
setDefaultTimeout(60000);

let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const diags = async (code) => (await server.getDiagnostics(code, `/tmp/stray-${n++}.uc`)) || [];
const errs = (ds) => ds.filter(d => d.severity === 1);

// [name, code, 0-based stray line(s)]
const STRAY_CASES = [
  ['file start',        '/print(1); // note\nprint(2, "\\n");\n', [0]],
  ['after semicolon',   'let a = 1;\n/print(a); // note\nprint(a, "\\n");\n', [1]],
  ['fn body first',     'function f() {\n/print(1); // note\nreturn 2;\n}\nprint(f(), "\\n");\n', [1]],
  ['after block',       'let a = 1;\nif (a) { a = 2; }\n/print(a); // note\nprint(a, "\\n");\n', [2]],
  ['before let',        '/let x = 1;\nlet y = 2;\nprint(y, "\\n");\n', [0]],
  ['before if',         'let a = 1;\n/if (a) print(a);\nprint(a, "\\n");\n', [1]],
  ['before return',     'function f() {\n/return 1; // note\nreturn 2;\n}\nprint(f(), "\\n");\n', [1]],
  ['after else',        'let a = 0;\nif (a)\nprint(1);\nelse\n/print(2); // note\nprint(3, "\\n");\n', [4]],
  ['in object literal', 'let o = {\n/a: 1, // note\nb: 2\n};\nprint(o.b, "\\n");\n', [1]],
  ['in array literal',  'let a = [\n/1, 2, // note\n3\n];\nprint(a, "\\n");\n', [1]],
  ['in call args',      'print(\n/1, // note\n2, "\\n");\n', [1]],
  ['after assignment',  'let x =\n/1; // note\nprint(x, "\\n");\n', [1]],
  ['mid-line no cmt',   'let a = 1; / print(a);\nprint(a, "\\n");\n', [0]],
  ['mid-line with cmt', 'let a = 1; / print(a); // note\nprint(a, "\\n");\n', [0]],
  ['in condition',      'let x = 1;\nif (/x) print(x);\nprint(x, "\\n");\n', [1]],
  ['in ternary',        'let a = 1;\nlet b = a ? /b : 2;\nprint(b, "\\n");\n', [1]],
  ['after return kw',   'function f() {\nreturn /x; // note\n}\nprint(f(), "\\n");\n', [1]],
  ['in let list',       'let a = 1,\n/b = 2; // note\nprint(a, "\\n");\n', [1]],
  ['double stray',      '/one(1); // a\nlet x = 1;\n/two(x); // b\nprint(x, "\\n");\n', [0, 2]],
  ['eof stray',         'print(1, "\\n");\n/', [1]],
  ['in case body',      'let k = 1;\nswitch (k) {\ncase 1:\n/print(k); // note\nbreak;\n}\nprint(k, "\\n");\n', [3]],
];

const CONTROLS = [
  ['chained division',        'let a = 8, b = 2;\nlet x = a / b / 2;\nprint(x, "\\n");\n'],
  ['escaped slash in regex',  'print(match("a/b", /a\\/b/), "\\n");\n'],
  ['multi-line regex arg',    'print(match("ab", /a\nb/) == null ? 1 : 2, "\\n");\n'],
  ['regex decl with flags',   'let r = /abc/gi;\nprint(match("ABC", r), "\\n");\n'],
  ['bare statement regex',    'let a = 1;\n/abc/;\nprint(a, "\\n");\n'],
  ['division after paren',    'let a = (4) / 2;\nprint(a, "\\n");\n'],
  ['return regex',            'function f() {\nreturn /re/;\n}\nprint(type(f()), "\\n");\n'],
  ['bare regex + comment',    'let a = 1;\n/abc/; // trailing note\nprint(a, "\\n");\n'],
  ['division at line start',  'let a = 8;\nlet x = a\n/ 2;\nprint(x, "\\n");\n'],
];

describe('stray `/` stays contained', () => {
  for (const [name, code, strayLines] of STRAY_CASES) {
    test(`${name}: errors only near the stray line`, async () => {
      const ds = await diags(code);
      const es = errs(ds);
      expect(es.length).toBeGreaterThan(0);           // the mistake IS reported
      expect(es.length).toBeLessThanOrEqual(4);       // ...without a mountain
      for (const d of es) {
        const near = strayLines.some(l => Math.abs(d.range.start.line - l) <= 1);
        expect(near).toBe(true);                      // ...and near the mistake
      }
    });
  }
});

describe('legitimate `/` uses stay silent', () => {
  for (const [name, code] of CONTROLS) {
    test(name, async () => {
      const ds = await diags(code);
      expect(errs(ds)).toEqual([]);
    });
  }

  test('fresh-regex reference comparison keeps its deliberate UC2009', async () => {
    const ds = await diags('let x = "a";\nprint(x === /y/ ? 1 : 2, "\\n");\n');
    const es = errs(ds);
    expect(es.length).toBe(1);
    expect(es[0].code).toBe('UC2009');
  });
});
