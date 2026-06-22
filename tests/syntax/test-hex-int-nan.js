// Tests for hex() and int() NaN handling.
// Both functions return integer on success, double (NaN) on bad input.
// Exhaustive testing of all UcodeType values using Effect Match.

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

function getType(result, varName) {
    const sym = result.symbolTable.lookup(varName);
    return sym ? typeToString(sym.dataType) : 'NOT FOUND';
}

// A function parameter is the only genuinely type-unknown value in ucode (its type depends
// on the caller). For the UNKNOWN arg case we check the inferred RETURN type of a one-line
// function applying the builtin to its parameter, rather than a top-level binding (a bare
// `let v;` is now typed null, not unknown).
function getRet(result, fnName) {
    const sym = result.symbolTable.lookup(fnName);
    return sym && sym.returnType ? typeToString(sym.returnType) : 'NO RETURN TYPE';
}
function applied(builtinCall) {
    // builtinCall is e.g. 'hex(v)' / 'int(v)' — wrap so `v` is a genuine unknown param.
    return analyze(`function _u(v) { return ${builtinCall}; }`);
}

let passed = 0, failed = 0;
function check(label, actual, expected) {
    if (actual === expected) { passed++; }
    else { failed++; console.log(`FAIL: ${label}: expected "${expected}", got "${actual}"`); }
}

// Exhaustive snippet generator — Match.exhaustive guarantees coverage of all UcodeType values
const snippetForType = (t) => Match.value(t).pipe(
    Match.when(UcodeType.INTEGER,  () => 'let v = 42;'),
    Match.when(UcodeType.DOUBLE,   () => 'let v = 3.14;'),
    Match.when(UcodeType.STRING,   () => 'let v = "hello";'),
    Match.when(UcodeType.BOOLEAN,  () => 'let v = true;'),
    Match.when(UcodeType.ARRAY,    () => 'let v = [1, 2];'),
    Match.when(UcodeType.OBJECT,   () => 'let v = { x: 1 };'),
    Match.when(UcodeType.FUNCTION, () => 'let v = () => 1;'),
    Match.when(UcodeType.REGEX,    () => 'let v = /test/;'),
    Match.when(UcodeType.NULL,     () => 'let v = null;'),
    Match.when(UcodeType.UNKNOWN,  () => null), // UNKNOWN is special-cased via a fn-param (a top-level binding can't be genuinely unknown)
    Match.when(UcodeType.UNION,    () => null),
    Match.exhaustive
);

const CONCRETE_TYPES = Object.values(UcodeType).filter(t => t !== UcodeType.UNION);

// ============================================================================
// hex(val): string → integer, everything else → NaN (double)
//
// C source (lib.c uc_hex):
//   v = ucv_string_get(val) — returns NULL for non-strings
//   if (!v || !isxdigit(*v)) return NAN
//   n = strtoll(v, &e, 16)
//   if (e == v || *e) return NAN — trailing non-hex chars
//   return int64(n)
//
// So: hex(string) → integer | double (could be NaN for bad hex)
//     hex(non-string) → double (always NaN)
// ============================================================================

// hex() with every UcodeType — exhaustive narrowing
const hexExpected = (t) => Match.value(t).pipe(
    // String: could be valid hex (integer) or invalid (NaN/double) — can't narrow further
    Match.when(UcodeType.STRING,   () => 'integer | double'),
    // All non-string types: ucv_string_get returns NULL → always NaN (double)
    Match.when(UcodeType.INTEGER,  () => 'double'),
    Match.when(UcodeType.DOUBLE,   () => 'double'),
    Match.when(UcodeType.BOOLEAN,  () => 'double'),
    Match.when(UcodeType.ARRAY,    () => 'double'),
    Match.when(UcodeType.OBJECT,   () => 'double'),
    Match.when(UcodeType.FUNCTION, () => 'double'),
    Match.when(UcodeType.REGEX,    () => 'double'),
    Match.when(UcodeType.NULL,     () => 'double'),
    // Unknown: could be string or not — full union
    Match.when(UcodeType.UNKNOWN,  () => 'integer | double'),
    Match.when(UcodeType.UNION,    () => null),
    Match.exhaustive
);

