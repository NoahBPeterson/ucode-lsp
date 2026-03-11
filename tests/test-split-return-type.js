// Test that split() return type depends on argument types.
// Per the C source (uc_split), split() returns NULL when:
//   - first arg is not a string
//   - separator is not string or regex
// So: confirmed string + confirmed sep → array<string>
//     unknown/wrong args → array | null

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
        positionAt: (o) => {
            let l = 0, c = 0;
            for (let i = 0; i < o && i < code.length; i++) {
                if (code[i] === '\n') { l++; c = 0; } else { c++; }
            }
            return { line: l, character: c };
        },
        offsetAt: (p) => {
            const lines = code.split('\n');
            let o = 0;
            for (let i = 0; i < p.line && i < lines.length; i++) { o += lines[i].length + 1; }
            return o + p.character;
        },
        uri: 'file:///test-split.uc', languageId: 'ucode', version: 1
    };
    const analyzer = new SemanticAnalyzer(doc, {
        enableScopeAnalysis: true,
        enableTypeChecking: true,
    });
    return analyzer.analyze(parseResult.ast);
}

function getType(result, code, varName) {
    let sym = result.symbolTable.lookup(varName);
    if (!sym) {
        const offset = code.indexOf(`let ${varName}`) + 4;
        sym = result.symbolTable.lookupAtPosition(varName, offset);
    }
    return sym ? typeToString(sym.dataType) : null;
}

let passed = 0;
let failed = 0;

function check(label, actual, expected) {
    if (actual === expected) {
        passed++;
    } else {
        failed++;
        console.log(`FAIL: ${label}: expected "${expected}", got "${actual}"`);
    }
}

// 1. split() with string literal + string separator → array<string>
{
    const code = `let parts = split("hello,world", ",");\nprint(parts);\n`;
    const result = analyze(code);
    check('split(string_literal, string)', getType(result, code, 'parts'), 'array<string>');
}

// 2. split() with string variable + string separator → array<string>
{
    const code = `let s = "hello,world";\nlet parts = split(s, ",");\nprint(parts);\n`;
    const result = analyze(code);
    check('split(string_var, string)', getType(result, code, 'parts'), 'array<string>');
}

// 3. split() with unknown parameter → array | null (could return null if not string)
{
    const code = `function foo(x) {\n  let parts = split(x, ",");\n  print(parts);\n  return parts;\n}\nprint(foo("test"));\n`;
    const result = analyze(code);
    const sym = result.symbolTable.lookupAtPosition('parts', code.indexOf('let parts') + 4);
    const type = sym ? typeToString(sym.dataType) : null;
    check('split(unknown_param) return type', type, 'array | null');
    // Should warn that argument 1 is unknown
    const unknownArgWarnings = result.diagnostics.filter(d =>
        (d.code === 'incompatible-function-argument' || d.code === 'nullable-argument') && d.message.includes('split')
    );
    check('split(unknown_param) warns about unknown arg', unknownArgWarnings.length > 0, true);
}

// 4. split() with confirmed string → no nullable-argument warning when passed to length()
{
    const code = `let parts = split("a,b,c", ",");\nlet n = length(parts);\nprint(n);\n`;
    const result = analyze(code);
    const nullableArgs = result.diagnostics.filter(d => d.code === 'nullable-argument');
    check('split(string)+length no nullable warning', nullableArgs.length, 0);
}

// 5. split() with regex separator + string input → array<string>
{
    const code = `let parts = split("hello world", /\\s+/);\nprint(parts);\n`;
    const result = analyze(code);
    check('split(string, regex)', getType(result, code, 'parts'), 'array<string>');
}

// 6. Chained: split(string, string) result passed to join → no diagnostic
{
    const code = `let parts = split("a,b,c", ",");\nlet joined = join("-", parts);\nprint(joined);\n`;
    const result = analyze(code);
    const diags = result.diagnostics.filter(d =>
        d.message.includes('split') || d.message.includes('join') || d.code === 'nullable-argument'
    );
    check('split+join no diagnostics', diags.length, 0);
}

// 7. split() with type-guarded parameter → array<string>
{
    const code = `function foo(x) {\n  if (type(x) != 'string') return;\n  let parts = split(x, ",");\n  print(parts);\n}\nfoo("test");\n`;
    const result = analyze(code);
    const sym = result.symbolTable.lookupAtPosition('parts', code.indexOf('let parts') + 4);
    const type = sym ? typeToString(sym.dataType) : null;
    check('split(type_guarded_string)', type, 'array<string>');
}

console.log(`\n${passed}/${passed + failed} tests passed`);
if (failed > 0) process.exit(1);
