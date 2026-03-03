/**
 * Test for the exact issue reported: codec.decoder[type] pattern
 * This test MUST fail with current code and pass when fixed
 */

import { test, expect } from 'bun:test';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { SemanticAnalyzer } from '../src/analysis/semanticAnalyzer';
import { UcodeLexer } from '../src/lexer/ucodeLexer';
import { UcodeParser } from '../src/parser/ucodeParser';

test('FAILING TEST: should not report "Undefined function: decode" for codec.decoder[type] pattern', () => {
    // This is the EXACT pattern from the user's code, simplified without imports
    const code = `
let codec = {
    decoder: {
        1: function(buf, end) { return { decoded: true }; },
        2: function(buf, end) { return { decoded: true }; }
    }
};

function decode_tlv(msg, type, start, end) {
    const decode = codec.decoder[type];

    if (decode == null) {
        return null;
    }

    // THIS LINE SHOULD NOT PRODUCE ERROR
    const data = decode(msg.buf.pos(start), end);

    return { type, data };
}
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

    console.log('\n=== DIAGNOSTICS ===');
    analysisResult.diagnostics.forEach(d => {
        console.log(`- ${d.message} (${d.severity})`);
    });
    console.log('===================\n');

    // Filter for "Undefined function: decode" errors
    const undefinedDecodeErrors = analysisResult.diagnostics.filter(d =>
        d.message.includes('Undefined function: decode')
    );

    console.log(`Found ${undefinedDecodeErrors.length} "Undefined function: decode" error(s)`);

    if (undefinedDecodeErrors.length > 0) {
        console.log('\n❌ TEST FAILING: This error should NOT exist!');
        console.log('The variable "decode" has unknown type from CFG, so we cannot know if it is callable.');
        console.log('Therefore, we should NOT report "Undefined function: decode".\n');
    }

    // THIS SHOULD PASS (no errors) but currently FAILS (has error)
    expect(undefinedDecodeErrors.length).toBe(0);
});

test('should also work for extended_decoder pattern', () => {
    const code = `
let codec = {
    extended_decoder: {
        10: function(buf, end) { return { decoded: true }; },
        20: function(buf, end) { return { decoded: true }; }
    }
};

function decode_extended_tlv(msg, subtype, start, end) {
    const decode = codec.extended_decoder[subtype];

    if (decode == null) {
        return null;
    }

    // THIS LINE SHOULD NOT PRODUCE ERROR
    const data = decode(msg.buf, end);

    return data;
}
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

    const undefinedDecodeErrors = analysisResult.diagnostics.filter(d =>
        d.message.includes('Undefined function: decode')
    );

    expect(undefinedDecodeErrors.length).toBe(0);
});
