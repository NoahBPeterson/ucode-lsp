// Flow-typing of a variable's EFFECTIVE type at a later read, by how it was assigned.
//
// Replaces three quarantined console.log scratch scripts (test-hover-fs-types.js,
// test-final-comprehensive.js, test-assignment-type-inference.js) with real assertions
// against the analyzer (no server spawn — runs natively under `bun test`).
//
// It pins what WORKS, including the case the scratch scripts were probing: reassigning a
// bare `let` (declared without an initializer) to a CALL that returns an fs object / union
// type (e.g. open() → fs.file, readlink() → string | null) now propagates that type to
// later reads, matching the declaration path. Previously the reassignment path dropped it
// to `unknown` (a false-negative class — downstream nullability went unanalyzed). Fixed by
// mirroring the declarator's inferFsType / inferImportedFsFunctionReturnType resolution in
// visitAssignmentExpression. See docs/done/flow-reassignment-union-call-gap.md.

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

function analyze(code) {
    const tokens = new UcodeLexer(code, { rawMode: true }).tokenize();
    return new SemanticAnalyzer(docFor(code), { enableScopeAnalysis: true, enableTypeChecking: true })
        .analyze(new UcodeParser(tokens, code).parse().ast);
}

// Effective type of `name` at the LAST occurrence of `marker` in `code`, mirroring how
// hover resolves a read: the flow-narrowed currentType if present, else the declared type.
function typeAtRead(code, name, marker) {
    const result = analyze(code);
    const offset = code.lastIndexOf(marker);
    const sym = result.symbolTable.lookupAtPosition
        ? (result.symbolTable.lookupAtPosition(name, offset) ?? result.symbolTable.lookup(name))
        : result.symbolTable.lookup(name);
    if (!sym) return '(no-symbol)';
    const t = sym.currentType ?? sym.dataType;
    return t ? typeToString(t) : 'unknown';
}

const countCode = (code, errCode) => analyze(code).diagnostics.filter(d => d.code === errCode).length;

describe('fs/flow reassignment typing — works', () => {
    test('direct init from open() → fs.file | null (open can fail at runtime)', () => {
        expect(typeAtRead('let a = open("/x");\nprint(a);\n', 'a', 'a)')).toBe('fs.file | null');
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

describe('fs/flow reassignment typing — fs / union-returning call (FIXED)', () => {
    // Reassignment to an fs-returning call now flows the type, matching direct init.
    // open() can fail at runtime (returns null), so the sound type is `fs.file | null`.
    test('bare-let reassigned to open() flows → fs.file | null', () => {
        expect(typeAtRead('let b;\nb = open("/x");\nprint(b);\n', 'b', 'b)')).toBe('fs.file | null');
    });
    test('init-then-reassign to open() flows → fs.file | null', () => {
        expect(typeAtRead('let b = 0;\nb = open("/x");\nprint(b);\n', 'b', 'b)')).toBe('fs.file | null');
    });
    test('assignment inside try{} flows → fs.file | null', () => {
        expect(typeAtRead('let c;\ntry { c = open("/x"); } catch (e) {}\nprint(c);\n', 'c', 'c)')).toBe('fs.file | null');
    });
    test('imported fs fn returning a UNION flows the union (readlink → string | null)', () => {
        expect(typeAtRead('import { readlink } from "fs";\nlet d;\nd = readlink("/x");\nprint(d);\n', 'd', 'd)')).toBe('string | null');
    });
    test('most-recent wins: literal reassign AFTER an open() reassign', () => {
        expect(typeAtRead('let b;\nb = open("/x");\nb = 5;\nprint(b);\n', 'b', 'b)')).toBe('integer');
    });
});

// The soundness payoff: because the type now carries `| null`, an unguarded member access on
// an open() handle is flagged (UC5006 possibly-null), and a null guard clears it. Previously
// the dropped null made this a SILENT false negative. See docs/done/flow-reassignment-union-call-gap.md.
describe('fs/flow reassignment typing — nullable handle is enforced (UC5006)', () => {
    const UC5006 = 'UC5006';
    test('unguarded member access on a direct-init open() handle is flagged', () => {
        expect(countCode('import { open } from "fs";\nlet a = open("/x");\na.read("line");\n', UC5006)).toBeGreaterThanOrEqual(1);
    });
    test('unguarded member access on a REASSIGNED open() handle is flagged', () => {
        expect(countCode('import { open } from "fs";\nlet b;\nb = open("/x");\nb.read("line");\n', UC5006)).toBeGreaterThanOrEqual(1);
    });
    test('a truthiness guard narrows away null → no UC5006', () => {
        expect(countCode('import { open } from "fs";\nlet a = open("/x");\nif (a) a.read("line");\n', UC5006)).toBe(0);
    });
    test('optional chaining on the handle → no UC5006', () => {
        expect(countCode('import { open } from "fs";\nlet a = open("/x");\na?.read("line");\n', UC5006)).toBe(0);
    });
});
