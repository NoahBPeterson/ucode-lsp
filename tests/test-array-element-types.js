// Test that array element access produces correct types (e.g., ARGV[0] → string | null)
// and that rest parameter detection uses isRestParam flag.

import { UcodeLexer } from '../src/lexer/ucodeLexer.ts';
import { UcodeParser } from '../src/parser/ucodeParser.ts';
import { SemanticAnalyzer } from '../src/analysis/semanticAnalyzer.ts';
import { typeToString } from '../src/analysis/symbolTable.ts';

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

let passed = 0, failed = 0;
function check(label, actual, expected) {
    if (actual === expected) { passed++; }
    else { failed++; console.log(`FAIL: ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
}

// Test 1: ARGV should be typed as array<string>
{
    const result = analyze('let x = ARGV;');
    const sym = result.symbolTable.lookup('ARGV');
    check('ARGV type', typeToString(sym.dataType), 'array<string>');
}

// Test 2: ARGV[0] should be string | null
{
    const result = analyze('let script_path = ARGV[0];');
    const sym = result.symbolTable.lookup('script_path');
    check('ARGV[0] type', typeToString(sym.dataType), 'string | null');
}

// Test 3: ARGV[1] should also be string | null
{
    const result = analyze('let arg1 = ARGV[1];');
    const sym = result.symbolTable.lookup('arg1');
    check('ARGV[1] type', typeToString(sym.dataType), 'string | null');
}

// Test 4: Regular parameter should NOT be marked as rest param
{
    const result = analyze(`
function parse_array(val) {
    if (type(val) != "array") {
        val = split(val, /\\s+/);
    }
    return val;
}
`);
    const sym = result.symbolTable.lookup('val');
    check('regular param isRestParam', sym?.isRestParam || false, false);
}

// Test 5: ...rest parameter SHOULD be marked as rest param
{
    const code = `
function foo(a, ...rest) {
    return rest;
}
`;
    const result = analyze(code);
    // rest is in a function scope that has exited, so use lookupAtPosition
    const restOffset = code.indexOf('rest');
    const sym = result.symbolTable.lookupAtPosition('rest', restOffset);
    check('rest param isRestParam', sym?.isRestParam || false, true);
}

// Test 6: split() result indexed should be string | null
{
    const result = analyze('let parts = split("a b", " "); let first = parts[0];');
    const sym = result.symbolTable.lookup('first');
    check('split()[0] type', typeToString(sym.dataType), 'string | null');
}

// Test 7: Parameter reassignment should NOT overwrite declared type
{
    const code = `
function parse_array(val) {
    if (type(val) != "array") {
        val = split(val, /\\s+/);
    }
    return val;
}
`;
    const result = analyze(code);
    const paramOffset = code.indexOf('val)');
    const sym = result.symbolTable.lookupAtPosition('val', paramOffset);
    check('param declared type preserved', typeToString(sym.dataType), 'unknown');
    check('param currentType after reassign', sym.currentType ? typeToString(sym.currentType) : 'none', 'array | null');
}

// Test 8: Parameter hover should show unknown at declaration, reassigned type after assignment
{
    const code = `export function parse_array(val)
{
    if (type(val) != "array") {
        val = split(val, /\\s+/);
    }
    return val;
};
`;
    const result = analyze(code);
    const paramOffset = code.indexOf('val)');
    const sym = result.symbolTable.lookupAtPosition('val', paramOffset);

    // At declaration: dataType should be unknown
    check('export fn param dataType', typeToString(sym.dataType), 'unknown');

    // Simulate resolveVariableTypeForHover at param declaration offset
    const narrowed = result.typeChecker.getNarrowedTypeAtPosition('val', paramOffset);
    let effectiveType;
    if (narrowed) {
        effectiveType = narrowed;
    } else if (sym.currentType && sym.currentTypeEffectiveFrom !== undefined && paramOffset >= sym.currentTypeEffectiveFrom) {
        effectiveType = sym.currentType;
    } else {
        effectiveType = sym.dataType;
    }
    check('hover at param decl shows unknown', typeToString(effectiveType), 'unknown');

    // After the split assignment, hover should show array | null
    const returnOffset = code.indexOf('return val');
    const narrowedAtReturn = result.typeChecker.getNarrowedTypeAtPosition('val', returnOffset);
    let effectiveTypeAtReturn;
    if (narrowedAtReturn) {
        effectiveTypeAtReturn = narrowedAtReturn;
    } else if (sym.currentType && sym.currentTypeEffectiveFrom !== undefined && returnOffset >= sym.currentTypeEffectiveFrom) {
        effectiveTypeAtReturn = sym.currentType;
    } else {
        effectiveTypeAtReturn = sym.dataType;
    }
    check('hover after reassign shows array | null', typeToString(effectiveTypeAtReturn), 'array | null');
}

// Test 9: Parameter with no reassignment stays unknown
{
    const code = `
function identity(x) {
    return x;
}
`;
    const result = analyze(code);
    const paramOffset = code.indexOf('x)');
    const sym = result.symbolTable.lookupAtPosition('x', paramOffset);
    check('unmodified param is unknown', typeToString(sym.dataType), 'unknown');
    check('unmodified param has no currentType', sym.currentType, undefined);
}

// Test 10: Multiple parameter reassignments - last one wins
{
    const code = `
function multi(val) {
    val = 42;
    val = "hello";
    return val;
}
`;
    const result = analyze(code);
    const paramOffset = code.indexOf('val)');
    const sym = result.symbolTable.lookupAtPosition('val', paramOffset);
    check('multi-reassign param dataType preserved', typeToString(sym.dataType), 'unknown');
    // currentType should reflect the last assignment
    check('multi-reassign param currentType', sym.currentType ? typeToString(sym.currentType) : 'none', 'string');
}

// Test 11: isLikelyAssignmentTarget must not scan past ) and { tokens
// This was a bug where `parse_array(val)` followed by `{` caused the scanner
// to see `ret[TYPE_ARRAY] = parse_array` later in the file and wrongly mark
// `val` as an assignment target, which made hover show currentType instead of dataType.
{
    const code = `export function parse_array(val)
{
    if (type(val) != "array") {
        val = split(val, /\\s+/);
    }
    return val;
};
function __type_parsers()
{
    let ret = [];
    ret[TYPE_ARRAY] = parse_array;
    ret[TYPE_STRING] = function(val) {
        return val;
    };
    return ret;
}
`;
    const result = analyze(code);
    const parseArrayIdx = code.indexOf('parse_array(val)');
    const valOffset = code.indexOf('val)', parseArrayIdx);
    const sym = result.symbolTable.lookupAtPosition('val', valOffset);
    check('param in multi-fn file dataType', typeToString(sym.dataType), 'unknown');
    // Verify that the token-based isLikelyAssignmentTarget doesn't affect
    // resolveVariableTypeForHover — effectiveType must still be 'unknown'
    const narrowed = result.typeChecker.getNarrowedTypeAtPosition('val', valOffset);
    let effective;
    if (narrowed) {
        effective = narrowed;
    } else if (sym.currentType && sym.currentTypeEffectiveFrom !== undefined && valOffset >= sym.currentTypeEffectiveFrom) {
        effective = sym.currentType;
    } else {
        effective = sym.dataType;
    }
    check('param hover in multi-fn file', typeToString(effective), 'unknown');
}

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed} tests`);
if (failed > 0) process.exit(1);