for (const ucType of CONCRETE_TYPES) {
    const expected = hexExpected(ucType);
    if (expected === null) continue;
    if (ucType === UcodeType.UNKNOWN) {
        check(`hex(${ucType}) -> ${expected}`, getRet(applied('hex(v)'), '_u'), expected);
        continue;
    }
    const snippet = snippetForType(ucType);
    if (snippet === null) continue;
    const r = analyze(`${snippet}\nlet a = hex(v);`);
    check(`hex(${ucType}) -> ${expected}`, getType(r, 'a'), expected);
}

// ============================================================================
// int(val, base?): return type depends on input type
//
// C source (lib.c uc_int):
//   if (ucv_type(val) == UC_STRING):
//     n = strtoll(v, &e, base)
//     if (e == v) return NAN — no valid prefix at all
//   else:
//     n = ucv_to_integer(val) — calls ucv_to_number internally
//     (for array/object/function/regex, ucv_to_number returns NaN)
//   if (errno == EINVAL || ERANGE) return NAN
//   return int64(n)
//
// Verified via ucode -e:
//   int(integer) → integer    int(double) → integer (truncated)
//   int(boolean) → integer    int(null) → integer (0)
//   int(string) → integer | double (depends on content)
//   int(array) → NaN/double   int(object) → NaN/double
//   int(function) → NaN/double   int(regex) → NaN/double
// ============================================================================

const intExpected = (t) => Match.value(t).pipe(
    // These always succeed via ucv_to_integer:
    Match.when(UcodeType.INTEGER,  () => 'integer'),
    Match.when(UcodeType.DOUBLE,   () => 'integer'),
    Match.when(UcodeType.BOOLEAN,  () => 'integer'),
    Match.when(UcodeType.NULL,     () => 'integer'),
    // String: depends on content — valid prefix → integer, no valid prefix → NaN
    Match.when(UcodeType.STRING,   () => 'integer | double'),
    // These always fail via ucv_to_number → NaN:
    Match.when(UcodeType.ARRAY,    () => 'double'),
    Match.when(UcodeType.OBJECT,   () => 'double'),
    Match.when(UcodeType.FUNCTION, () => 'double'),
    Match.when(UcodeType.REGEX,    () => 'double'),
    // Unknown: could be anything — full union
    Match.when(UcodeType.UNKNOWN,  () => 'integer | double'),
    Match.when(UcodeType.UNION,    () => null),
    Match.exhaustive
);

for (const ucType of CONCRETE_TYPES) {
    const expected = intExpected(ucType);
    if (expected === null) continue;
    if (ucType === UcodeType.UNKNOWN) {
        check(`int(${ucType}) -> ${expected}`, getRet(applied('int(v)'), '_u'), expected);
        continue;
    }
    const snippet = snippetForType(ucType);
    if (snippet === null) continue;
    const r = analyze(`${snippet}\nlet a = int(v);`);
    check(`int(${ucType}) -> ${expected}`, getType(r, 'a'), expected);
}

// int() with optional base parameter
{
    // A string literal with a literal base is decidable: "ff" is valid in base 16 → integer.
    const r = analyze(`let a = int("ff", 16);`);
    check('int("ff", 16) literal -> integer', getType(r, 'a'), 'integer');
}
{
    // A base-10 string LITERAL is decidable: "123" parses to an integer (verified vs the
    // interpreter), so int() narrows to `integer` rather than the general `integer | double`.
    const r = analyze(`let a = int("123");`);
    check('int("123") literal -> integer', getType(r, 'a'), 'integer');
}
{
    // A non-numeric string literal yields NaN (a double).
    const r = analyze(`let a = int("abc");`);
    check('int("abc") literal -> double', getType(r, 'a'), 'double');
}
{
    const r = analyze(`let a = int(42);`);
    check('int(integer) -> integer', getType(r, 'a'), 'integer');
}

console.log(`\n${passed}/${passed + failed} tests passed`);
if (failed > 0) process.exit(1);
