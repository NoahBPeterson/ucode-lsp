import { test, expect } from 'bun:test';
import { SemanticAnalyzer } from '../src/analysis/semanticAnalyzer.ts';
import { UcodeParser } from '../src/parser/ucodeParser.ts';
import { UcodeLexer } from '../src/lexer/ucodeLexer.ts';
import { DiagnosticSeverity } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

function parseAndAnalyze(code, options = {}) {
    const lexer = new UcodeLexer(code, { rawMode: true });
    const tokens = lexer.tokenize();
    const parser = new UcodeParser(tokens);
    const parseResult = parser.parse();

    const document = TextDocument.create('test://rtnl-test.uc', 'ucode', 1, code);
    const analyzer = new SemanticAnalyzer(document, {
        enableScopeAnalysis: true,
        enableTypeChecking: true,
        enableUnusedVariableDetection: false,
        enableShadowingWarnings: false,
        ...options,
    });

    const result = analyzer.analyze(parseResult.ast);
    return {
        diagnostics: result.diagnostics,
        symbolTable: result.symbolTable,
    };
}

test('rtnl module validation - invalid namespace methods are rejected', () => {
    const code = `
'use strict';

import * as rtnl from 'rtnl';

export function test() {
    // Invalid rtnl module methods
    rtnl.lol();
    rtnl.timer();
}`;

    const result = parseAndAnalyze(code);

    const rtnlErrors = result.diagnostics.filter(
        (d) =>
            d.message.includes('not available on the rtnl module') &&
            d.severity === DiagnosticSeverity.Error,
    );

    if (rtnlErrors.length !== 2) {
        console.log(`Found ${rtnlErrors.length} rtnl module validation errors:`);
        rtnlErrors.forEach((error, i) => {
            console.log(`  ${i + 1}. ${error.message}`);
        });

        console.log('All diagnostics:');
        result.diagnostics.forEach((d, i) => {
            console.log(`  ${i + 1}. [${d.severity}] ${d.message}`);
        });
    }

    expect(rtnlErrors.length).toBe(2);
    expect(rtnlErrors.every((e) => e.message.includes("Method '"))).toBe(true);
});

test('rtnl module validation - valid methods allowed', () => {
    const code = `
'use strict';

import * as rtnl from 'rtnl';

export function test() {
    const result = rtnl.request({});
    const listener = rtnl.listener(() => {});
    const lastError = rtnl.error();
    return [result, listener, lastError];
}`;

    const result = parseAndAnalyze(code);

    const rtnlErrors = result.diagnostics.filter(
        (d) => d.message.includes('not available on the rtnl module'),
    );

    if (rtnlErrors.length > 0) {
        console.log('Unexpected rtnl module validation errors:');
        rtnlErrors.forEach((error, i) => {
            console.log(`  ${i + 1}. ${error.message}`);
        });
    }

    expect(rtnlErrors.length).toBe(0);
});
