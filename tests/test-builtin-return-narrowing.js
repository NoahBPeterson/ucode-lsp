// Tests for builtin function return type narrowing based on argument types.
// Per C source (lib.c): many builtins return null only when passed wrong arg types.
// When we can prove arg types are correct at analysis time, null should be eliminated.
//
// Test pattern: assign result of builtin call to a variable, check its hover type.
// This tests the type as visible to the user via hover, not internal LSP state.

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

function getType(result, varName) {
    const sym = result.symbolTable.lookup(varName);
    return sym ? typeToString(sym.dataType) : 'NOT FOUND';
}

let passed = 0, failed = 0;
function check(label, actual, expected) {
    if (actual === expected) { passed++; }
    else { failed++; console.log(`FAIL: ${label}: expected "${expected}", got "${actual}"`); }
}

// ============================================================================
// Workstream A: Argument-type narrowing (nullMeansWrongType)
// When arg types are known correct, null should be eliminated from return type.
// When arg types are unknown, the full union (with null) should remain.
// ============================================================================

// --- length(x): arg is string|array|object -> integer; otherwise integer | null ---
{
    const r = analyze(`let s = "hello"; let a = length(s);`);
    check('length(string) -> integer', getType(r, 'a'), 'integer');
}
{
    const r = analyze(`let s = [1,2]; let a = length(s);`);
    check('length(array) -> integer', getType(r, 'a'), 'integer');
}
{
    const r = analyze(`let s = {a:1}; let a = length(s);`);
    check('length(object) -> integer', getType(r, 'a'), 'integer');
}
{
    const r = analyze(`let x; let a = length(x);`);
    check('length(unknown) -> integer | null', getType(r, 'a'), 'integer | null');
}

// --- index(haystack, needle): arg1 is string|array -> integer; otherwise integer | null ---
{
    const r = analyze(`let a = index("hello", "l");`);
    check('index(string, string) -> integer', getType(r, 'a'), 'integer');
}
{
    const r = analyze(`let a = index([1,2,3], 2);`);
    check('index(array, int) -> integer', getType(r, 'a'), 'integer');
}
{
    const r = analyze(`let x; let a = index(x, "l");`);
    check('index(unknown, string) -> integer | null', getType(r, 'a'), 'integer | null');
}

// --- rindex(haystack, needle): arg1 is string|array -> integer; otherwise integer | null ---
{
    const r = analyze(`let a = rindex("hello", "l");`);
    check('rindex(string, string) -> integer', getType(r, 'a'), 'integer');
}
{
    const r = analyze(`let x; let a = rindex(x, "l");`);
    check('rindex(unknown, string) -> integer | null', getType(r, 'a'), 'integer | null');
}

// --- join(sep, arr): arg2 is array -> string; otherwise string | null ---
{
    const r = analyze(`let a = join(",", [1,2,3]);`);
    check('join(string, array) -> string', getType(r, 'a'), 'string');
}
{
    const r = analyze(`let x; let a = join(",", x);`);
    check('join(string, unknown) -> string | null', getType(r, 'a'), 'string | null');
}

// --- substr(str, start, len?): arg1 is string -> string; otherwise string | null ---
{
    const r = analyze(`let a = substr("hello", 1, 3);`);
    check('substr(string, int, int) -> string', getType(r, 'a'), 'string');
}
{
    const r = analyze(`let x; let a = substr(x, 1);`);
    check('substr(unknown, int) -> string | null', getType(r, 'a'), 'string | null');
}

// --- trim(str, chars?): arg1 is string -> string; otherwise string | null ---
{
    const r = analyze(`let a = trim("  hello  ");`);
    check('trim(string) -> string', getType(r, 'a'), 'string');
}
{
    const r = analyze(`let x; let a = trim(x);`);
    check('trim(unknown) -> string | null', getType(r, 'a'), 'string | null');
}

// --- ltrim ---
{
    const r = analyze(`let a = ltrim("  hello");`);
    check('ltrim(string) -> string', getType(r, 'a'), 'string');
}
{
    const r = analyze(`let x; let a = ltrim(x);`);
    check('ltrim(unknown) -> string | null', getType(r, 'a'), 'string | null');
}

// --- rtrim ---
{
    const r = analyze(`let a = rtrim("hello  ");`);
    check('rtrim(string) -> string', getType(r, 'a'), 'string');
}
{
    const r = analyze(`let x; let a = rtrim(x);`);
    check('rtrim(unknown) -> string | null', getType(r, 'a'), 'string | null');
}

// --- replace(str, pattern, repl): all 3 args non-null -> string; otherwise string | null ---
{
    const r = analyze(`let a = replace("hello", "l", "r");`);
    check('replace(string, string, string) -> string', getType(r, 'a'), 'string');
}
{
    const r = analyze(`let x; let a = replace(x, "l", "r");`);
    check('replace(unknown, string, string) -> string | null', getType(r, 'a'), 'string | null');
}

// --- uc(str): arg is non-null -> string; otherwise string | null ---
{
    const r = analyze(`let a = uc("hello");`);
    check('uc(string) -> string', getType(r, 'a'), 'string');
}
{
    const r = analyze(`let x; let a = uc(x);`);
    check('uc(unknown) -> string | null', getType(r, 'a'), 'string | null');
}

// --- lc(str): arg is non-null -> string; otherwise string | null ---
{
    const r = analyze(`let a = lc("HELLO");`);
    check('lc(string) -> string', getType(r, 'a'), 'string');
}
{
    const r = analyze(`let x; let a = lc(x);`);
    check('lc(unknown) -> string | null', getType(r, 'a'), 'string | null');
}

