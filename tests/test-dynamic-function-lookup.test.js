/**
 * Test for CFG-based filtering of "Undefined function" errors
 * for dynamically looked-up functions
 */

import { test, expect } from 'bun:test';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { SemanticAnalyzer } from '../src/analysis/semanticAnalyzer';
import { UcodeLexer } from '../src/lexer/ucodeLexer';
import { UcodeParser } from '../src/parser/ucodeParser';

test('should not report "Undefined function" for dynamically looked-up function with unknown type', () => {
    const code = `
let codec = {
    decoder: {
        1: function(buf, end) { return "decoded"; },
        2: function(buf, end) { return "decoded2"; }
    }
};

let type = 1;
const decode = codec.decoder[type];

// This should NOT produce "Undefined function: decode" error
let result = decode("buffer", 100);
    `;

    const lexer = new UcodeLexer(code, { rawMode: true });
    const tokens = lexer.tokenize();
    const parser = new UcodeParser(tokens, code);
    const parseResult = parser.parse();

    expect(parseResult.errors.length).toBe(0);

    const textDocument = TextDocument.create('file:///test.uc', 'ucode', 1, code);
    const analyzer = new SemanticAnalyzer(textDocument, {
        enableControlFlowAnalysis: true,
    });

    const analysisResult = analyzer.analyze(parseResult.ast);

    // Filter for "Undefined function: decode" errors
    const undefinedDecodeErrors = analysisResult.diagnostics.filter(d =>
        d.message.includes('Undefined function: decode')
    );

    // Should have NO such errors because decode has unknown type from CFG
    expect(undefinedDecodeErrors.length).toBe(0);

    // Verify CFG was actually built
    expect(analysisResult.cfg).toBeDefined();
    expect(analysisResult.cfgQueryEngine).toBeDefined();
});

test('should still report "Undefined function" for truly undefined functions', () => {
    const code = `
// Call a function that definitely doesn't exist
let result = nonExistentFunction(123);
    `;

    const lexer = new UcodeLexer(code, { rawMode: true });
    const tokens = lexer.tokenize();
    const parser = new UcodeParser(tokens, code);
    const parseResult = parser.parse();

    const textDocument = TextDocument.create('file:///test.uc', 'ucode', 1, code);
    const analyzer = new SemanticAnalyzer(textDocument, {
        enableControlFlowAnalysis: true,
    });

    const analysisResult = analyzer.analyze(parseResult.ast);

    // Should have "Undefined function: nonExistentFunction" error
    const undefinedErrors = analysisResult.diagnostics.filter(d =>
        d.message.includes('Undefined function: nonExistentFunction')
    );

    expect(undefinedErrors.length).toBe(1);
});
