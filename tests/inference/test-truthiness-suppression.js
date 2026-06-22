// Test that unknown-arg warnings are suppressed when the builtin call is used
// in a truthiness context (if-test, !, ternary test).
// Builtins safely return null for invalid types, so using them as type guards
// (e.g., if (!length(args))) is a valid pattern.

import { UcodeLexer } from '../../src/lexer/ucodeLexer.ts';
import { UcodeParser } from '../../src/parser/ucodeParser.ts';
import { SemanticAnalyzer } from '../../src/analysis/semanticAnalyzer.ts';

function analyze(code) {
    const lexer = new UcodeLexer(code, { rawMode: true });
    const tokens = lexer.tokenize();
    const parser = new UcodeParser(tokens, code);
    const parseResult = parser.parse();
    const doc = {
        getText: () => code,
        positionAt: (o) => { let l=0,c=0; for(let i=0;i<o&&i<code.length;i++){if(code[i]==='\n'){l++;c=0;}else{c++;}} return {line:l,character:c}; },
        offsetAt: (p) => { const lines=code.split('\n'); let o=0; for(let i=0;i<p.line&&i<lines.length;i++){o+=lines[i].length+1;} return o+p.character; },
        uri: 'file:///test.uc', languageId: 'ucode', version: 1
    };
    const analyzer = new SemanticAnalyzer(doc, { enableScopeAnalysis: true, enableTypeChecking: true });
    return analyzer.analyze(parseResult.ast);
}

function getUnknownArgDiags(result) {
    return result.diagnostics.filter(d => d.code === 'incompatible-function-argument');
}

let passed = 0;
let failed = 0;

function check(label, actual, expected) {
    if (actual === expected) {
        passed++;
    } else {
        failed++;
        console.log(`FAIL: ${label}: expected ${expected}, got ${actual}`);
    }
}

// ── 1. if (!length(args)) — no warning ──────────────────────────────
{
    const code = `function test(args) {
  if (!length(args)) return;
  print(args);
}
`;
    const result = analyze(code);
    check('if (!length(args)) suppressed', getUnknownArgDiags(result).length, 0);
}

// ── 2. if (length(args) > 1) — no warning ──────────────────────────
{
    const code = `function test(args) {
  if (length(args) > 1) return;
  print(args);
}
`;
    const result = analyze(code);
    check('if (length(args) > 1) suppressed', getUnknownArgDiags(result).length, 0);
}

// ── 3. if (length(args)) — no warning ───────────────────────────────
{
    const code = `function test(args) {
  if (length(args)) {
    print(args);
  }
}
`;
    const result = analyze(code);
    check('if (length(args)) suppressed', getUnknownArgDiags(result).length, 0);
}

// ── 4. Bare split(x, ',') NOT in if — still warns ──────────────────
{
    const code = `function test(x) {
  let parts = split(x, ',');
  print(parts);
}
`;
    const result = analyze(code);
    const diags = getUnknownArgDiags(result);
    check('bare split(unknown) warns', diags.length, 1);
}

// ── 5. Bare length(x) NOT in if — still warns ──────────────────────
{
    const code = `function test(x) {
  let n = length(x);
  print(n);
}
`;
    const result = analyze(code);
    check('bare length(unknown) warns', getUnknownArgDiags(result).length, 1);
}

// ── 6. Ternary: length(x) ? a : b — no warning ─────────────────────
{
    const code = `function test(x) {
  let val = length(x) ? "has items" : "empty";
  print(val);
}
`;
    const result = analyze(code);
    check('ternary length(x) suppressed', getUnknownArgDiags(result).length, 0);
}

// ── 7. if (index(x, 'foo') >= 0) — no warning ──────────────────────
{
    const code = `function test(x) {
  if (index(x, 'foo') >= 0) {
    print(x);
  }
}
`;
    const result = analyze(code);
    check('if (index(x, y) >= 0) suppressed', getUnknownArgDiags(result).length, 0);
}

// ── 8. Combined: truthiness + non-truthiness in same function ───────
{
    const code = `function test(args) {
  if (!length(args)) return;
  let x = split(args[0], ',');
  print(x);
}
`;
    const result = analyze(code);
    const diags = getUnknownArgDiags(result);
    // length() in if — suppressed. split() outside if — should warn.
    check('mixed: truthiness suppressed, bare warns', diags.length, 1);
    if (diags.length === 1) {
        check('mixed: the warning is for split', diags[0].message.includes('split'), true);
    }
}

// ── 9. Nested if: both levels suppress ──────────────────────────────
{
    const code = `function test(args) {
  if (length(args)) {
    if (index(args[0], ':') >= 0) {
      print(args);
    }
  }
}
`;
    const result = analyze(code);
    check('nested if both suppressed', getUnknownArgDiags(result).length, 0);
}

// ── 10. if (trim(x)) — no warning ──────────────────────────────────
{
    const code = `function test(x) {
  if (trim(x)) {
    print(x);
  }
}
`;
    const result = analyze(code);
    check('if (trim(x)) suppressed', getUnknownArgDiags(result).length, 0);
}

// ── 11. Known types never warn regardless of context ────────────────
{
    const code = `function test() {
  let s = "hello";
  let n = length(s);
  if (length(s)) { print(s); }
  print(n);
}
`;
    const result = analyze(code);
    check('known type never warns', getUnknownArgDiags(result).length, 0);
}

// ── 12. Comparison: length(x) > 0 outside if — no warning ───────────
{
    const code = `function test(x) {
  let valid = length(x) > 0;
  print(valid);
}
`;
    const result = analyze(code);
    check('length(x) > 0 comparison suppressed', getUnknownArgDiags(result).length, 0);
}

// ── 13. Comparison: index(x, y) == 0 outside if — no warning ────────
{
    const code = `function test(x) {
  let found = index(x, 'foo') == 0;
  print(found);
}
`;
    const result = analyze(code);
    check('index(x, y) == 0 comparison suppressed', getUnknownArgDiags(result).length, 0);
}

// ── 14. filter callback: (l) => length(l) > 0 — no warning ──────────
{
    const code = `function test() {
  let parts = split("a,bb,ccc", ",");
  let long = filter(parts, (s) => length(s) > 2);
  print(long);
}
`;
    const result = analyze(code);
    check('filter callback length(s) > 2 no warning', getUnknownArgDiags(result).length, 0);
}

console.log(`\n${passed}/${passed + failed} tests passed`);
if (failed > 0) process.exit(1);