// --- type(val): arg is non-null -> string; null arg -> null ---
// Note: type(null) returns null per C source, not "null" string
{
    const r = analyze(`let a = type("hello");`);
    check('type(string) -> string', getType(r, 'a'), 'string');
}
{
    const r = analyze(`let a = type([1,2]);`);
    check('type(array) -> string', getType(r, 'a'), 'string');
}
{
    const r = analyze(`let x; let a = type(x);`);
    check('type(unknown) -> string | null', getType(r, 'a'), 'string | null');
}

// --- keys(obj): arg is object -> array; otherwise array | null ---
{
    const r = analyze(`let a = keys({x: 1});`);
    check('keys(object) -> array<string>', getType(r, 'a'), 'array<string>');
}
{
    const r = analyze(`let x; let a = keys(x);`);
    check('keys(unknown) -> array | null', getType(r, 'a'), 'array | null');
}

// --- values(obj): arg is object -> array; otherwise array | null ---
{
    const r = analyze(`let a = values({x: 1});`);
    check('values(object) -> array', getType(r, 'a'), 'array');
}
{
    const r = analyze(`let x; let a = values(x);`);
    check('values(unknown) -> array | null', getType(r, 'a'), 'array | null');
}

// --- uniq(arr): arg is array -> array; otherwise array | null ---
{
    const r = analyze(`let a = uniq([1,2,3,2]);`);
    // uniq preserves element types from the input array literal
    check('uniq(array<integer>) -> array<integer>', getType(r, 'a'), 'array<integer>');
}
{
    const r = analyze(`let x; let a = uniq(x);`);
    check('uniq(unknown) -> array | null', getType(r, 'a'), 'array | null');
}

// --- b64enc(str): arg is string -> string; otherwise string | null ---
{
    const r = analyze(`let a = b64enc("hello");`);
    check('b64enc(string) -> string', getType(r, 'a'), 'string');
}
{
    const r = analyze(`let x; let a = b64enc(x);`);
    check('b64enc(unknown) -> string | null', getType(r, 'a'), 'string | null');
}

// --- hexenc(val): arg is non-null -> string; otherwise string | null ---
{
    const r = analyze(`let a = hexenc("hello");`);
    check('hexenc(string) -> string', getType(r, 'a'), 'string');
}
{
    const r = analyze(`let x; let a = hexenc(x);`);
    check('hexenc(unknown) -> string | null', getType(r, 'a'), 'string | null');
}

// --- wildcard(subject, pattern, nocase?): arg1 non-null, arg2 string -> boolean ---
{
    const r = analyze(`let a = wildcard("file.txt", "*.txt");`);
    check('wildcard(string, string) -> boolean', getType(r, 'a'), 'boolean');
}
{
    const r = analyze(`let x; let a = wildcard(x, "*.txt");`);
    check('wildcard(unknown, string) -> boolean | null', getType(r, 'a'), 'boolean | null');
}

// --- splice(arr, start, count?, ...items): arg1 is array -> array; otherwise array | null ---
{
    const r = analyze(`let arr = [1,2,3]; let a = splice(arr, 1, 1);`);
    // splice preserves element types from the input array literal
    check('splice(array<integer>, int, int) -> array<integer>', getType(r, 'a'), 'array<integer>');
}
{
    const r = analyze(`let x; let a = splice(x, 1, 1);`);
    check('splice(unknown, int, int) -> array | null', getType(r, 'a'), 'array | null');
}

// --- split(str, sep, limit?): arg1 string + arg2 string -> array; already partially handled ---
{
    const r = analyze(`let a = split("a,b,c", ",");`);
    // split returns array<string> when both args are known string
    check('split(string, string) -> array<string>', getType(r, 'a'), 'array<string>');
}
{
    const r = analyze(`let x; let a = split(x, ",");`);
    check('split(unknown, string) -> array | null', getType(r, 'a'), 'array | null');
}

// ============================================================================
// Workstream B: Argument-count narrowing
// Return type depends on number of arguments passed.
// ============================================================================

// --- getenv(): 0 args -> object; 1 arg -> string | null ---
{
    const r = analyze(`let a = getenv();`);
    check('getenv() -> object', getType(r, 'a'), 'object');
}
{
    const r = analyze(`let a = getenv("PATH");`);
    check('getenv(string) -> string | null', getType(r, 'a'), 'string | null');
}

// --- proto(obj): 1 arg -> object | null (getter); 2 args -> returns first arg ---
{
    const r = analyze(`let obj = {}; let a = proto(obj);`);
    check('proto(object) -> object | null', getType(r, 'a'), 'object | null');
}

// --- gc(): no args or "collect" -> boolean; "count" -> integer ---
{
    const r = analyze(`let a = gc();`);
    check('gc() -> boolean', getType(r, 'a'), 'boolean');
}
{
    const r = analyze(`let a = gc("count");`);
    check('gc("count") -> integer', getType(r, 'a'), 'integer');
}
{
    const r = analyze(`let a = gc("collect");`);
    check('gc("collect") -> boolean', getType(r, 'a'), 'boolean');
}
{
    const r = analyze(`let a = gc("stop");`);
    check('gc("stop") -> boolean', getType(r, 'a'), 'boolean');
}

console.log(`\n${passed}/${passed + failed} tests passed`);
if (failed > 0) process.exit(1);
