// Tests for fs.glob() return type narrowing based on argument types.
// Per C source: returns null if any argument is not a string, array<string> otherwise.

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

// 1. glob() with string literal → array (never null — arg is definitely string)
{
    const code = `import { glob } from "fs";\nlet a = glob("/tmp/*");`;
    const result = analyze(code);
    check('glob(string_literal) returns array<string>', getType(result, 'a'), 'array<string>');
}

// 2. glob() with unknown arg → array | null (might not be string)
{
    const code = `import { glob } from "fs";\nfunction _u(x) { return glob(x); }`;
    const result = analyze(code);
    check('glob(unknown) returns array<string> | null', getRet(result, '_u'), 'array<string> | null');
}

// 3. glob() with null arg → null (definitely not string)
{
    const code = `import { glob } from "fs";\nlet a = glob(null);`;
    const result = analyze(code);
    check('glob(null) returns null', getType(result, 'a'), 'null');
}

// 4. glob() with integer arg → null (definitely not string)
{
    const code = `import { glob } from "fs";\nlet a = glob(123);`;
    const result = analyze(code);
    check('glob(integer) returns null', getType(result, 'a'), 'null');
}

// 5. glob() with confirmed string variable → array
{
    const code = `import { glob } from "fs";\nlet x = "pattern";\nlet a = glob(x);`;
    const result = analyze(code);
    check('glob(string_var) returns array<string>', getType(result, 'a'), 'array<string>');
}

// 6. glob() with array arg → null (definitely not string)
{
    const code = `import { glob } from "fs";\nlet a = glob([1, 2]);`;
    const result = analyze(code);
    check('glob(array) returns null', getType(result, 'a'), 'null');
}

console.log(`\n${passed}/${passed + failed} tests passed`);
if (failed > 0) process.exit(1);
