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

let pass = 0, fail = 0;
function test(name, fn) {
    try { fn(); pass++; console.log(`  PASS: ${name}`); }
    catch(e) { fail++; console.log(`  FAIL: ${name}: ${e.message}`); }
}

console.log('One-liner function guard scope tests:');

// Test 1: Outer guard on _p should NOT leak into function where _p is redeclared
test('outer guard does not leak into function with local _p', () => {
    const code = `
if (type(_p) != "string")
    return;
function is_dslite(iface) { let _p = network_get_protocol(iface); return _p != null && substr(_p, 0, 6) == 'dslite'; }
`;
    const result = analyze(code);
    // The outer guard on _p should not narrow the _p inside is_dslite
    // substr(_p, 0, 6) should still warn because _p is unknown inside the function
    const substrDiags = result.diagnostics.filter(d =>
        d.code === 'incompatible-function-argument' && d.message.includes('substr')
    );
    if (substrDiags.length !== 1) {
        throw new Error(`Expected 1 substr diagnostic, got ${substrDiags.length}: ${substrDiags.map(d=>d.message).join('; ')}`);
    }
});

// Test 2: Guard inside one-liner function should narrow correctly
test('guard inside one-liner function works', () => {
    const code = `function is_dslite(iface) { let _p = network_get_protocol(iface); if (type(_p) != "string") return; return substr(_p, 0, 6) == 'dslite'; }`;
    const result = analyze(code);
    const substrDiags = result.diagnostics.filter(d =>
        d.code === 'incompatible-function-argument' && d.message.includes('substr')
    );
    if (substrDiags.length !== 0) {
        throw new Error(`Expected 0 substr diagnostics after guard, got ${substrDiags.length}: ${substrDiags.map(d=>d.message).join('; ')}`);
    }
});

// Test 3: Guard on parameter in outer scope should not affect same-name local in function
test('outer param guard does not affect inner local', () => {
    const code = `
function outer(x) {
    if (type(x) != "string") return;
    function inner() { let x = get_val(); return substr(x, 0, 3); }
    return x;
}`;
    const result = analyze(code);
    const substrDiags = result.diagnostics.filter(d =>
        d.code === 'incompatible-function-argument' && d.message.includes('substr')
    );
    if (substrDiags.length !== 1) {
        throw new Error(`Expected 1 substr diagnostic in inner, got ${substrDiags.length}`);
    }
});

// Test 4: Same-name parameter in nested function should shadow outer guard
test('inner function parameter shadows outer guard', () => {
    const code = `
function outer(x) {
    if (type(x) != "string") return;
    function inner(x) { return substr(x, 0, 3); }
    return x;
}`;
    const result = analyze(code);
    const substrDiags = result.diagnostics.filter(d =>
        d.code === 'incompatible-function-argument' && d.message.includes('substr')
    );
    if (substrDiags.length !== 0) {
        // x is a parameter of inner, unknown type, should warn
        // Actually, inner's x is unknown, so it SHOULD warn
        // Wait - the guard is on outer's x, not inner's x
    }
    // inner(x) has its own x parameter which is unknown - should warn
    if (substrDiags.length !== 1) {
        throw new Error(`Expected 1 substr diagnostic for inner's x, got ${substrDiags.length}`);
    }
});

console.log(`\n${pass + fail} tests: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
