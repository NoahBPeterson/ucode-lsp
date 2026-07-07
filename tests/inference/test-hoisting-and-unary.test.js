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
import { SemanticAnalyzer } from '../../src/analysis/semanticAnalyzer';
import { UcodeLexer } from '../../src/lexer/ucodeLexer';
import { UcodeParser } from '../../src/parser/ucodeParser';

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
// Function forward references — ucode does NOT hoist function values (verified
// against /usr/local/bin/ucode: a call to a function declared later fails at
// runtime with "access to undeclared variable"). So a forward reference is flagged
// "used before its declaration"; backward references and recursion are fine.
// ---------------------------------------------------------------------------
describe('Function forward references (ucode does not hoist)', () => {
    const usedBeforeDecl = (result, name) => result.diagnostics.filter(d =>
        d.message.includes(`Function '${name}' is used before its declaration`));

    test('forward reference to a later top-level function IS flagged', () => {
        const code = `
let result = greet("world");

function greet(name) {
    return "hello " + name;
}
`;
        expect(usedBeforeDecl(analyze(code), 'greet').length).toBeGreaterThan(0);
    });

    test('a backward reference (function declared earlier) is clean', () => {
        const code = `
function greet(name) {
    return "hello " + name;
}
let result = greet("world");
`;
        expect(usedBeforeDecl(analyze(code), 'greet').length).toBe(0);
    });

    test('recursion (a function calling itself) is clean', () => {
        const code = `
function fac(n) { return n <= 1 ? 1 : n * fac(n - 1); }
fac(5);
`;
        expect(usedBeforeDecl(analyze(code), 'fac').length).toBe(0);
    });

    test('truly undefined function still produces "Undefined function"', () => {
        const code = `
let result = doesNotExist();
`;
        const result = analyze(code);
        expect(result.diagnostics.filter(d => d.message.includes('Undefined function: doesNotExist')).length).toBeGreaterThan(0);
        expect(usedBeforeDecl(result, 'doesNotExist').length).toBe(0);
    });

    test('multiple forward references are each flagged', () => {
        const code = `
let a = foo();
let b = bar();

function foo() { return 1; }
function bar() { return 2; }
`;
        const result = analyze(code);
        expect(usedBeforeDecl(result, 'foo').length).toBeGreaterThan(0);
        expect(usedBeforeDecl(result, 'bar').length).toBeGreaterThan(0);
    });

    test('function redeclaration with a backward call is clean', () => {
        const code = `
function dup() { return 1; }
function dup() { return 2; }
dup();
`;
        const result = analyze(code);
        expect(result.diagnostics.filter(d => d.message.includes('Undefined function: dup')).length).toBe(0);
        expect(usedBeforeDecl(result, 'dup').length).toBe(0);
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

    // ucode coerces strings to numbers for ++/-- ("42"++ → 43, "abc"++ → NaN);
    // it never throws, so there is no "Cannot apply" error (and string is
    // value-dependent, so it's not flagged by the NaN lint either).
    test('++ on a string variable does not error (numeric coercion)', () => {
        const code = `
let z = "42";
z++;
`;
        const result = analyze(code);
        const errors = result.diagnostics.filter(d =>
            d.message.includes('Cannot apply')
        );
        expect(errors.length).toBe(0);
    });

    test('-- on a string variable does not error (numeric coercion)', () => {
        const code = `
let z = "42";
z--;
`;
        const result = analyze(code);
        const errors = result.diagnostics.filter(d =>
            d.message.includes('Cannot apply')
        );
        expect(errors.length).toBe(0);
    });

    test('prefix ++ on a string variable does not error (numeric coercion)', () => {
        const code = `
let z = "42";
++z;
`;
        const result = analyze(code);
        const errors = result.diagnostics.filter(d =>
            d.message.includes('Cannot apply')
        );
        expect(errors.length).toBe(0);
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

    test('truly undefined lowercase variable should still warn', () => {
        const code = `
print(never_defined);
`;
        const result = analyze(code);
        const errors = result.diagnostics.filter(d =>
            d.message.includes('Undefined variable: never_defined')
        );
        expect(errors.length).toBeGreaterThan(0);
    });

    test('truly undefined SCREAMING_SNAKE read gets the injected-global treatment', () => {
        // All-caps unresolved reads are the ucode convention for CLI/host-injected globals.
        // An UNGUARDED value use (function argument) stays a WARNING with runtime-check
        // advice; only a bare truthiness test downgrades to a hint (the test doubles as
        // the runtime existence check). See docs/done/cli-defined-globals.md.
        const code = `
print(NEVER_DEFINED);
if (NEVER_DEFINED_2) print(1);
`;
        const result = analyze(code);
        const byName = (n) => result.diagnostics.find(d => d.code === 'UC1001' && d.message.includes(n));
        const valueUse = byName('NEVER_DEFINED');
        const guarded = byName('NEVER_DEFINED_2');
        expect(valueUse.severity).toBe(2); // Warning — unguarded value use
        expect(valueUse.message).toContain('host/CLI-injected');
        expect(guarded.severity).toBe(4);  // Hint — the if() IS the runtime check
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
        // The message shows the source-faithful regex suggestion (same one the quick-fix applies).
        expect(matchErrors[0].message).toContain('Did you mean /^hello$/');
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
// Flow-sensitive length() return type
// ---------------------------------------------------------------------------
describe('Flow-sensitive length() return type', () => {
    test('length() on a known string should not produce null-related warnings', () => {
        const code = `
let s = "hello";
let n = length(s);
let x = n + 1;
`;
        const result = analyze(code);
        const msgs = getDiagnosticMessages(result);
        const nullWarnings = msgs.filter(m =>
            m.includes('null') && (m.includes('length') || m.includes('n'))
        );
        expect(nullWarnings.length).toBe(0);
    });

    test('length() on an unknown variable should not crash', () => {
        const code = `
function test_len(val) {
    let n = length(val);
    return n;
}
`;
        const result = analyze(code);
        // Should not throw and should not produce errors about length itself
        const lengthErrors = result.diagnostics.filter(d =>
            d.message.includes("Function 'length'") && d.severity === 1
        );
        expect(lengthErrors.length).toBe(0);
    });

    test('length() on a known array should return integer', () => {
        const code = `
let arr = [1, 2, 3];
let n = length(arr);
let x = n + 1;
`;
        const result = analyze(code);
        const msgs = getDiagnosticMessages(result);
        const nullWarnings = msgs.filter(m =>
            m.includes('null') && (m.includes('length') || m.includes('n'))
        );
        expect(nullWarnings.length).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Flow-sensitive return type narrowing for other builtins
// ---------------------------------------------------------------------------
describe('Flow-sensitive return type narrowing', () => {
    test('keys() on a known object should return array', () => {
        const code = `
let obj = { a: 1, b: 2 };
let k = keys(obj);
let first = k[0];
`;
        const result = analyze(code);
        const msgs = getDiagnosticMessages(result);
        const nullWarnings = msgs.filter(m => m.includes('null') && m.includes('keys'));
        expect(nullWarnings.length).toBe(0);
    });

    test('index() on a known string should return integer', () => {
        const code = `
let s = "hello world";
let i = index(s, "world");
let x = i + 1;
`;
        const result = analyze(code);
        const msgs = getDiagnosticMessages(result);
        const nullWarnings = msgs.filter(m => m.includes('null') && m.includes('index'));
        expect(nullWarnings.length).toBe(0);
    });

    test('split() on a known string should return array', () => {
        const code = `
let s = "a,b,c";
let parts = split(s, ",");
let first = parts[0];
`;
        const result = analyze(code);
        const msgs = getDiagnosticMessages(result);
        const nullWarnings = msgs.filter(m => m.includes('null') && m.includes('split'));
        expect(nullWarnings.length).toBe(0);
    });

    test('trim() on a known string should return string', () => {
        const code = `
let s = "  hello  ";
let t = trim(s);
let n = length(t);
`;
        const result = analyze(code);
        const msgs = getDiagnosticMessages(result);
        const nullWarnings = msgs.filter(m => m.includes('null') && m.includes('trim'));
        expect(nullWarnings.length).toBe(0);
    });

    test('reverse() on a known array should return array', () => {
        const code = `
let arr = [1, 2, 3];
let rev = reverse(arr);
let first = rev[0];
`;
        const result = analyze(code);
        const msgs = getDiagnosticMessages(result);
        const nullWarnings = msgs.filter(m => m.includes('null') && m.includes('reverse'));
        expect(nullWarnings.length).toBe(0);
    });

    test('filter() on a known array should return array', () => {
        const code = `
let arr = [1, 2, 3, 4];
let evens = filter(arr, (x) => x % 2 == 0);
let n = length(evens);
`;
        const result = analyze(code);
        const msgs = getDiagnosticMessages(result);
        const nullWarnings = msgs.filter(m => m.includes('null') && m.includes('filter'));
        expect(nullWarnings.length).toBe(0);
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

// ---------------------------------------------------------------------------
// NaN-producing arithmetic lint.
// An array/object/function/regex operand can never become a finite number, so
// the operation always yields NaN. ucode doesn't throw — we warn (the result
// type stays `double`). Verified against /usr/local/bin/ucode. Strings are
// value-dependent ("42" works) so they are NOT flagged; `+` with a string is
// concatenation; null coerces to 0.
// ---------------------------------------------------------------------------
describe('NaN-producing arithmetic lint', () => {
    const nanWarnings = (result) =>
        result.diagnostics.filter(d => d.message.includes('produces NaN'));

    test("unary minus on an array literal flags NaN (no 'Cannot apply' hard error)", () => {
        const result = analyze(`let x = -[1, 2];`);
        expect(nanWarnings(result).length).toBeGreaterThan(0);
        expect(result.diagnostics.filter(d => d.message.includes('Cannot apply')).length).toBe(0);
    });

    test('binary arithmetic with an array operand warns', () => {
        const result = analyze(`let a = [1]; let x = a * 2;`);
        expect(nanWarnings(result).length).toBeGreaterThan(0);
    });

    test('object operand in subtraction warns', () => {
        const result = analyze(`let o = { k: 1 }; let x = o - 1;`);
        expect(nanWarnings(result).length).toBeGreaterThan(0);
    });

    test('array + string is concatenation, not NaN — no warning', () => {
        const result = analyze(`let a = [1]; let x = a + "s";`);
        expect(nanWarnings(result).length).toBe(0);
    });

    test('unary ~ on an array does not warn (yields an integer)', () => {
        const result = analyze(`let x = ~[1];`);
        expect(nanWarnings(result).length).toBe(0);
        expect(result.diagnostics.filter(d => d.message.includes('Cannot apply')).length).toBe(0);
    });

    test('unary minus on null does not warn (coerces to 0)', () => {
        const result = analyze(`let x = -null;`);
        expect(nanWarnings(result).length).toBe(0);
    });

    test('plain numeric arithmetic does not warn', () => {
        const result = analyze(`let x = 5 - 3; let y = 2 * 4;`);
        expect(nanWarnings(result).length).toBe(0);
    });

    test('unary minus on a string does not warn (value-dependent)', () => {
        const result = analyze(`let x = -"42";`);
        expect(nanWarnings(result).length).toBe(0);
    });

    // #106: NaN is a deterministic bug in both modes — always an Error, regardless
    // of `'use strict'`. DiagnosticSeverity: 1 = Error, 2 = Warning.
    test('non-strict: NaN op is an Error with code UC2008', () => {
        const result = analyze(`let a = [1]; let x = a - 1;`);
        const nan = nanWarnings(result);
        expect(nan.length).toBeGreaterThan(0);
        expect(nan[0].severity).toBe(1); // Error
        expect(nan[0].code).toBe('UC2008');
    });

    test("'use strict': NaN op is an Error (still UC2008, same message)", () => {
        const result = analyze(`'use strict';\nlet a = [1]; let x = a - 1;`);
        const nan = nanWarnings(result);
        expect(nan.length).toBeGreaterThan(0);
        expect(nan[0].severity).toBe(1); // Error
        expect(nan[0].code).toBe('UC2008');
    });

    test("'use strict': unary -[1] is an Error", () => {
        const result = analyze(`'use strict';\nlet x = -[1];`);
        const nan = nanWarnings(result);
        expect(nan.length).toBeGreaterThan(0);
        expect(nan[0].severity).toBe(1); // Error
    });
});
