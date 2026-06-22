// Tests for glob/lsdir element types and proto() narrowing.
// Exhaustively tests ALL argument types for correct narrowing.

import { UcodeLexer } from '../../src/lexer/ucodeLexer.ts';
import { UcodeParser } from '../../src/parser/ucodeParser.ts';
import { SemanticAnalyzer } from '../../src/analysis/semanticAnalyzer.ts';
import { typeToString } from '../../src/analysis/symbolTable.ts';

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

function getType(result, varName) {
    const sym = result.symbolTable.lookup(varName);
    return sym ? typeToString(sym.dataType) : 'NOT FOUND';
}

// A function parameter is the only genuinely type-unknown value in ucode (its type depends
// on the caller). For "unknown arg -> union" cases we check the inferred RETURN type of a
// one-line function whose body applies the builtin to its parameter.
function getRet(result, fnName) {
    const sym = result.symbolTable.lookup(fnName);
    return sym && sym.returnType ? typeToString(sym.returnType) : 'NO RETURN TYPE';
}

let passed = 0, failed = 0;
function check(label, actual, expected) {
    if (actual === expected) { passed++; }
    else { failed++; console.log(`FAIL: ${label}: expected "${expected}", got "${actual}"`); }
}

// ============================================================================
// glob() — element type is array<string>, nullMeansWrongType narrowing
// C source: returns NULL if arg is not string, array of strings otherwise
// ============================================================================

// Correct type: string → array<string> (null eliminated)
{
    const r = analyze(`import { glob } from "fs";\nlet a = glob("/tmp/*");`);
    check('glob(string_literal) -> array<string>', getType(r, 'a'), 'array<string>');
}
{
    const r = analyze(`import { glob } from "fs";\nlet x = "/tmp/*";\nlet a = glob(x);`);
    check('glob(string_var) -> array<string>', getType(r, 'a'), 'array<string>');
}

// Unknown type → full union preserved
{
    const r = analyze(`import { glob } from "fs";\nfunction _u(x) { return glob(x); }`);
    check('glob(unknown) -> array<string> | null', getRet(r, '_u'), 'array<string> | null');
}

// Wrong types → null (definitely not string)
{
    const r = analyze(`import { glob } from "fs";\nlet a = glob(null);`);
    check('glob(null) -> null', getType(r, 'a'), 'null');
}
{
    const r = analyze(`import { glob } from "fs";\nlet a = glob(123);`);
    check('glob(integer) -> null', getType(r, 'a'), 'null');
}
{
    const r = analyze(`import { glob } from "fs";\nlet a = glob(3.14);`);
    check('glob(double) -> null', getType(r, 'a'), 'null');
}
{
    const r = analyze(`import { glob } from "fs";\nlet a = glob(true);`);
    check('glob(boolean) -> null', getType(r, 'a'), 'null');
}
{
    const r = analyze(`import { glob } from "fs";\nlet a = glob([1, 2]);`);
    check('glob(array) -> null', getType(r, 'a'), 'null');
}
{
    const r = analyze(`import { glob } from "fs";\nlet a = glob({x: 1});`);
    check('glob(object) -> null', getType(r, 'a'), 'null');
}
{
    const r = analyze(`import { glob } from "fs";\nlet f = () => 1;\nlet a = glob(f);`);
    check('glob(function) -> null', getType(r, 'a'), 'null');
}

// Element type preserved when indexing
{
    const r = analyze(`import { glob } from "fs";\nlet files = glob("/tmp/*");\nlet a = files[0];`);
    check('glob result indexed -> string | null', getType(r, 'a'), 'string | null');
}

// ============================================================================
// lsdir() — element type is array<string>, NOT narrowable (runtime failure)
// C source: returns NULL on opendir failure (runtime), not just wrong types
// ============================================================================

{
    const r = analyze(`import { lsdir } from "fs";\nlet a = lsdir("/tmp");`);
    check('lsdir(string) -> array<string> | null', getType(r, 'a'), 'array<string> | null');
}
{
    const r = analyze(`import { lsdir } from "fs";\nfunction _u(x) { return lsdir(x); }`);
    check('lsdir(unknown) -> array<string> | null', getRet(r, '_u'), 'array<string> | null');
}

// ============================================================================
// proto() 1-arg form — query prototype
// C source: returns prototype object or null if arg doesn't have one
// Accepts: object, array. Rejects: string, integer, double, boolean, null, function
// ============================================================================

// Valid first arg types
{
    const r = analyze(`let obj = { x: 1 };\nlet a = proto(obj);`);
    check('proto(object) 1-arg -> object | null', getType(r, 'a'), 'object | null');
}
{
    const r = analyze(`let arr = [1, 2];\nlet a = proto(arr);`);
    check('proto(array) 1-arg -> object | null', getType(r, 'a'), 'object | null');
}

// Unknown first arg
{
    const r = analyze(`function _u(x) { return proto(x); }`);
    check('proto(unknown) 1-arg -> object | null', getRet(r, '_u'), 'object | null');
}

// ============================================================================
// proto() 2-arg form — set prototype, returns first arg
// C source: ucv_get(args, 0) — returns the first argument directly
// Valid first arg: object, array. Others → null
// ============================================================================

// Valid first arg types → returns that type
{
    const r = analyze(`let obj = { x: 1 };\nlet a = proto(obj, {});`);
    check('proto(object, obj) 2-arg -> object', getType(r, 'a'), 'object');
}
{
    const r = analyze(`let arr = [1, 2];\nlet a = proto(arr, {});`);
    check('proto(array, obj) 2-arg -> array', getType(r, 'a'), 'array');
}

// Unknown first arg → full union (could be anything)
{
    const r = analyze(`function _u(x) { return proto(x, {}); }`);
    check('proto(unknown, obj) 2-arg -> object | null', getRet(r, '_u'), 'object | null');
}

// Wrong first arg types → null
{
    const r = analyze(`let a = proto("hello", {});`);
    check('proto(string, obj) 2-arg -> null', getType(r, 'a'), 'null');
}
{
    const r = analyze(`let a = proto(123, {});`);
    check('proto(integer, obj) 2-arg -> null', getType(r, 'a'), 'null');
}
{
    const r = analyze(`let a = proto(3.14, {});`);
    check('proto(double, obj) 2-arg -> null', getType(r, 'a'), 'null');
}
{
    const r = analyze(`let a = proto(true, {});`);
    check('proto(boolean, obj) 2-arg -> null', getType(r, 'a'), 'null');
}
{
    const r = analyze(`let a = proto(null, {});`);
    check('proto(null, obj) 2-arg -> null', getType(r, 'a'), 'null');
}
{
    const r = analyze(`let f = () => 1;\nlet a = proto(f, {});`);
    check('proto(function, obj) 2-arg -> null', getType(r, 'a'), 'null');
}

console.log(`\n${passed}/${passed + failed} tests passed`);
if (failed > 0) process.exit(1);
