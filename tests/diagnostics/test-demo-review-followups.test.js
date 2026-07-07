// Regression tests for the 2026-07-07 demo-review follow-ups:
//   UC4006 empty infinite loop; UC6017 `/*/` empty-comment quirk (+ severity=warning);
//   nl80211/rtnl `.const` chain typing (integer members, UC5003 on bogus names);
//   IOC_DIR_* 24.10 version gate; SCREAMING_SNAKE strict/non-strict tiering;
//   lexer emitToken `??` fix (numeric 0 token values survive).
const { test, expect } = require('bun:test');
const { UcodeLexer } = require('../../src/lexer/ucodeLexer.ts');
const { UcodeParser } = require('../../src/parser/ucodeParser.ts');
const { SemanticAnalyzer } = require('../../src/analysis/semanticAnalyzer.ts');
const { TokenType } = require('../../src/lexer/tokenTypes.ts');

function analyze(code) {
  const lexer = new UcodeLexer(code, { rawMode: true });
  const tokens = lexer.tokenize();
  const parser = new UcodeParser(tokens, code);
  const parseResult = parser.parse();
  const doc = {
    getText: () => code,
    positionAt: (o) => { let l = 0, c = 0; for (let i = 0; i < o && i < code.length; i++) { if (code[i] === '\n') { l++; c = 0; } else { c++; } } return { line: l, character: c }; },
    offsetAt: (p) => { const ls = code.split('\n'); let o = 0; for (let i = 0; i < p.line; i++) o += ls[i].length + 1; return o + p.character; },
    uri: 'file:///t.uc', languageId: 'ucode', version: 1,
  };
  const analyzer = new SemanticAnalyzer(doc, { enableScopeAnalysis: true, enableTypeChecking: true, enableControlFlowAnalysis: true });
  const res = analyzer.analyze(parseResult.ast);
  // Parser/lexer errors are a separate stream (the server/CLI merge them the same way).
  const parseDiags = [...lexer.errors, ...parseResult.errors].map(e => ({ message: e.message, code: e.code ?? 'UC6001', severity: e.severity === 'warning' ? 2 : 1 }));
  return { diagnostics: [...parseDiags, ...res.diagnostics], lexerErrors: lexer.errors, symbolTable: res.symbolTable };
}

test('UC4006: empty while(true)/for(;;)/while(1) flag; daemon loop and variable cond stay clean', () => {
  const d = analyze('while (true) { }\nlet run = 1;\nprint(run);\n').diagnostics;
  expect(d.some(x => x.code === 'UC4006')).toBe(true);
  const d2 = analyze('for (;;) { }\n').diagnostics;
  expect(d2.some(x => x.code === 'UC4006')).toBe(true);
  const clean = analyze('while (true) { sleep(100); }\n').diagnostics;
  expect(clean.some(x => x.code === 'UC4006')).toBe(false);
  const varCond = analyze('let run = true;\nwhile (run) { }\nprint(run);\n').diagnostics;
  expect(varCond.some(x => x.code === 'UC4006')).toBe(false);
});

test('UC6017: /*/ emits a WARNING lexer diagnostic on the 3-char span', () => {
  const lexer = new UcodeLexer('let x = /*/;\n', { rawMode: true });
  lexer.tokenize();
  const e = lexer.errors.find(x => x.code === 'UC6017');
  expect(e).toBeDefined();
  expect(e.severity).toBe('warning');
  expect(e.start).toBe(8);
  expect(e.end).toBe(11);
  expect(e.message).toContain('escape it');
});

test('lexer: numeric 0 token values survive emitToken (?? not ||)', () => {
  const lexer = new UcodeLexer('let a = 0; let b = 0b; let c = 0o;', { rawMode: true });
  const zeros = lexer.tokenize().filter(t => t.type === TokenType.TK_NUMBER);
  expect(zeros.length).toBe(3);
  for (const t of zeros) expect(t.value).toBe(0);
});

