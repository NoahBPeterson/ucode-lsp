// Test variable-to-variable equality narrowing
import fs from 'fs';
import { UcodeLexer } from '../src/lexer/ucodeLexer.ts';
import { UcodeParser } from '../src/parser/ucodeParser.ts';
import { SemanticAnalyzer } from '../src/analysis/semanticAnalyzer.ts';
import { UcodeType, typeToString } from '../src/analysis/symbolTable.ts';

// Use inline code matching the user's exact pattern
const testCode = `
import { readfile as rf } from 'fs';

function test(_fs) {
    let readfile = _fs.readfile;
    if (readfile != rf)
        return;
    let d = readfile;
    print(d);
}
print(test);
`;

const lexer = new UcodeLexer(testCode, { rawMode: true });
const tokens = lexer.tokenize();
const parser = new UcodeParser(tokens, testCode);
const parseResult = parser.parse();

if (!parseResult.ast) {
    console.log('❌ Parse failed');
    process.exit(1);
}

const mockTextDocument = {
    getText: () => testCode,
    positionAt: (offset) => {
        let line = 0, character = 0;
        for (let i = 0; i < offset && i < testCode.length; i++) {
            if (testCode[i] === '\n') { line++; character = 0; } else { character++; }
        }
        return { line, character };
    },
    offsetAt: (position) => {
        const lines = testCode.split('\n');
        let offset = 0;
        for (let i = 0; i < position.line && i < lines.length; i++) {
            offset += lines[i].length + 1;
        }
        return offset + position.character;
    },
    uri: 'file:///test/test-equality-narrowing.uc',
    languageId: 'ucode',
    version: 1
};

const analyzer = new SemanticAnalyzer(mockTextDocument, {
    enableScopeAnalysis: true,
    enableTypeChecking: true,
    enableFlowSensitiveTyping: true,
});
const result = analyzer.analyze(parseResult.ast);

console.log(`Diagnostics: ${result.diagnostics.length}`);
for (const d of result.diagnostics) {
    const pos = mockTextDocument.positionAt(d.range.start.character !== undefined ?
        mockTextDocument.offsetAt(d.range.start) : 0);
    console.log(`  Line ${d.range.start.line + 1}: ${d.message}`);
}

// Dump all symbols to understand state
console.log('\n--- Symbol Table ---');
const symTable = result.symbolTable;
for (const name of ['rf', 'readfile', '_fs', 'test']) {
    const sym = symTable.lookup(name);
    if (sym) {
        console.log(`  ${name}: type=${sym.type}, dataType=${JSON.stringify(sym.dataType)}, importedFrom=${sym.importedFrom}, importSpecifier=${sym.importSpecifier}`);
    } else {
        const symPos = symTable.lookupAtPosition(name, 145);
        if (symPos) {
            console.log(`  ${name} (via lookupAtPosition): type=${symPos.type}, dataType=${JSON.stringify(symPos.dataType)}`);
        } else {
            console.log(`  ${name}: NOT FOUND`);
        }
    }
}

// Check narrowed type for 'readfile' after the equality guard
if (result.typeChecker) {
    // Find "let d = readfile;" — the usage after the early exit
    const dIdx = testCode.indexOf('let d = readfile;');
    const readfileOffset = testCode.indexOf('readfile', dIdx + 8);

    console.log(`\nChecking at offset ${readfileOffset} (line: ${testCode.substring(0, readfileOffset).split('\n').length})...`);

    const narrowedType = result.typeChecker.getNarrowedTypeAtPosition('readfile', readfileOffset);
    const typeStr = narrowedType ? typeToString(narrowedType) : 'null (no narrowing)';
    console.log(`Narrowed type for 'readfile': ${typeStr}`);

    // Check equality symbol propagation for richer hover
    const eqSym = result.typeChecker.getEqualityNarrowSymbolAtPosition('readfile', readfileOffset);
    if (eqSym) {
        console.log(`Equality symbol: ${eqSym.name}, importedFrom: ${eqSym.importedFrom}, importSpecifier: ${eqSym.importSpecifier}`);
    }

    if (narrowedType && typeToString(narrowedType) === 'function') {
        console.log('✅ readfile narrowed to function');
    } else {
        console.log('❌ Expected readfile to be narrowed to function');
        process.exit(1);
    }

    // Check that d picks up the narrowed type via assignment propagation
    const dSym = result.symbolTable.lookupAtPosition('d', testCode.indexOf('let d = readfile;') + 4);
    if (dSym) {
        console.log(`\nSymbol 'd': type=${dSym.type}, dataType=${JSON.stringify(dSym.dataType)}, importedFrom=${dSym.importedFrom}, importSpecifier=${dSym.importSpecifier}`);
        if (typeToString(dSym.dataType) === 'function' && dSym.importedFrom === 'fs') {
            console.log('✅ d propagated: function type + import info');
        } else {
            console.log('❌ d should have function type and fs import info');
        }
    } else {
        console.log('❌ d symbol not found');
    }
}
