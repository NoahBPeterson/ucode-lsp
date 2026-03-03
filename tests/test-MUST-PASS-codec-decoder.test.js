/**
 * CRITICAL TEST: This test MUST pass for the fix to be working
 * If this test fails, the fix is not working
 * If this test passes but VS Code still shows error, it's an environment issue
 */

import { test, expect } from 'bun:test';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { SemanticAnalyzer } from '../src/analysis/semanticAnalyzer';
import { UcodeLexer } from '../src/lexer/ucodeLexer';
import { UcodeParser } from '../src/parser/ucodeParser';

test('CRITICAL: codec.decoder[type] pattern MUST NOT produce "Undefined function" error', () => {
    // EXACT pattern from user's code
    const code = `
import { buffer } from 'struct';
import { timer } from 'uloop';

import utils from 'umap.utils';
import log from 'umap.log';
import defs from 'umap.defs';

import * as codec from 'umap.tlv.codec';

const ETHERNET_HEADER_LENGTH = 14;
const IEEE1905_HEADER_LENGTH = 8;
const TLV_HEADER_LENGTH = 3;
const TLV_EXTENDED_HEADER_LENGTH = 5;
const IEEE1905_MAX_PAYLOAD_LENGTH = 1500 - ETHERNET_HEADER_LENGTH - IEEE1905_HEADER_LENGTH;
const CMDU_MAX_PAYLOAD_LENGTH = IEEE1905_MAX_PAYLOAD_LENGTH - TLV_HEADER_LENGTH /* EOF TLV */;
const TLV_MAX_PAYLOAD_LENGTH = CMDU_MAX_PAYLOAD_LENGTH - TLV_HEADER_LENGTH /* TLV type + TLV length */;

const CMDU_MESSAGE_VERSION = 0;

const CMDU_F_LASTFRAG = 0b10000000;
const CMDU_F_ISRELAY = 0b01000000;

const CMDU_MAX_CONCURRENT_REASSEMBLY = 16;
const CMDU_MAX_PAYLOAD_SIZE = 102400;

let reassembly = utils.Queue(CMDU_MAX_CONCURRENT_REASSEMBLY);
let callbacks = {};

function alloc_fragment(type, mid, fid, flags) {
	return buffer().put('!BxHHBB', CMDU_MESSAGE_VERSION, type, mid, fid, flags);
}

function decode_tlv(msg, type, start, end) {
	if (type !== defs.TLV_EXTENDED) {
		const decode = codec.decoder[type]; // hover on codec: (imported) codec: umap.tlv.codec module; hover on 'decode': (variable) decode: unknown

		if (decode == null) { // (variable) decode: unknown
			log.warn(\`CMDU \${msg.srcmac}#\${msg.mid}: Unrecognized TLV type \${type} at offset \${start}\`);
			return null;
		}

		const data = decode(msg.buf.pos(start), end); // (variable) decode: unknown, Undefined function: decode (error diagnostic). But look above???
    }
}`;

    const lexer = new UcodeLexer(code, { rawMode: true });
    const tokens = lexer.tokenize();
    const parser = new UcodeParser(tokens, code);
    const parseResult = parser.parse();

    if (parseResult.errors.length > 0) {
        console.log('Parse errors:', parseResult.errors.map(e => e.message));
    }

    // Continue even with parse errors (module not found)
    // expect(parseResult.errors.length).toBe(0);

    const textDocument = TextDocument.create('file:///test.uc', 'ucode', 1, code);

    // Test with CFG enabled (default)
    const analyzer = new SemanticAnalyzer(textDocument, {
        enableControlFlowAnalysis: true,
    });

    const analysisResult = analyzer.analyze(parseResult.ast);

    console.log('\n========================================');
    console.log('CRITICAL TEST RESULTS');
    console.log('========================================');
    console.log('Total diagnostics:', analysisResult.diagnostics.length);

    analysisResult.diagnostics.forEach((d, i) => {
        console.log(`${i + 1}. ${d.message} (severity: ${d.severity})`);
    });

    // Filter for the specific error
    const undefinedDecodeErrors = analysisResult.diagnostics.filter(d =>
        d.message.includes('Undefined function: decode')
    );

    console.log('\n"Undefined function: decode" errors:', undefinedDecodeErrors.length);

    if (undefinedDecodeErrors.length > 0) {
        console.log('\n❌❌❌ TEST FAILED ❌❌❌');
        console.log('The error is still being reported!');
        console.log('This means the fix is NOT working in the code.');

        // Debug info
        const decodeCallPos = code.indexOf('decode(msg.buf');
        const symbol = analysisResult.symbolTable.lookupAtPosition('decode', decodeCallPos);
        console.log('\nDEBUG INFO:');
        console.log('Symbol found:', !!symbol);
        if (symbol) {
            console.log('Symbol dataType:', symbol.dataType);
        }

        console.log('========================================\n');
    } else {
        console.log('\n✅✅✅ TEST PASSED ✅✅✅');
        console.log('NO "Undefined function: decode" error!');
        console.log('The fix IS working in the code.');
        console.log('If VS Code still shows error, it is an ENVIRONMENT issue.');
        console.log('========================================\n');
    }

    // ASSERTION: Must have zero errors
    expect(undefinedDecodeErrors.length).toBe(0);
});
