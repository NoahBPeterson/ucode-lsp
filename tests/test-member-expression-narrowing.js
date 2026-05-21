// Test type narrowing for member expressions (e.g., state.errors)
// Covers: type guard on dotted paths, _val extraction pattern, switch body scoping

import { UcodeLexer } from '../src/lexer/ucodeLexer.ts';
import { UcodeParser } from '../src/parser/ucodeParser.ts';
import { SemanticAnalyzer } from '../src/analysis/semanticAnalyzer.ts';

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

// 1. _val extraction pattern: let _val = state.errors; if (type(_val) != "array") return; push(_val, ...)
{
    const code = `function create(state, output, pkg) {
  let nft_file = {};
  nft_file.remove = function(target) {
    switch (target) {
    case 'netifd':
      if (unlink(pkg.nft_netifd_file) != false) {
        output.okbn();
      } else {
        let _val = state.errors;
        if (type(_val) != "array")
          return;
        push(_val, { code: 'errorNftNetifdFileDelete', info: pkg.nft_netifd_file });
        output.failn();
      }
      break;
    }
    return true;
  };
  return nft_file;
}`;
    check('_val pattern suppresses push warning', getArgDiags(analyze(code)).length, 0);
}

// 2. Direct member expression guard: if (type(state.errors) != "array") return; push(state.errors, ...)
{
    const code = `function create(state, output, pkg) {
  let nft_file = {};
  nft_file.remove = function(target) {
    switch (target) {
    case 'netifd':
      if (unlink(pkg.nft_netifd_file) != false) {
        output.okbn();
      } else {
        if (type(state) != "object")
          return;
        if (type(state.errors) != "array")
          return;
        push(state.errors, { code: 'errorNftNetifdFileDelete', info: pkg.nft_netifd_file });
        output.failn();
      }
      break;
    }
    return true;
  };
  return nft_file;
}`;
    check('state.errors direct guard suppresses push warning', getArgDiags(analyze(code)).length, 0);
}

// 3. No guard — should warn
{
    const code = `function create(state, output, pkg) {
  let nft_file = {};
  nft_file.remove = function(target) {
    switch (target) {
    case 'netifd':
      if (unlink(pkg.nft_netifd_file) != false) {
        output.okbn();
      } else {
        push(state.errors, { code: 'errorNftNetifdFileDelete', info: pkg.nft_netifd_file });
        output.failn();
      }
      break;
    }
    return true;
  };
  return nft_file;
}`;
    check('no guard on state.errors warns', getArgDiags(analyze(code)).length > 0, true);
}

// 4. Simple case: type guard on member expression without nesting
{
    const code = `function test(state) {
  if (type(state.errors) != "array") return;
  push(state.errors, "hello");
}`;
    check('simple member expr guard', getArgDiags(analyze(code)).length, 0);
}

// 5. Simple case: no guard, should warn
{
    const code = `function test(state) {
  push(state.errors, "hello");
}`;
    check('simple no guard warns', getArgDiags(analyze(code)).length > 0, true);
}

// 6. Deeper nesting: a.b.c
{
    const code = `function test(a) {
  if (type(a.b) != "object") return;
  if (type(a.b.c) != "array") return;
  push(a.b.c, "hello");
}`;
    check('deep member expr a.b.c guard', getArgDiags(analyze(code)).length, 0);
}

// 7. Guard on wrong member expression should still warn
{
    const code = `function test(state) {
  if (type(state.warnings) != "array") return;
  push(state.errors, "hello");
}`;
    check('guard on wrong member still warns', getArgDiags(analyze(code)).length > 0, true);
}

// 8. AND-combined negative guards: if (type(x) != "string" && type(x) != "array") return;
{
    const code = `function test(x) {
  if (type(x) != "string" && type(x) != "array")
    return;
  index(x, "foo");
}`;
    check('AND negative guards narrow to string|array', getArgDiags(analyze(code)).length, 0);
}

// 9. OR-combined positive guards in if-body: if (type(x) == "string" || type(x) == "array") { ... }
{
    const code = `function test(x) {
  if (type(x) == "string" || type(x) == "array") {
    index(x, "foo");
  }
}`;
    check('OR positive guards in if-body', getArgDiags(analyze(code)).length, 0);
}

// 10. OR early-return with type guard + non-guard: if (type(x) != "string" || !x) return;
{
    const code = `function test() {
  let content = readfile("/tmp/test");
  if (type(content) != 'string' || !content) return '9053';
  let m = match(content, /DNSPort\\s+\\S+:(\\d+)/);
  return m ? m[1] : '9053';
}`;
    check('OR guard: type(x) != string || !x narrows to string', getArgDiags(analyze(code)).length, 0);
}

// 11. OR early-return: type(x) != "array" || x == null
{
    const code = `function test(x) {
  if (type(x) != "array" || x == null) return;
  push(x, "hello");
}`;
    check('OR guard: type(x) != array || x == null', getArgDiags(analyze(code)).length, 0);
}

console.log(`\n${passed}/${passed + failed} tests passed`);
if (failed > 0) process.exit(1);