test('nl80211/rtnl .const chain: members type integer, bogus names flag UC5003', () => {
  const code = 'import * as nl80211 from "nl80211";\nimport * as rtnl from "rtnl";\n'
    + 'let a = nl80211.const.NL80211_CMD_ABORT_SCAN + rtnl.const.FR_ACT_GOTO;\n'
    + 'let bad = rtnl.const.RTA_DST;\nprint(a, bad);\n';
  const { diagnostics, symbolTable } = analyze(code);
  const uc5003 = diagnostics.filter(x => x.code === 'UC5003');
  expect(uc5003.length).toBe(1);
  expect(uc5003[0].message).toContain('RTA_DST');
  expect(symbolTable.lookup('a')?.dataType).toBe('integer'); // integer + integer
});

test('fs IOC_DIR_* named import is UC6005-gated below 24.10, clean at 24.10', () => {
  const gate = (target) => {
    const code = 'import { IOC_DIR_READ } from "fs";\nprint(IOC_DIR_READ);\n';
    const lexer = new UcodeLexer(code, { rawMode: true });
    const parser = new UcodeParser(lexer.tokenize(), code);
    const pr = parser.parse();
    const doc = { getText: () => code, positionAt: () => ({ line: 0, character: 0 }), offsetAt: () => 0, uri: 'file:///t.uc', languageId: 'ucode', version: 1 };
    const analyzer = new SemanticAnalyzer(doc, { enableScopeAnalysis: true, enableTypeChecking: true, enableControlFlowAnalysis: true, targetVersion: target });
    return analyzer.analyze(pr.ast).diagnostics.filter(d => d.code === 'UC6005');
  };
  expect(gate('23.05').length).toBeGreaterThan(0);
  expect(gate('24.10').length).toBe(0);
});

test('SCREAMING_SNAKE: strict warns even when guarded; non-strict guard is a hint', () => {
  const strict = analyze('"use strict";\nif (QUIET) print(1);\n').diagnostics
    .find(d => d.code === 'UC1001' && d.message.includes('QUIET'));
  expect(strict.severity).toBe(2);
  expect(strict.message).toContain('global.QUIET');
  const ns = analyze('if (QUIET) print(1);\nlet t = "v" + TAG_X;\nprint(t);\n').diagnostics;
  expect(ns.find(d => d.message.includes("'QUIET'"))?.severity).toBe(4);
  expect(ns.find(d => d.message.includes("'TAG_X'"))?.severity).toBe(2);
});

test('every unexpected character in a file reports independently (no panic latch)', () => {
  const code = 'let a = @;\nlet b = \u{1F600};\nlet café = 1;\nlet z = (1 +;\nlet d = @;\nprint(a, b, caf, z, d);\n';
  const { diagnostics, symbolTable } = analyze(code);
  const chars = diagnostics.filter(d => /Unexpected character/.test(d.message));
  expect(chars.length).toBe(4);                       // @, emoji, e-acute, @ — each its own
  expect(chars.some(d => d.message.includes('@'))).toBe(true);
  expect(chars.some(d => d.message.includes('\u{1F600}'))).toBe(true);
  expect(chars.some(d => d.message.includes('é'))).toBe(true);
  // the parser skips the bad char: caf still received its initializer
  expect(symbolTable.lookup('caf')?.dataType).toBe('integer');
  // and the genuine paren error still reports too
  expect(diagnostics.some(d => /Unexpected token in expression/.test(d.message))).toBe(true);
});

// ── review round 2 ───────────────────────────────────────────────────────────
test('UC6016 messages say WHY: base digits, bare 0x, double dot, bare exponent', () => {
  const msgs = (code) => {
    const lexer = new UcodeLexer(code, { rawMode: true });
    lexer.tokenize();
    return lexer.errors.filter(e => e.code === 'UC6016').map(e => e.message);
  };
  expect(msgs('let a = 0o9;')[0]).toContain('allowed digits are 0-7');
  expect(msgs('let a = 0b2;')[0]).toContain('0 and 1');
  expect(msgs('let a = 0x;')[0]).toContain('at least one hex digit');
  expect(msgs('let a = 1.2.3;')[0]).toContain("only one '.'");
  expect(msgs('let a = 1e;')[0]).toContain('exponent needs at least one digit');
});

