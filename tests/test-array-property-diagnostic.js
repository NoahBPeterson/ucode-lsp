// Tests for array property access diagnostics.
// Arrays in ucode have NO properties or methods — use builtin functions.
// This includes nullable arrays (array | null from sort/filter/keys).

import { UcodeLexer } from '../src/lexer/ucodeLexer.ts';
import { UcodeParser } from '../src/parser/ucodeParser.ts';
import { SemanticAnalyzer } from '../src/analysis/semanticAnalyzer.ts';
import { UcodeType } from '../src/analysis/symbolTable.ts';
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

function getErrors(code) {
    const result = analyze(code);
    return result.diagnostics.filter(d => d.severity === 1).map(d => d.message);
}

let passed = 0, failed = 0;
function check(label, actual, expected) {
    if (actual === expected) { passed++; }
    else { failed++; console.log(`FAIL: ${label}: expected "${expected}", got "${actual}"`); }
}

// ============================================================================
// Pure array — .length, .foo, etc. should all error
// ============================================================================
{
    const errs = getErrors('let arr = [1, 2, 3];\nlet x = arr.length;');
    check('arr.length errors', errs.length > 0, true);
    check('arr.length mentions array', errs[0]?.includes('array'), true);
}
{
    const errs = getErrors('let arr = [1, 2, 3];\nlet x = arr.foo;');
    check('arr.foo errors', errs.length > 0, true);
}
{
    const errs = getErrors('let arr = [1, 2, 3];\nlet x = arr.push;');
    check('arr.push errors (no methods on arrays)', errs.length > 0, true);
}

// ============================================================================
// Nullable array (array | null from sort/filter/keys) — should ALSO error
// This was previously silent — the fix detects array in union types.
// ============================================================================
{
    // `x` is a function parameter so its type is genuinely unknown (a bare `let x;` is now
    // typed null, which would collapse keys(x)/sort(...) to null instead of array | null).
    const errs = getErrors('function _u(x) {\nlet sids = sort(keys(x));\nlet n = sids.length;\n}');
    check('nullable arr.length errors', errs.length > 0, true);
    check('nullable arr.length mentions array', errs[0]?.includes('array'), true);
}
{
    const errs = getErrors('function _u(x) {\nlet sids = filter(keys(x), k => true);\nlet n = sids.length;\n}');
    check('filter result .length errors', errs.length > 0, true);
}

// ============================================================================
// Computed access on arrays is FINE (arr[0] is valid)
// ============================================================================
{
    const errs = getErrors('let arr = [1, 2, 3];\nlet x = arr[0];');
    check('arr[0] no error', errs.length, 0);
}
{
    const errs = getErrors('let arr = [1, 2, 3];\nlet i = 1;\nlet x = arr[i];');
    check('arr[i] no error', errs.length, 0);
}

// ============================================================================
// Object property access is FINE (obj.prop is valid)
// ============================================================================
{
    const errs = getErrors('let obj = { a: 1 };\nlet x = obj.a;');
    check('obj.a no error', errs.length, 0);
}
{
    const errs = getErrors('let obj = { length: 5 };\nlet x = obj.length;');
    check('obj.length no error (objects can have .length)', errs.length, 0);
}

// ============================================================================
// String property access should error (strings have no properties in ucode)
// ============================================================================
{
    const errs = getErrors('let s = "hello";\nlet x = s.length;');
    check('str.length errors', errs.length > 0, true);
    check('str.length mentions string', errs[0]?.includes('string'), true);
}

// ============================================================================
// Exhaustive: property access on every UcodeType
// Only object should be silent. Array, string, regex should error.
// Dot member access on a non-object value (int/double/string/bool/array/regex/
// function) is a hard runtime reference error in ucode ("left-hand side is not an
// array or object"), so it IS flagged (verified against /usr/local/bin/ucode).
// OBJECT is the exception: objects allow access to MISSING properties (returns
// null, no error), so it is NOT flagged here. null member access also errors at
// runtime but is left to the null-safety diagnostics.
// ============================================================================
const snippetForType = (t) => Match.value(t).pipe(
    Match.when(UcodeType.INTEGER,  () => ({ code: 'let v = 42;\nlet x = v.prop;', shouldError: true })),
    Match.when(UcodeType.DOUBLE,   () => ({ code: 'let v = 3.14;\nlet x = v.prop;', shouldError: true })),
    Match.when(UcodeType.STRING,   () => ({ code: 'let v = "hello";\nlet x = v.prop;', shouldError: true })),
    Match.when(UcodeType.BOOLEAN,  () => ({ code: 'let v = true;\nlet x = v.prop;', shouldError: true })),
    Match.when(UcodeType.ARRAY,    () => ({ code: 'let v = [1];\nlet x = v.prop;', shouldError: true })),
    Match.when(UcodeType.OBJECT,   () => ({ code: 'let v = {a:1};\nlet x = v.prop;', shouldError: false })),
    Match.when(UcodeType.FUNCTION, () => ({ code: 'let v = () => 1;\nlet x = v.prop;', shouldError: true })),
    Match.when(UcodeType.REGEX,    () => ({ code: 'let v = /test/;\nlet x = v.prop;', shouldError: true })),
    Match.when(UcodeType.NULL,     () => null),
    Match.when(UcodeType.UNKNOWN,  () => null),
    Match.when(UcodeType.UNION,    () => null),
    Match.exhaustive
);

for (const ucType of Object.values(UcodeType).filter(t => t !== UcodeType.UNION)) {
    const info = snippetForType(ucType);
    if (!info) continue;
    const errs = getErrors(info.code);
    const hasError = errs.length > 0;
    check(`${ucType}.prop ${info.shouldError ? 'errors' : 'no error'}`, hasError, info.shouldError);
}

console.log(`\n${passed}/${passed + failed} tests passed`);
if (failed > 0) process.exit(1);
