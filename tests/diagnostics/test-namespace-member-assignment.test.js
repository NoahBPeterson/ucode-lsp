// Ticket 180: writing to a member of a namespace import (`import * as m; m.K = 9`)
// is a runtime error in ucode ("Type error: object value is immutable") but was not
// flagged. Any member write through the namespace — dotted, computed, or update —
// must fire UC1010; reads stay clean.
const { test, expect } = require('bun:test');
const { UcodeLexer } = require('../../src/lexer/ucodeLexer.ts');
const { UcodeParser } = require('../../src/parser/ucodeParser.ts');
const { SemanticAnalyzer } = require('../../src/analysis/semanticAnalyzer.ts');

function analyze(code) {
  const lexer = new UcodeLexer(code, { rawMode: true });
  const parser = new UcodeParser(lexer.tokenize(), code);
  const parseResult = parser.parse();
  const doc = {
    getText: () => code,
    positionAt: (o) => { let l = 0, c = 0; for (let i = 0; i < o && i < code.length; i++) { if (code[i] === '\n') { l++; c = 0; } else { c++; } } return { line: l, character: c }; },
    offsetAt: (p) => { const ls = code.split('\n'); let o = 0; for (let i = 0; i < p.line; i++) o += ls[i].length + 1; return o + p.character; },
    uri: 'file:///t.uc', languageId: 'ucode', version: 1,
  };
  const analyzer = new SemanticAnalyzer(doc, { enableScopeAnalysis: true, enableTypeChecking: true, enableControlFlowAnalysis: true });
  return analyzer.analyze(parseResult.ast);
}
const immutableErrors = (code) =>
  analyze(code).diagnostics.filter(d => /namespace object is immutable/.test(d.message));

test('dotted, computed, and update writes to a namespace import all flag UC1010', () => {
  const code = `import * as fs from 'fs';
fs.open = null;
fs["popen"] = null;
fs.open++;
print(fs);`;
  const errs = immutableErrors(code);
  expect(errs.length).toBe(3);
  expect(errs.every(d => d.code === 'UC1010')).toBe(true);
});

test('reads through a namespace import stay clean', () => {
  const code = `import * as fs from 'fs';
let f = fs.open("/tmp/x", "r");
print(f);`;
  expect(immutableErrors(code).length).toBe(0);
});

test('writes to a plain object are not affected', () => {
  const code = `let o = { k: 1 };
o.k = 2;
o["k"] = 3;
print(o);`;
  expect(immutableErrors(code).length).toBe(0);
});
