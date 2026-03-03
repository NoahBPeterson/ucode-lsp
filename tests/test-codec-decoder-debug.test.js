/**
 * Debug test to see exactly what's happening with the codec.decoder pattern
 */

import { test, expect } from 'bun:test';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { SemanticAnalyzer } from '../src/analysis/semanticAnalyzer';
import { UcodeLexer } from '../src/lexer/ucodeLexer';
import { UcodeParser } from '../src/parser/ucodeParser';

test('DEBUG: What does CFG see for codec.decoder[type]? WITH IMPORT', () => {
    const code = `
import * as codec from 'umap.tlv.codec';

function decode_tlv(msg, type, start, end) {
    const decode = codec.decoder[type];

    if (decode == null) {
        return null;
    }

    const data = decode(msg.buf.pos(start), end);
    return data;
}

// CALL THE FUNCTION so TypeChecker analyzes it
decode_tlv({buf: {pos: () => ({})}}, 1, 0, 100);
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

    console.log('\n=== CFG INFO ===');
    console.log('CFG built:', !!analysisResult.cfg);
    console.log('CFG query engine:', !!analysisResult.cfgQueryEngine);

    if (analysisResult.cfgQueryEngine) {
        // Find the position of "decode" in the function call
        const decodeCallPos = code.indexOf('decode(msg.buf');
        console.log('Position of decode call:', decodeCallPos);

        // Query CFG for type at that position
        const typeAtCall = analysisResult.cfgQueryEngine.getTypeAtPosition('decode', decodeCallPos);
        console.log('Type of "decode" at call site from CFG:', typeAtCall);

        // Also check at declaration
        const decodeDeclPos = code.indexOf('const decode =');
        const typeAtDecl = analysisResult.cfgQueryEngine.getTypeAtPosition('decode', decodeDeclPos);
        console.log('Type of "decode" at declaration from CFG:', typeAtDecl);
    }

    console.log('\n=== SYMBOL TABLE ===');
    const decodeSymbol = analysisResult.symbolTable.lookup('decode');
    console.log('Symbol table has "decode" (global lookup):', !!decodeSymbol);

    const decodeCallPos = code.indexOf('decode(msg.buf');
    const decodeSymbolAtPos = analysisResult.symbolTable.lookupAtPosition('decode', decodeCallPos);
    console.log('Symbol table has "decode" (at call position):', !!decodeSymbolAtPos);

    if (decodeSymbolAtPos) {
        console.log('Symbol type:', decodeSymbolAtPos.type);
        console.log('Symbol dataType:', decodeSymbolAtPos.dataType);
    }

    console.log('\n=== TYPE CHECKER ERRORS ===');
    if (analysisResult.typeChecker) {
        const errors = analysisResult.typeChecker.getErrors();
        console.log('Total TypeChecker errors:', errors.length);
        errors.forEach(err => {
            console.log(`  - ${err.message} at ${err.start}-${err.end}`);
        });
    }

    console.log('\n=== DIAGNOSTICS ===');
    console.log('Total diagnostics:', analysisResult.diagnostics.length);
    analysisResult.diagnostics.forEach(d => {
        console.log(`  - ${d.message} (severity: ${d.severity})`);
    });

    const undefinedDecodeErrors = analysisResult.diagnostics.filter(d =>
        d.message.includes('Undefined function: decode')
    );

    console.log('\nUndefined function errors for "decode":', undefinedDecodeErrors.length);
    console.log('===================\n');

    // Don't assert yet, just observe
});
