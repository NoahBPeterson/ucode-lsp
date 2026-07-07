// Tests for flow-sensitive hover — variables show the correct type at each
// position in the file, not the "final" type from a later assignment.
// Uses Effect Match.exhaustive for exhaustive UcodeType coverage.

import { UcodeLexer } from '../../src/lexer/ucodeLexer.ts';
import { UcodeParser } from '../../src/parser/ucodeParser.ts';
import { SemanticAnalyzer } from '../../src/analysis/semanticAnalyzer.ts';
import { typeToString, UcodeType } from '../../src/analysis/symbolTable.ts';
import { Match } from 'effect';

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

// Simulate hover type resolution (same logic as resolveVariableTypeForHover)
function hoverTypeAt(result, varName, offset) {
    const sym = result.symbolTable.lookup(varName);
    if (!sym) return 'NOT FOUND';
    if (sym.currentType && sym.currentTypeEffectiveFrom !== undefined && offset >= sym.currentTypeEffectiveFrom) {
        return typeToString(sym.currentType);
    }
    return typeToString(sym.dataType);
}

let passed = 0, failed = 0;
function check(label, actual, expected) {
    if (actual === expected) { passed++; }
    else { failed++; console.log(`FAIL: ${label}: expected "${expected}", got "${actual}"`); }
}

// Exhaustive snippet generator — Match.exhaustive guarantees coverage of all UcodeType values
const snippetForType = (t) => Match.value(t).pipe(
    Match.when(UcodeType.INTEGER,  () => ({ assign: 'x = 42;', expected: 'integer' })),
    Match.when(UcodeType.DOUBLE,   () => ({ assign: 'x = 3.14;', expected: 'double' })),
    Match.when(UcodeType.STRING,   () => ({ assign: 'x = "hello";', expected: 'string' })),
    Match.when(UcodeType.BOOLEAN,  () => ({ assign: 'x = true;', expected: 'boolean' })),
    Match.when(UcodeType.ARRAY,    () => ({ assign: 'x = [1, 2];', expected: 'array<integer>' })),
    Match.when(UcodeType.OBJECT,   () => ({ assign: 'x = { a: 1 };', expected: 'object' })),
    Match.when(UcodeType.FUNCTION, () => ({ assign: 'x = () => 1;', expected: 'function' })),
    Match.when(UcodeType.REGEX,    () => ({ assign: 'x = /test/;', expected: 'regexp' })),
    Match.when(UcodeType.NULL,     () => ({ assign: 'x = null;', expected: 'null' })),
    Match.when(UcodeType.UNKNOWN,  () => null), // can't assign "unknown"
    Match.when(UcodeType.UNION,    () => null),
    Match.exhaustive
);

const CONCRETE_TYPES = Object.values(UcodeType).filter(t => t !== UcodeType.UNION && t !== UcodeType.UNKNOWN);

// ============================================================================
// 1. Basic: uninitialized variable is `null` before assignment, typed after
//    (ucode: an uninitialized binding is definitively null — verified vs the interpreter)
// ============================================================================
{
    const code = 'let x;\nprint(x);\nx = [1, 2, 3];\nprint(x);\n';
    const r = analyze(code);
    const beforeOffset = code.indexOf('print(x)') + 6;
    const afterOffset = code.lastIndexOf('print(x)') + 6;
    check('uninitialized before assignment -> null', hoverTypeAt(r, 'x', beforeOffset), 'null');
    check('uninitialized after assignment -> array<integer>', hoverTypeAt(r, 'x', afterOffset), 'array<integer>');
}

// ============================================================================
// 2. Exhaustive: every UcodeType assigned to uninitialized variable
//    Before assignment → null (uninitialized). After → the assigned type.
// ============================================================================
for (const ucType of CONCRETE_TYPES) {
    const info = snippetForType(ucType);
    if (!info) continue;
    const code = `let x;\nprint(x);\n${info.assign}\nprint(x);\n`;
    const r = analyze(code);
    const beforeOffset = code.indexOf('print(x)') + 6;
    const afterOffset = code.lastIndexOf('print(x)') + 6;
    check(`${ucType}: before assignment -> null`, hoverTypeAt(r, 'x', beforeOffset), 'null');
    check(`${ucType}: after assignment -> ${info.expected}`, hoverTypeAt(r, 'x', afterOffset), info.expected);
}

// ============================================================================
// 3. Initialized variable retains declared type before reassignment
// ============================================================================
{
    const code = 'let x = "hello";\nprint(x);\nx = 42;\nprint(x);\n';
    const r = analyze(code);
    const beforeOffset = code.indexOf('print(x)') + 6;
    const afterOffset = code.lastIndexOf('print(x)') + 6;
    check('initialized string before reassignment -> string', hoverTypeAt(r, 'x', beforeOffset), 'string');
    check('initialized string after reassignment to int -> integer', hoverTypeAt(r, 'x', afterOffset), 'integer');
}

// ============================================================================
// 4. Multiple reassignments — last one wins for positions after it
// ============================================================================
{
    const code = 'let x;\nprint(x);\nx = "a";\nprint(x);\nx = 42;\nprint(x);\n';
    const r = analyze(code);
    const lines = code.split('\n');
    let offset = 0;
    const offsets = [];
    for (const line of lines) {
        const idx = line.indexOf('print(x)');
        if (idx >= 0) offsets.push(offset + idx + 6);
        offset += line.length + 1;
    }
    check('multi-assign: before any assignment -> null', hoverTypeAt(r, 'x', offsets[0]), 'null');
    // After last assignment (integer), hover should show integer
    check('multi-assign: after last assignment -> integer', hoverTypeAt(r, 'x', offsets[2]), 'integer');
}

// ============================================================================
// 5. Real-world pattern from user's file: cpus declared, used, then assigned
// ============================================================================
{
    const code = `let cpus;
let debug = 0;

function cpu_mask(cpu) {
    let mask;
    if (cpu < 0)
        mask = (1 << length(cpus)) - 1;
    else
        mask = (1 << int(cpu));
    return mask;
}

print(cpus);

cpus = map(["/sys/bus/cpu/devices/cpu0"], (path) => {
    return { id: 0, core: 0, load: 0.0 };
});

print(cpus);
`;
    const r = analyze(code);
    const beforeOffset = code.indexOf('print(cpus)') + 6;
    const afterOffset = code.lastIndexOf('print(cpus)') + 6;
    check('real-world: cpus before map assignment -> null', hoverTypeAt(r, 'cpus', beforeOffset), 'null');
    // After map() assignment, cpus should have a type (at minimum array)
    const afterType = hoverTypeAt(r, 'cpus', afterOffset);
    check('real-world: cpus after map assignment is array-ish', afterType.startsWith('array'), true);
}

// ============================================================================
// 6. Module function results: fs.open before vs after assignment
// ============================================================================
{
    const code = `import { open } from 'fs';
let handle;
print(handle);
handle = open("/tmp/test", "r");
print(handle);
`;
    const r = analyze(code);
    const beforeOffset = code.indexOf('print(handle)') + 6;
    const afterOffset = code.lastIndexOf('print(handle)') + 6;
    check('fs.open: handle before assignment -> null', hoverTypeAt(r, 'handle', beforeOffset), 'null');
    // After assignment, should be fs.file or fs.file | null
    const afterType = hoverTypeAt(r, 'handle', afterOffset);
    check('fs.open: handle after assignment includes fs.file', afterType.includes('fs.file'), true);
}

console.log(`\n${passed}/${passed + failed} tests passed`);
if (failed > 0) process.exit(1);
