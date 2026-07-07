// Implicit global shadowing a module name: `fs = ctx.fs; ... fs.open(...)`.
// A bare assignment to an undeclared name that happens to match a known module
// makes `fs` a provable implicit global (a local-ish value), NOT an unimported
// module — so `fs.open(...)` must NOT fire UC3006 "import fs".
// A genuinely-unimported module member access (`fs` never assigned) must still fire.
// See docs/implicit-global-type-inference.md Finding 1.
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
const uc3006 = (code) =>
  analyze(code).diagnostics.filter(d => /without importing it first/.test(d.message));

test('implicit global `fs = ctx.fs` does not trigger UC3006 on `fs.open`', () => {
  const code = `function volumes(ctx) {
    fs = ctx.fs;
}
function other() {
    let f = fs.open("/tmp/x", "r");
    return f;
}
volumes({});
other();`;
  expect(uc3006(code).length).toBe(0);
});

test('SOUND: a genuinely unimported `fs` still triggers UC3006', () => {
  const code = `function f() {
  return fs.open("/x", "r");
}
f();`;
  expect(uc3006(code).length).toBe(1);
});
