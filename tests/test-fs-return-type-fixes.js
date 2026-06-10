// Tests for fs module return type corrections based on C source audit.
// Verifies types visible via hover (typeToString on symbol dataType).

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

// A function parameter is the only genuinely type-unknown value in ucode (its type
// depends on the caller). For "unknown arg -> union" cases we check the inferred RETURN
// type of a one-line function whose body applies the builtin to its parameter.
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
// writefile: returns integer (byte count) | null, NOT boolean
// ============================================================================
{
    const r = analyze(`import { writefile } from 'fs';\nlet a = writefile("/tmp/test", "hello");`);
    check('writefile returns integer | null', getType(r, 'a'), 'integer | null');
}

// ============================================================================
// mkdir/rmdir/unlink: return true | null (never false), need null in type
// ============================================================================
{
    const r = analyze(`import { mkdir } from 'fs';\nlet a = mkdir("/tmp/testdir");`);
    check('mkdir returns boolean | null', getType(r, 'a'), 'boolean | null');
}
{
    const r = analyze(`import { rmdir } from 'fs';\nlet a = rmdir("/tmp/testdir");`);
    check('rmdir returns boolean | null', getType(r, 'a'), 'boolean | null');
}
{
    const r = analyze(`import { unlink } from 'fs';\nlet a = unlink("/tmp/test");`);
    check('unlink returns boolean | null', getType(r, 'a'), 'boolean | null');
}

// ============================================================================
// access: returns true | null (never false), mode param is string not number
// ============================================================================
{
    const r = analyze(`import { access } from 'fs';\nlet a = access("/tmp/test");`);
    check('access returns boolean | null', getType(r, 'a'), 'boolean | null');
}

// ============================================================================
// dirname/basename: return string | null, narrowable when arg is string
// ============================================================================
{
    const r = analyze(`import { dirname } from 'fs';\nlet a = dirname("/tmp/test.txt");`);
    check('dirname(string) -> string (narrowed)', getType(r, 'a'), 'string');
}
{
    const r = analyze(`import { dirname } from 'fs';\nfunction _u(x) { return dirname(x); }`);
    check('dirname(unknown) -> string | null', getRet(r, '_u'), 'string | null');
}
{
    const r = analyze(`import { basename } from 'fs';\nlet a = basename("/tmp/test.txt");`);
    check('basename(string) -> string (narrowed)', getType(r, 'a'), 'string');
}
{
    const r = analyze(`import { basename } from 'fs';\nfunction _u(x) { return basename(x); }`);
    check('basename(unknown) -> string | null', getRet(r, '_u'), 'string | null');
}

// ============================================================================
// symlink/rename: return boolean | null (duplicates removed)
// ============================================================================
{
    const r = analyze(`import { symlink } from 'fs';\nlet a = symlink("/tmp/a", "/tmp/b");`);
    check('symlink returns boolean | null', getType(r, 'a'), 'boolean | null');
}
{
    const r = analyze(`import { rename } from 'fs';\nlet a = rename("/tmp/a", "/tmp/b");`);
    check('rename returns boolean | null', getType(r, 'a'), 'boolean | null');
}

// ============================================================================
// chdir: return boolean | null (duplicate removed)
// ============================================================================
{
    const r = analyze(`import { chdir } from 'fs';\nlet a = chdir("/tmp");`);
    check('chdir returns boolean | null', getType(r, 'a'), 'boolean | null');
}

console.log(`\n${passed}/${passed + failed} tests passed`);
if (failed > 0) process.exit(1);
