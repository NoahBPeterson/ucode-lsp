// Forward-declared function-valued `let` called inside a closure must NOT be flagged
// UC2010 "'x' is not a function (it is of type null)". The split form
// `let f; f = function(){ f(); };` is the canonical recursive-closure idiom in ucode
// (the name must be in scope inside its own body), heavily used across the OpenWrt
// corpus (mwan4 _ensure_init, pbr result, adblock-fast spawn, unetmsg cb).
// Runtime-verified: closures execute after the assignment runs, not at their textual
// position, so position-based flow state ("still null here") does not apply inside them.
// See docs/forward-declared-function-valued-let-uc1002.md.

import { test, expect } from 'bun:test';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { SemanticAnalyzer } from '../../src/analysis/semanticAnalyzer';
import { UcodeLexer } from '../../src/lexer/ucodeLexer';
import { UcodeParser } from '../../src/parser/ucodeParser';

function analyze(code) {
    const lexer = new UcodeLexer(code, { rawMode: true });
    const tokens = lexer.tokenize();
    const parser = new UcodeParser(tokens, code);
    const parseResult = parser.parse();
    const textDocument = TextDocument.create('file:///test-fwd-fn-let.uc', 'ucode', 1, code);
    const analyzer = new SemanticAnalyzer(textDocument, {
        enableScopeAnalysis: true,
        enableTypeChecking: true,
    });
    return analyzer.analyze(parseResult.ast).diagnostics;
}

const notCallableErrors = (diags) =>
    diags.filter(d => d.code === 'UC2010' || d.message.includes('is not a function'));

// ---- False positives that must stay suppressed (all runtime-verified valid) ----

test('strict split-form recursive closure is not flagged', () => {
    const diags = analyze(`'use strict';
let spawnr;
spawnr = function(n) {
    if (n > 0) spawnr(n - 1);
    else print("done\\n");
};
spawnr(3);
`);
    expect(notCallableErrors(diags)).toEqual([]);
});

test('strict split-form recursive arrow closure is not flagged', () => {
    const diags = analyze(`'use strict';
let cbfn;
cbfn = (n) => {
    if (n > 0) cbfn(n - 1);
};
cbfn(3);
`);
    expect(notCallableErrors(diags)).toEqual([]);
});

test('mutual recursion via split form is not flagged (partner assigned later)', () => {
    const diags = analyze(`'use strict';
let evenf, oddf;
evenf = function(n) { return n == 0 ? true : oddf(n - 1); };
oddf = function(n) { return n == 0 ? false : evenf(n - 1); };
evenf(4);
`);
    expect(notCallableErrors(diags)).toEqual([]);
});

test('helper assigned after the closure that calls it is not flagged', () => {
    const diags = analyze(`'use strict';
let helper;
function outer(x) {
    return helper(x);
}
helper = function(n) { return n; };
outer(3);
`);
    expect(notCallableErrors(diags)).toEqual([]);
});

test('non-strict split-form recursive closure stays clean', () => {
    const diags = analyze(`let recg;
recg = function(n) {
    return n > 0 ? recg(n - 1) : 0;
};
recg(3);
`);
    expect(notCallableErrors(diags)).toEqual([]);
});

// ---- True positives that must survive (all runtime-verified to error) ----

test('straight-line call before the assignment is still flagged', () => {
    // `ucode -e "'use strict'; let f; f(); f = function(){};"` →
    // "Type error: left-hand side is not a function"
    const diags = analyze(`'use strict';
let flin;
flin();
flin = function() {};
`);
    expect(notCallableErrors(diags).length).toBe(1);
});

test('closure calling a variable never assigned anything callable is still flagged', () => {
    const diags = analyze(`'use strict';
let numv;
numv = 5;
let gfn;
gfn = function() { return numv(); };
gfn();
`);
    expect(notCallableErrors(diags).length).toBe(1);
});

test('local let f; f() before assignment inside the SAME function is still flagged', () => {
    // The declaration is inside the same function as the call — straight-line
    // flow within one activation, not a capturing closure.
    const diags = analyze(`'use strict';
function outerf() {
    let locf;
    locf();
    locf = function() {};
}
outerf();
`);
    expect(notCallableErrors(diags).length).toBe(1);
});
