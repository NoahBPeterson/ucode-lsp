// Flow-typing of a variable's EFFECTIVE type at a later read, by how it was assigned.
//
// Replaces three quarantined console.log scratch scripts (test-hover-fs-types.js,
// test-final-comprehensive.js, test-assignment-type-inference.js) with real assertions
// against the analyzer (no server spawn — runs natively under `bun test`).
//
// It pins both what WORKS and a KNOWN LIMITATION the scratch scripts were probing:
// reassigning a bare `let` (declared without an initializer) to a CALL that returns a
// union/nullable type (e.g. open() → fs.file | null) does not propagate that type to
// later reads — the variable reads back as `unknown`. Direct initialization and literal
// reassignment both work. See docs/flow-reassignment-union-call-gap.md. When that gap is
// fixed, flip the two LIMITATION assertions to expect `fs.file | null`.

import { test, expect, describe } from 'bun:test';
import { UcodeLexer } from '../../src/lexer/ucodeLexer.ts';
import { UcodeParser } from '../../src/parser/ucodeParser.ts';
import { SemanticAnalyzer } from '../../src/analysis/semanticAnalyzer.ts';
import { typeToString } from '../../src/analysis/symbolTable.ts';

function docFor(code) {
    return {
        getText: () => code,
        positionAt: (o) => { let l = 0, c = 0; for (let i = 0; i < o && i < code.length; i++) { if (code[i] === '\n') { l++; c = 0; } else { c++; } } return { line: l, character: c }; },
        offsetAt: (p) => { const lines = code.split('\n'); let o = 0; for (let i = 0; i < p.line && i < lines.length; i++) { o += lines[i].length + 1; } return o + p.character; },
        uri: 'file:///test.uc', languageId: 'ucode', version: 1,
    };
}

// Effective type of `name` at the LAST occurrence of `marker` in `code`, mirroring how
// hover resolves a read: the flow-narrowed currentType if present, else the declared type.
function typeAtRead(code, name, marker) {
    const lexer = new UcodeLexer(code, { rawMode: true });
    const tokens = lexer.tokenize();
    const result = new SemanticAnalyzer(docFor(code), { enableScopeAnalysis: true, enableTypeChecking: true })
        .analyze(new UcodeParser(tokens, code).parse().ast);
    const offset = code.lastIndexOf(marker);
    const sym = result.symbolTable.lookupAtPosition
        ? (result.symbolTable.lookupAtPosition(name, offset) ?? result.symbolTable.lookup(name))
        : result.symbolTable.lookup(name);
    if (!sym) return '(no-symbol)';
    const t = sym.currentType ?? sym.dataType;
    return t ? typeToString(t) : 'unknown';
}

describe('fs/flow reassignment typing — works', () => {
    test('direct init from open() → fs.file', () => {
        expect(typeAtRead('let a = open("/x");\nprint(a);\n', 'a', 'a)')).toBe('fs.file');
    });
    test('bare-let reassigned to int literal flows', () => {
        expect(typeAtRead('let b;\nb = 5;\nprint(b);\n', 'b', 'b)')).toBe('integer');
    });
    test('bare-let reassigned to string literal flows', () => {
        expect(typeAtRead('let b;\nb = "hi";\nprint(b);\n', 'b', 'b)')).toBe('string');
    });
    test('bare-let reassigned to array literal flows', () => {
        expect(typeAtRead('let b;\nb = [1, 2];\nprint(b);\n', 'b', 'b)')).toBe('array<integer>');
    });
    test('most-recent wins across two literal reassignments', () => {
        expect(typeAtRead('let b;\nb = 5;\nb = "x";\nprint(b);\n', 'b', 'b)')).toBe('string');
    });
});

describe('fs/flow reassignment typing — KNOWN LIMITATION (union-returning call)', () => {
    // These pin CURRENT behavior. The assigned value is really `fs.file | null`; ideally the
    // read would reflect that. Today it reads back `unknown`. When the gap is fixed, change
    // these expectations. See docs/flow-reassignment-union-call-gap.md.
    test('bare-let reassigned to open() does NOT yet flow (reads unknown)', () => {
        expect(typeAtRead('let b;\nb = open("/x");\nprint(b);\n', 'b', 'b)')).toBe('unknown');
    });
    test('init-then-reassign to open() does NOT yet flow (reads unknown)', () => {
        expect(typeAtRead('let b = 0;\nb = open("/x");\nprint(b);\n', 'b', 'b)')).toBe('unknown');
    });
    test('assignment inside try{} does NOT yet flow (reads unknown)', () => {
        expect(typeAtRead('let c;\ntry { c = open("/x"); } catch (e) {}\nprint(c);\n', 'c', 'c)')).toBe('unknown');
    });
});
