/**
 * Regression tests for:
 * - Function hoisting (forward references)
 * - Unary string coercion (+/- vs ++/--)
 * - Callback parameters called as functions
 * - Global property bare-identifier access
 * - Hoisted function diagnostic ranges
 */

import { test, expect, describe } from 'bun:test';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { SemanticAnalyzer } from '../src/analysis/semanticAnalyzer';
import { UcodeLexer } from '../src/lexer/ucodeLexer';
import { UcodeParser } from '../src/parser/ucodeParser';

function analyze(code) {
    const lexer = new UcodeLexer(code, { rawMode: true });
    const tokens = lexer.tokenize();
    const parser = new UcodeParser(tokens, code);
    const parseResult = parser.parse();

    const textDocument = TextDocument.create('file:///test.uc', 'ucode', 1, code);
    const analyzer = new SemanticAnalyzer(textDocument, {
        enableControlFlowAnalysis: false,
    });

    return analyzer.analyze(parseResult.ast);
}

function getDiagnosticMessages(result) {
    return result.diagnostics.map(d => d.message);
}

// ---------------------------------------------------------------------------
// Function hoisting
// ---------------------------------------------------------------------------
describe('Function hoisting', () => {
    test('forward reference to a top-level function should not produce "Undefined function"', () => {
        const code = `
let result = greet("world");

function greet(name) {
    return "hello " + name;
}
`;
        const result = analyze(code);
        const undefinedErrors = result.diagnostics.filter(d =>
            d.message.includes('Undefined function: greet')
        );
        expect(undefinedErrors.length).toBe(0);
    });

    test('truly undefined function should still produce an error', () => {
        const code = `
let result = doesNotExist();
`;
        const result = analyze(code);
        const undefinedErrors = result.diagnostics.filter(d =>
            d.message.includes('Undefined function: doesNotExist')
        );
        expect(undefinedErrors.length).toBeGreaterThan(0);
    });

    test('multiple forward references should all resolve', () => {
        const code = `
let a = foo();
let b = bar();

function foo() { return 1; }
function bar() { return 2; }
`;
        const result = analyze(code);
        const undefinedErrors = result.diagnostics.filter(d =>
            d.message.includes('Undefined function')
        );
        expect(undefinedErrors.length).toBe(0);
    });

    test('function redeclaration is allowed (last definition wins, like JS/ucode)', () => {
        const code = `
function dup() { return 1; }
function dup() { return 2; }
dup();
`;
        const result = analyze(code);
        const undefinedErrors = result.diagnostics.filter(d =>
            d.message.includes('Undefined function: dup')
        );
        expect(undefinedErrors.length).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Unary string coercion
// ---------------------------------------------------------------------------
describe('Unary string coercion', () => {
    test('unary + on a string literal should not produce an error', () => {
        const code = `let x = +"42";`;
        const result = analyze(code);
        const errors = result.diagnostics.filter(d =>
            d.message.includes('Cannot apply')
        );
        expect(errors.length).toBe(0);
    });

    test('unary - on a string literal should not produce an error', () => {
        const code = `let x = -"42";`;
        const result = analyze(code);
        const errors = result.diagnostics.filter(d =>
            d.message.includes('Cannot apply')
        );
        expect(errors.length).toBe(0);
    });

    test('++ on a string variable should produce an error', () => {
        const code = `
let z = "42";
z++;
`;
        const result = analyze(code);
        const errors = result.diagnostics.filter(d =>
            d.message.includes('Cannot apply ++ to string')
        );
        expect(errors.length).toBeGreaterThan(0);
    });

    test('-- on a string variable should produce an error', () => {
        const code = `
let z = "42";
z--;
`;
        const result = analyze(code);
        const errors = result.diagnostics.filter(d =>
            d.message.includes('Cannot apply -- to string')
        );
        expect(errors.length).toBeGreaterThan(0);
    });

    test('prefix ++ on a string variable should produce an error', () => {
        const code = `
let z = "42";
++z;
`;
        const result = analyze(code);
        const errors = result.diagnostics.filter(d =>
            d.message.includes('Cannot apply ++ to string')
        );
        expect(errors.length).toBeGreaterThan(0);
    });

    test('++ on a numeric variable should not produce an error', () => {
        const code = `
let n = 42;
n++;
`;
        const result = analyze(code);
        const errors = result.diagnostics.filter(d =>
            d.message.includes('Cannot apply')
        );
        expect(errors.length).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Callback parameters called as functions
// ---------------------------------------------------------------------------
describe('Callback parameters as functions', () => {
    test('callback parameter called as function should not produce "Undefined function"', () => {
        const code = `
function forEach(items, cb) {
    for (let i in items) {
        cb(items[i]);
    }
}
`;
        const result = analyze(code);
        const errors = result.diagnostics.filter(d =>
            d.message.includes('Undefined function: cb')
        );
        expect(errors.length).toBe(0);
    });

    test('closure-captured parameter called as function should not error', () => {
        const code = `
let wrapper = ((_orig) => function(...args) {
    _orig(...args);
})(print);
`;
        const result = analyze(code);
        const errors = result.diagnostics.filter(d =>
            d.message.includes('Undefined function: _orig')
        );
        expect(errors.length).toBe(0);
    });

    test('callback in object method should not error', () => {
        const code = `
let obj = {
    quiet_mode: function(mode, uci_getter) {
        if (mode == 'on') return;
        let v = uci_getter();
    },
};
`;
        const result = analyze(code);
        const errors = result.diagnostics.filter(d =>
            d.message.includes('Undefined function: uci_getter')
        );
        expect(errors.length).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Global property bare-identifier access
// ---------------------------------------------------------------------------
describe('Global property access', () => {
    test('global.FOO = value followed by bare FOO reference should not error', () => {
        const code = `
global.MOCK_SEARCH_PATH = [];
for (let dir in MOCK_SEARCH_PATH) {
    print(dir);
}
`;
        const result = analyze(code);
        const errors = result.diagnostics.filter(d =>
            d.message.includes('Undefined variable: MOCK_SEARCH_PATH')
        );
        expect(errors.length).toBe(0);
    });

    test('global.TRACE_CALLS = null followed by switch(TRACE_CALLS) should not error', () => {
        const code = `
global.TRACE_CALLS = null;
switch (TRACE_CALLS) {
    case '1': break;
    case 'stdout': break;
}
`;
        const result = analyze(code);
        const errors = result.diagnostics.filter(d =>
            d.message.includes('Undefined variable: TRACE_CALLS')
        );
        expect(errors.length).toBe(0);
    });

    test('truly undefined variable should still error', () => {
        const code = `
print(NEVER_DEFINED);
`;
        const result = analyze(code);
        const errors = result.diagnostics.filter(d =>
            d.message.includes('Undefined variable: NEVER_DEFINED')
        );
        expect(errors.length).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// match() regex suggestion
// ---------------------------------------------------------------------------
describe('match() regex suggestion', () => {
    test('match(str, "pattern") should suggest regex conversion', () => {
        const code = `
let str = "hello world";
let m = match(str, "^hello$");
`;
        const result = analyze(code);
        const matchErrors = result.diagnostics.filter(d =>
            d.message.includes('match') && d.message.includes('regex')
        );
        expect(matchErrors.length).toBeGreaterThan(0);
        expect(matchErrors[0].message).toContain('Did you mean: /^hello$/');
    });

    test('match(str, /pattern/) should not produce a regex suggestion error', () => {
        const code = `
let str = "hello world";
let m = match(str, /^hello$/);
`;
        const result = analyze(code);
        const matchErrors = result.diagnostics.filter(d =>
            d.message.includes('match') && d.message.includes('Did you mean')
        );
        expect(matchErrors.length).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Hoisted function diagnostic ranges
// ---------------------------------------------------------------------------
describe('Hoisted function diagnostic ranges', () => {
    test('unused hoisted function diagnostic should point to the actual declaration', () => {
        const code = `
function unused_func() {
    return 42;
}
`;
        const result = analyze(code);
        const unusedWarnings = result.diagnostics.filter(d =>
            d.message.includes("'unused_func'") && d.message.includes('never used')
        );
        // The diagnostic should exist
        expect(unusedWarnings.length).toBeGreaterThan(0);
        // The diagnostic range should NOT start at position 0 (the synthetic hoisted position)
        // It should point to the actual function name in the source
        const warning = unusedWarnings[0];
        const startOffset = warning.range.start.line * 1000 + warning.range.start.character;
        expect(startOffset).toBeGreaterThan(0);
    });
});
