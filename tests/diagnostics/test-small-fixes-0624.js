// Tests for small fixes: chown params, readfile size param, pipe element type, socket.pair/open
// Exhaustive type testing using Effect Match to cover every UcodeType.

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

let passed = 0, failed = 0;
function check(label, actual, expected) {
    if (actual === expected) { passed++; }
    else { failed++; console.log(`FAIL: ${label}: expected "${expected}", got "${actual}"`); }
}

// ============================================================================
// Exhaustive code snippet generator for every UcodeType
// Uses Effect Match to guarantee every type is covered at compile time.
// ============================================================================

// Returns a code snippet that creates a variable of the given UcodeType
// Exhaustive match: if a new UcodeType is added and not handled here,
// Match.exhaustive will cause a runtime error — guaranteeing coverage.
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
    Match.when(UcodeType.UNKNOWN,  () => 'let v;'),
    // UNION is not a concrete value type — skip
    Match.when(UcodeType.UNION,    () => null),
    Match.exhaustive
);

// Concrete types that can appear as function arguments
const CONCRETE_TYPES = Object.values(UcodeType).filter(t => t !== UcodeType.UNION);

// ============================================================================
// 1. chown: uid/gid accept number | string | null
//    C: ucv_to_integer for numbers, getpwnam/getgrnam for strings, -1 for null
//    Valid uid/gid types: integer, double (coerced to int), string, null
//    Invalid uid/gid types: boolean, array, object, function, regex, unknown
// ============================================================================

// Registry checks
{
    const { fsModuleTypeRegistry } = require('../../src/analysis/fsModuleTypes');
    const chown = fsModuleTypeRegistry.getFunction('chown');
    check('chown exists', !!chown, true);
    check('chown uid type', chown.parameters[1].type, 'number | string | null');
    check('chown gid type', chown.parameters[2].type, 'number | string | null');
}

// Exhaustive: test chown return type with every UcodeType as uid argument
// chown always returns boolean | null (no nullMeansWrongType — runtime failure possible)
for (const ucType of CONCRETE_TYPES) {
    const snippet = snippetForType(ucType);
    if (snippet === null) continue;
    const code = `import { chown } from 'fs';\n${snippet}\nlet a = chown("/tmp/x", v, 0);`;
    const r = analyze(code);
    check(`chown(str, ${ucType}, int) -> boolean | null`, getType(r, 'a'), 'boolean | null');
}

// Exhaustive: test chown return type with every UcodeType as gid argument
for (const ucType of CONCRETE_TYPES) {
    const snippet = snippetForType(ucType);
    if (snippet === null) continue;
    const code = `import { chown } from 'fs';\n${snippet}\nlet a = chown("/tmp/x", 0, v);`;
    const r = analyze(code);
    check(`chown(str, int, ${ucType}) -> boolean | null`, getType(r, 'a'), 'boolean | null');
}

// Mixed valid combinations
{
    const r = analyze(`import { chown } from 'fs';\nlet a = chown("/tmp/x", "root", "wheel");`);
    check('chown(str, str, str) -> boolean | null', getType(r, 'a'), 'boolean | null');
}
{
    const r = analyze(`import { chown } from 'fs';\nlet a = chown("/tmp/x", null, null);`);
    check('chown(str, null, null) -> boolean | null', getType(r, 'a'), 'boolean | null');
}
{
    const r = analyze(`import { chown } from 'fs';\nlet a = chown("/tmp/x", "root", null);`);
    check('chown(str, str, null) -> boolean | null', getType(r, 'a'), 'boolean | null');
}

// ============================================================================
// 2. readfile: optional second size parameter (integer)
//    C: uc_fs_readfile checks nargs > 1 for optional size limit
// ============================================================================

// Registry checks
{
    const { fsModuleTypeRegistry } = require('../../src/analysis/fsModuleTypes');
    const readfile = fsModuleTypeRegistry.getFunction('readfile');
    check('readfile exists', !!readfile, true);
    check('readfile has 2 params', readfile.parameters.length, 2);
    check('readfile size param name', readfile.parameters[1]?.name, 'size');
    check('readfile size param type', readfile.parameters[1]?.type, 'integer');
    check('readfile size param optional', readfile.parameters[1]?.optional, true);
}

