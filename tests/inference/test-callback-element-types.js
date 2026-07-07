// Test that callback parameters in filter/map/sort get their type
// inferred from the array element type.

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

function getArgDiags(result) {
    return result.diagnostics.filter(d => d.code === 'incompatible-function-argument');
}

let passed = 0, failed = 0;
function check(label, actual, expected) {
    if (actual === expected) { passed++; }
    else { failed++; console.log(`FAIL: ${label}: expected ${expected}, got ${actual}`); }
}

// 1. filter(split(...), (l) => length(l) > 0) — l is string, no warning
{
    const code = `function test(out) {
  if (type(out) != "string") return;
  let ips = filter(split(trim(out), '\\n'), (l) => length(l) > 0);
  return join(',', ips);
}`;
    const result = analyze(code);
    check('filter(split, (l) => length(l)) no warning', getArgDiags(result).length, 0);
}

// 2. filter(arr, (s) => ...) where arr is array<string> via variable
{
    const code = `function test() {
  let parts = split("a,bb,ccc", ",");
  let long = filter(parts, (s) => length(s) > 2);
  print(long);
}`;
    const result = analyze(code);
    check('filter(array<string> var, (s) => length(s)) no warning', getArgDiags(result).length, 0);
}

// 3. map(split(...), (s) => uc(s)) — s is string, no warning
{
    const code = `function test() {
  let parts = split("hello world", " ");
  let upper = map(parts, (s) => uc(s));
  print(upper);
}`;
    const result = analyze(code);
    check('map(array<string>, (s) => uc(s)) no warning', getArgDiags(result).length, 0);
}

// 4. filter with unknown array — l is unknown, but length(l) > 0 is a comparison (suppressed)
{
    const code = `function test(arr) {
  let result = filter(arr, (l) => length(l) > 0);
  print(result);
}`;
    const result = analyze(code);
    const diags = getArgDiags(result).filter(d => d.message.includes('length'));
    // Comparison context suppresses the unknown-arg warning
    check('filter(unknown, (l) => length(l) > 0) suppressed by comparison', diags.length, 0);
}

// 4b. filter with unknown array, bare length(l) — l is unknown, should warn
{
    const code = `function test(arr) {
  let result = filter(arr, (l) => { let n = length(l); return n > 0; });
  print(result);
}`;
    const result = analyze(code);
    const diags = getArgDiags(result).filter(d => d.message.includes('length'));
    check('filter(unknown, bare length(l)) warns', diags.length, 1);
}

// 5. sort(split(...), (a, b) => ...) — a and b are string
{
    const code = `function test() {
  let parts = split("c,a,b", ",");
  let sorted = sort(parts, (a, b) => (a > b) - (a < b));
  print(sorted);
}`;
    const result = analyze(code);
    // sort callback doesn't call builtins on params, so just check no crashes
    check('sort(array<string>, (a, b) => ...) no crash', getArgDiags(result).length, 0);
}

// 6. Nested: filter inside map — callback types propagate correctly
{
    const code = `function test() {
  let lines = split("a\\nb\\n\\nc", "\\n");
  let result = filter(lines, (l) => length(l) > 0);
  print(result);
}`;
    const result = analyze(code);
    check('filter(split, (l) => length(l)) nested no warning', getArgDiags(result).length, 0);
}

// 7. sort's SECOND comparator parameter also gets the element type (finding #110).
//    `uc(b)` would warn if b were unknown; it must be string here.
{
    const code = `function test() {
  let parts = split("c,a,b", ",");
  let sorted = sort(parts, (a, b) => length(uc(a)) - length(uc(b)));
  print(sorted);
}`;
    const result = analyze(code);
    check('sort 2nd param typed as element (uc(b) no warning)', getArgDiags(result).length, 0);
}

// 7b. sort comparator as a FUNCTION EXPRESSION also types both params (finding #110/#178).
{
    const code = `function test() {
  let parts = split("c,a,b", ",");
  let sorted = sort(parts, function(a, b) { return length(uc(b)) - length(uc(a)); });
  print(sorted);
}`;
    const result = analyze(code);
    check('sort function-expression comparator types params', getArgDiags(result).length, 0);
}

// 8. replace() callback params are strings (finding #178). Both arrow and function form.
{
    const code = `function test(s) {
  return replace(s, /(l)/, (full, g1) => uc(g1) + substr(full, 0));
}`;
    const result = analyze(code);
    check('replace arrow callback params are strings', getArgDiags(result).length, 0);
}
{
    const code = `function test(s) {
  return replace(s, /(l)/, function(full, g1) { return uc(g1) + substr(full, 0); });
}`;
    const result = analyze(code);
    check('replace function-expression callback params are strings', getArgDiags(result).length, 0);
}

// 8b. replace with a non-function 3rd arg must NOT type anything as a callback (no crash).
{
    const code = `function test(s) { return replace(s, "a", "b"); }`;
    const result = analyze(code);
    check('replace string replacement no crash', getArgDiags(result).length, 0);
}

// 9. uci cursor foreach callback param is typed as an object (finding #131).
//    length(sec) would warn if sec were unknown; an object is a valid length() arg.
{
    const code = `import { cursor } from 'uci';
let c = cursor();
c.foreach('network', 'interface', (sec) => { let n = length(sec); return n; });`;
    const result = analyze(code);
    const diags = getArgDiags(result).filter(d => d.message.includes('length'));
    check('uci foreach callback param typed object (length(sec) no warning)', diags.length, 0);
}

console.log(`\n${passed}/${passed + failed} tests passed`);
if (failed > 0) process.exit(1);
