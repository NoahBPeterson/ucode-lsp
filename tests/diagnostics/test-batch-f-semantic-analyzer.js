// Batch F regression tests (semanticAnalyzer):
//  - #05: a function-local module-typed variable (e.g. `let p = popen(...)`) must NOT
//         leak its type into a same-named local in an unrelated function.
//  - #94: `const f = (x) => …` / `const f = function(x){…}` reach the UC7003
//         "add JSDoc" hint (VariableDeclarator now sets pendingFunctionExprName).

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
        positionAt: (o) => { let l = 0, c = 0; for (let i = 0; i < o && i < code.length; i++) { if (code[i] === '\n') { l++; c = 0; } else { c++; } } return { line: l, character: c }; },
        offsetAt: (p) => { const lines = code.split('\n'); let o = 0; for (let i = 0; i < p.line && i < lines.length; i++) { o += lines[i].length + 1; } return o + p.character; },
        uri: 'file:///test.uc', languageId: 'ucode', version: 1
    };
    const analyzer = new SemanticAnalyzer(doc, { enableScopeAnalysis: true, enableTypeChecking: true });
    return analyzer.analyze(parseResult.ast);
}

let passed = 0, failed = 0;
function check(label, actual, expected) {
    if (actual === expected) { passed++; }
    else { failed++; console.log(`FAIL: ${label}: expected ${expected}, got ${actual}`); }
}

// --- #05: cross-function type leak -----------------------------------------
{
    // exec's `p` is fs.proc (from popen). get_status's own `p` is a JSON object.
    // Before the fix, exec's `p` polluted global scope and produced false
    // "Method 'X' does not exist on fs.proc" errors on get_status's `p`.
    const code = `import { popen } from 'fs';
function exec(cmd) { let p = popen(cmd, 'r'); return p.close(); }
function get_status(sd) {
  let peer_map = {};
  for (let p in sd.Peer) {
    p = sd.Peer[p];
    peer_map[p.ID] = { ip: p?.TailscaleIPs, host: p?.DNSName };
  }
  return peer_map;
}`;
    const result = analyze(code);
    const leaks = result.diagnostics.filter(d => /does not exist on fs\.proc/.test(d.message));
    check('#05 no fs.proc leak into unrelated function', leaks.length, 0);
}

{
    // Sanity: a genuine fs.proc misuse in the SAME function still errors, so the
    // fix suppresses the leak only, not real diagnostics.
    const code = `import { popen } from 'fs';
function exec(cmd) { let p = popen(cmd, 'r'); return p.TailscaleIPs; }`;
    const result = analyze(code);
    const errs = result.diagnostics.filter(d => /does not exist on fs\.proc/.test(d.message));
    check('#05 real fs.proc misuse in same function still flagged', errs.length, 1);
}

// --- #94: UC7003 for const arrow / function-expression ----------------------
function uc7003Count(result) {
    return result.diagnostics.filter(d => d.code === 'UC7003' || /Add .*@param/.test(d.message)).length;
}
{
    const code = `'use strict';\nconst f = (x) => substr(x, 0);\nprint(f);\n`;
    check('#94 UC7003 fires for const arrow with param', uc7003Count(analyze(code)), 1);
}
{
    const code = `'use strict';\nconst f = function(x) { return substr(x, 0); };\nprint(f);\n`;
    check('#94 UC7003 fires for const function-expression', uc7003Count(analyze(code)), 1);
}
{
    // Non-strict: UC7003 is strict-mode only, so no hint here.
    const code = `const f = (x) => substr(x, 0);\nprint(f);\n`;
    check('#94 no UC7003 outside strict mode', uc7003Count(analyze(code)), 0);
}

console.log(`\n${passed}/${passed + failed} tests passed`);
if (failed > 0) process.exit(1);