// Exhaustive: readfile return type with every UcodeType as size argument
// readfile always returns string | null regardless of size arg type
for (const ucType of CONCRETE_TYPES) {
    const snippet = snippetForType(ucType);
    if (snippet === null) continue;
    const code = `import { readfile } from 'fs';\n${snippet}\nlet a = readfile("/tmp/x", v);`;
    const r = analyze(code);
    check(`readfile(str, ${ucType}) -> string | null`, getType(r, 'a'), 'string | null');
}

// Without size param
{
    const r = analyze(`import { readfile } from 'fs';\nlet a = readfile("/tmp/test");`);
    check('readfile(path) -> string | null', getType(r, 'a'), 'string | null');
}

// ============================================================================
// 3. pipe: returns array<fs.file> | null
//    C: creates two FILE resources (read end, write end)
// ============================================================================

// Registry check
{
    const { fsModuleTypeRegistry } = require('../../src/analysis/fsModuleTypes');
    const pipe = fsModuleTypeRegistry.getFunction('pipe');
    check('pipe exists', !!pipe, true);
    check('pipe returnType', pipe.returnType, 'array<fs.file> | null');
}

// Semantic analysis: pipe() return type — no inferFsType cascade match
{
    const r = analyze(`import { pipe } from 'fs';\nlet a = pipe();`);
    const t = getType(r, 'a');
    const ok = t.includes('array') && t.includes('null');
    if (ok) { passed++; } else { failed++; console.log(`FAIL: pipe() should be array... | null: got "${t}"`); }
}

// Verify pipe is NOT matched by inferFsType as a bare fs.file
{
    const r = analyze(`import { pipe } from 'fs';\nlet a = pipe();`);
    const t = getType(r, 'a');
    check('pipe() is not bare fs.file', t !== 'fs.file', true);
}

// ============================================================================
// 4. socket.pair() — new function definition
//    C: socketpair() syscall, returns array of two socket resources or null
// ============================================================================
{
    const { socketTypeRegistry } = require('../../src/analysis/socketTypes');
    const pair = socketTypeRegistry.getFunction('pair');
    check('socket.pair exists', !!pair, true);
    check('socket.pair returnType', pair?.returnType, 'array<socket> | null');
    // ucode's uc_socket_pair takes a SINGLE `type` argument (domain is hardcoded AF_UNIX;
    // no protocol arg) — see socket.c. Corrected from the old 3-param (domain/type/protocol).
    check('socket.pair single param', pair?.parameters.length, 1);
    check('socket.pair type param', pair?.parameters[0]?.name, 'type');
    check('socket.pair type optional', pair?.parameters[0]?.optional, true);
    check('socket.pair type constantPrefixes', JSON.stringify(pair?.parameters[0]?.constantPrefixes), '["SOCK_"]');
}

// Semantic analysis
{
    const r = analyze(`import { pair } from 'socket';\nlet a = pair();`);
    const t = getType(r, 'a');
    check('socket.pair() -> array<socket> | null', t.includes('array') && t.includes('null'), true);
}

// ============================================================================
// 5. socket.open() — new function definition
//    C: wraps existing file descriptor into socket resource
// ============================================================================
{
    const { socketTypeRegistry } = require('../../src/analysis/socketTypes');
    const open = socketTypeRegistry.getFunction('open');
    check('socket.open exists', !!open, true);
    check('socket.open returnType', open?.returnType, 'socket | null');
    check('socket.open fd param', open?.parameters[0]?.name, 'fd');
    check('socket.open fd param type', open?.parameters[0]?.type, 'integer');
    check('socket.open fd required', open?.parameters[0]?.optional, false);
}

// Exhaustive: socket.open() with every UcodeType as fd argument
for (const ucType of CONCRETE_TYPES) {
    const snippet = snippetForType(ucType);
    if (snippet === null) continue;
    // socket.open is imported from 'socket', not 'fs' — verify it doesn't
    // get intercepted by inferFsType and turned into fs.file
    const code = `import { open } from 'socket';\n${snippet}\nlet a = open(v);`;
    const r = analyze(code);
    const t = getType(r, 'a');
    check(`socket.open(${ucType}) not fs.file`, t !== 'fs.file', true);
}

console.log(`\n${passed}/${passed + failed} tests passed`);
if (failed > 0) process.exit(1);
