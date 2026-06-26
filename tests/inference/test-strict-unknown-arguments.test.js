// `ucode.strictUnknownArguments` (analyzer level). Default ON (TypeScript noImplicitAny):
// a pure-UNKNOWN builtin argument (e.g. an unannotated parameter) under 'use strict' is an
// ERROR when on, a WARNING when off. It governs ONLY the unverifiable case — proven type
// mismatches and possibly-null args stay errors regardless of the setting. Non-strict files
// are always warnings. Annotating the param resolves it in either mode.
//
// The end-to-end server/config path (re-analysis on didChangeConfiguration) is pinned
// separately in tests/diagnostics/test-strict-unknown-arguments-reanalyze.mocha.js.
import { test, expect, describe } from 'bun:test';
const path = require('path');
const { UcodeLexer } = require(path.resolve('src/lexer/ucodeLexer'));
const { UcodeParser } = require(path.resolve('src/parser/ucodeParser'));
const { SemanticAnalyzer } = require(path.resolve('src/analysis/semanticAnalyzer'));
const { TextDocument } = require('vscode-languageserver-textdocument');

// opts.strictUnknownArguments: omit → default (true)
function diags(code, opts = {}) {
  const doc = TextDocument.create('file:///t.uc', 'ucode', 1, code);
  const lexer = new UcodeLexer(code, { rawMode: true });
  const parser = new UcodeParser(lexer.tokenize(), code);
  parser.setComments(lexer.comments); // required for JSDoc (@param) attachment
  const { ast } = parser.parse();
  return new SemanticAnalyzer(doc, { enableTypeChecking: true, ...opts }).analyze(ast).diagnostics;
}
const unknownArg = (code, opts) =>
  diags(code, opts).find(d => /is unknown\. Use a type guard/.test(d.message));
const SEV = { error: 1, warning: 2 };

// ── Builtins that validate a typed arg → an unannotated param reads as "unknown".
// (Verified against the build: string-coercing builtins like uc/lc/json coerce rather
// than flag, so they're intentionally excluded.) (name, call expression using param `p`)
const BUILTIN_CALLS = [
  ['substr',  'substr(p, 0, 1)'],
  ['split',   'split(p, ",")'],
  ['match',   'match(p, /x/)'],
  ['length',  'let n = length(p); return n;'],
  ['index',   'index(p, "x")'],
  ['ltrim',   'ltrim(p)'],
  ['rtrim',   'rtrim(p)'],
  ['keys',    'keys(p)'],
  ['values',  'values(p)'],
  ['push',    'push(p, 1)'],
];

describe('default ON: unknown arg under \'use strict\' is an ERROR', () => {
  for (const [name, call] of BUILTIN_CALLS) {
    test(`${name}: strict + default → error`, () => {
      const d = unknownArg(`'use strict';\nfunction f(p) { return ${call}; }\n`);
      expect(d).toBeTruthy();
      expect(d.severity).toBe(SEV.error);
    });
  }
  test('explicit true behaves like the default', () => {
    const d = unknownArg(`'use strict';\nfunction f(p) { return substr(p, 0, 1); }\n`, { strictUnknownArguments: true });
    expect(d.severity).toBe(SEV.error);
  });
});

describe('OFF: same cases become WARNINGS even under \'use strict\'', () => {
  for (const [name, call] of BUILTIN_CALLS) {
    test(`${name}: strict + off → warning`, () => {
      const d = unknownArg(`'use strict';\nfunction f(p) { return ${call}; }\n`, { strictUnknownArguments: false });
      expect(d).toBeTruthy();
      expect(d.severity).toBe(SEV.warning);
    });
  }
  test('OFF keeps the SAME diagnostic code, only the severity differs', () => {
    const on = unknownArg(`'use strict';\nfunction f(p) { return substr(p, 0, 1); }\n`, { strictUnknownArguments: true });
    const off = unknownArg(`'use strict';\nfunction f(p) { return substr(p, 0, 1); }\n`, { strictUnknownArguments: false });
    expect(on.code).toBe('incompatible-function-argument');
    expect(off.code).toBe('incompatible-function-argument');
    expect(on.severity).toBe(SEV.error);
    expect(off.severity).toBe(SEV.warning);
  });
});

describe('unknown comes from various sources — all governed by the setting', () => {
  const SOURCES = {
    'top-level fn param':       `'use strict';\nfunction f(p) { return substr(p, 0, 1); }\n`,
    'object-literal method':    `'use strict';\nlet o = { m: function(ctx, p) { return substr(p, 0, 1); } };\n`,
    'arrow-function param':     `'use strict';\nlet g = (p) => substr(p, 0, 1);\n`,
  };
  for (const [label, code] of Object.entries(SOURCES)) {
    test(`${label}: error when on`, () => {
      expect(unknownArg(code, { strictUnknownArguments: true }).severity).toBe(SEV.error);
    });
    test(`${label}: warning when off`, () => {
      expect(unknownArg(code, { strictUnknownArguments: false }).severity).toBe(SEV.warning);
    });
  }
});

describe('the setting does NOT affect other diagnostics', () => {
  test('non-strict is a warning regardless of the setting', () => {
    const code = `function f(p) { return substr(p, 0, 1); }\n`;
    expect(unknownArg(code, { strictUnknownArguments: true }).severity).toBe(SEV.warning);
    expect(unknownArg(code, { strictUnknownArguments: false }).severity).toBe(SEV.warning);
  });
  test('a PROVEN type mismatch (UC2004) stays an error with the setting OFF (multiple builtins)', () => {
    // A definitely-wrong-typed argument is a different code (UC2004), not "unknown" —
    // so the setting must NOT touch it. It's the "absolute true positive" that always errors.
    for (const call of ['keys([1, 2])', 'values("x")', 'push("x", 1)', 'split([1], ",")', 'length(3.5)']) {
      const errs = diags(`'use strict';\n${call};\n`, { strictUnknownArguments: false })
        .filter(d => d.severity === SEV.error && d.code === 'UC2004');
      expect(errs.length).toBeGreaterThan(0);
    }
  });
  test('a possibly-null argument stays an error under strict with the setting OFF', () => {
    // nullable-argument is a different branch (a possibly-null value, not "unknown") and is
    // unaffected by strictUnknownArguments. match() returns array|null; passing it to
    // length() without a guard is a possibly-null arg → error under strict, even with OFF.
    const nullableCode = `'use strict';\nfunction f(s) {\n  let r = match(s, /(x)/);\n  return length(r);\n}\n`;
    const errs = diags(nullableCode, { strictUnknownArguments: false })
      .filter(d => d.severity === SEV.error && d.code === 'nullable-argument');
    expect(errs.length).toBeGreaterThan(0);
  });
  test('annotating the param resolves it regardless of the setting', () => {
    const code = `'use strict';\n/** @param {string} p */\nfunction f(p) { return substr(p, 0, 1); }\n`;
    expect(unknownArg(code, { strictUnknownArguments: true })).toBeUndefined();
    expect(unknownArg(code, { strictUnknownArguments: false })).toBeUndefined();
  });
});
