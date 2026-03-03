import { test, expect } from 'bun:test';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { SemanticAnalyzer } from '../src/analysis/semanticAnalyzer';
import { UcodeLexer } from '../src/lexer/ucodeLexer';
import { UcodeParser } from '../src/parser/ucodeParser';

test('Baseline: truly undefined function SHOULD report error', () => {
    const code = `
function test() {
    thisReallyDoesNotExist();
}
test();
    `;

    const lexer = new UcodeLexer(code, { rawMode: true });
    const tokens = lexer.tokenize();
    const parser = new UcodeParser(tokens, code);
    const parseResult = parser.parse();

    const textDocument = TextDocument.create('file:///test.uc', 'ucode', 1, code);
    const analyzer = new SemanticAnalyzer(textDocument, {
        enableControlFlowAnalysis: false, // Disable CFG
    });

    const analysisResult = analyzer.analyze(parseResult.ast);

    console.log('\nDiagnostics:', analysisResult.diagnostics.map(d => d.message));

    const undefinedErrors = analysisResult.diagnostics.filter(d =>
        d.message.includes('Undefined function')
    );

    expect(undefinedErrors.length).toBeGreaterThan(0);
});

test('Baseline: variable with unknown type from member access', () => {
    const code = `
let obj = { fn: function() { return 42; } };
function test(key) {
    const myFunc = obj[key];
    myFunc();
}
test('fn');
    `;

    const lexer = new UcodeLexer(code, { rawMode: true });
    const tokens = lexer.tokenize();
    const parser = new UcodeParser(tokens, code);
    const parseResult = parser.parse();

    const textDocument = TextDocument.create('file:///test.uc', 'ucode', 1, code);
    const analyzer = new SemanticAnalyzer(textDocument, {
        enableControlFlowAnalysis: false,
    });

    const analysisResult = analyzer.analyze(parseResult.ast);

    console.log('\nDiagnostics:', analysisResult.diagnostics.map(d => d.message));

    const undefinedErrors = analysisResult.diagnostics.filter(d =>
        d.message.includes('Undefined function: myFunc')
    );

    console.log('Found', undefinedErrors.length, '"Undefined function: myFunc" errors');

    // After the fix for codec.decoder[type] pattern, variables with unknown type
    // no longer report "Undefined function" errors (which is correct - we can't
    // know if they're callable or not)
    expect(undefinedErrors.length).toBe(0);
});