test('?? with an unknown left keeps the default arm type (integer | unknown)', () => {
  const { symbolTable } = analyze('let lvl = SOME_INJECTED ?? 1;\nlet nm = SOME_INJECTED ?? "x";\nprint(lvl, nm);\n');
  const t = (n) => JSON.stringify(symbolTable.lookup(n)?.dataType);
  expect(t('lvl')).toContain('integer');
  expect(t('lvl')).toContain('unknown');
  expect(t('nm')).toContain('string');
});

test('?? with a provably non-null left stays the left type (fallback unreachable)', () => {
  const { symbolTable } = analyze('let s = "hi";\nlet r = s ?? "fallback";\nprint(r);\n');
  expect(symbolTable.lookup('r')?.dataType).toBe('string');
});

test('include() of a parse-broken target flags UC3009; missing target flags UC3002', () => {
  const fsMod = require('fs'), os = require('os'), path = require('path');
  const dir = fsMod.mkdtempSync(path.join(os.tmpdir(), 'inc-diag-'));
  fsMod.writeFileSync(path.join(dir, 'broken-child.uc'), 'export let ok = (1 +;\n');
  const code = `include("./broken-child.uc");\ninclude("./missing-child.uc");\n`;
  const lexer = new UcodeLexer(code, { rawMode: true });
  const parser = new UcodeParser(lexer.tokenize(), code);
  const pr = parser.parse();
  const doc = {
    getText: () => code,
    positionAt: () => ({ line: 0, character: 0 }),
    offsetAt: () => 0,
    uri: 'file://' + path.join(dir, 'main.uc'), languageId: 'ucode', version: 1,
  };
  const analyzer = new SemanticAnalyzer(doc, { enableScopeAnalysis: true, enableTypeChecking: true, enableControlFlowAnalysis: true });
  const ds = analyzer.analyze(pr.ast).diagnostics;
  expect(ds.some(d => d.code === 'UC3009' && /could not be parsed/.test(d.message))).toBe(true);
  expect(ds.some(d => d.code === 'UC3002' && /Cannot find include target/.test(d.message))).toBe(true);
  fsMod.rmSync(dir, { recursive: true, force: true });
});

test('assumed-injected global gets a symbol: type() guard narrows it, UC1001 still fires', () => {
  const code = 'let lvl = VERBOSITY ?? 1;\nif (type(VERBOSITY) !== "string")\n    die();\nprint(lvl, VERBOSITY);\n';
  const { diagnostics, symbolTable } = analyze(code);
  const sym = symbolTable.lookup('VERBOSITY');
  expect(sym).toBeDefined();
  expect(sym.isAssumedInjectedGlobal).toBe(true);
  expect(sym.dataType).toBe('unknown');
  // the tiered UC1001 was emitted BEFORE the symbol was declared (hint: ?? self-guards)
  expect(diagnostics.some(d => d.code === 'UC1001' && d.message.includes('VERBOSITY'))).toBe(true);
});

test('regex-literal hover decodes pattern escapes (\\* = literal *, \\d = digit)', () => {
  const { regexTypeRegistry } = require('../../src/analysis/regexTypes.ts');
  const star = regexTypeRegistry.getRegexDocumentation('\\*');
  expect(star).toContain('a literal `*`');
  expect(star).toContain('no string-escape layer');
  const dec = regexTypeRegistry.getRegexDocumentation('\\d+\\.\\d+');
  expect(dec).toContain('a digit');
  expect(dec).toContain('a literal `.`');
  expect(regexTypeRegistry.getRegexDocumentation('plain')).not.toContain('string-escape layer');
});
