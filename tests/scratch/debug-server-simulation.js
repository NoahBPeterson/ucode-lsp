// Simulate the exact server behavior to debug the issue
import { UcodeLexer } from '../../src/lexer/ucodeLexer.ts';
import { UcodeParser } from '../../src/parser/ucodeParser.ts';
import { SemanticAnalyzer } from '../../src/analysis/semanticAnalyzer.ts';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { handleCompletion } from '../../src/completion.ts';

console.log('🔍 Simulating Exact Server Behavior\n');

// Simulate the analysis cache like the server
const analysisCache = new Map();

// Simulate the documents manager
const documents = {
    get: (uri) => {
        if (uri === 'file:///test.uc') {
            return TextDocument.create(uri, 'ucode', 1, documentText);
        }
        return null;
    }
};

const mockConnection = {
    console: {
        log: (message) => console.log(`[SERVER] ${message}`)
    }
};

// Test scenario
const documentText = `let file_content = open(constants.DT_HOSTINFO_FINAL_PATH, "r");
file_content.`;

console.log('📄 Document Text:');
console.log(documentText);
console.log('\n' + '='.repeat(50));

// Simulate validateAndAnalyzeDocument function from server.ts
async function validateAndAnalyzeDocument(textDocument) {
    console.log('🔄 Running validateAndAnalyzeDocument...');
    
    const text = textDocument.getText();
    const lexer = new UcodeLexer(text, { rawMode: true });
    const tokens = lexer.tokenize();
    const parser = new UcodeParser(tokens, text); // Exact same call as server
    const parseResult = parser.parse();

    console.log(`   Tokens: ${tokens.length}`);
    console.log(`   Parse errors: ${parseResult.errors.length}`);
    if (parseResult.errors.length > 0) {
        console.log(`   Parse errors:`, parseResult.errors);
    }

    let diagnostics = parseResult.errors.map(err => ({
        severity: 1, // DiagnosticSeverity.Error
        range: {
            start: textDocument.positionAt(err.start),
            end: textDocument.positionAt(err.end),
        },
        message: err.message,
        source: 'ucode-parser'
    }));

    if (parseResult.ast) {
        console.log('   ✅ AST exists, running semantic analysis...');
        const analyzer = new SemanticAnalyzer(textDocument, {
            enableTypeChecking: true,
            enableScopeAnalysis: true,
            enableControlFlowAnalysis: true,
            enableUnusedVariableDetection: true,
            enableShadowingWarnings: true,
        });
        const analysisResult = analyzer.analyze(parseResult.ast);
        analysisCache.set(textDocument.uri, analysisResult);
        diagnostics.push(...analysisResult.diagnostics);
        
        console.log(`   ✅ Analysis complete, cached result`);
        console.log(`   Diagnostics: ${diagnostics.length}`);
        
        // Check the symbol
        const symbol = analysisResult.symbolTable.lookup('file_content');
        if (symbol) {
            console.log(`   ✅ Symbol cached: ${JSON.stringify(symbol.dataType)}`);
        } else {
            console.log(`   ❌ Symbol NOT found in cache`);
        }
    } else {
        console.log('   ❌ No AST, deleting cache');
        analysisCache.delete(textDocument.uri);
    }
    
    return diagnostics;
}

// Simulate document open/change event
async function simulateDocumentEvent() {
    console.log('🚀 Step 1: Simulate document open/change event');
    const document = TextDocument.create('file:///test.uc', 'ucode', 1, documentText);
    await validateAndAnalyzeDocument(document);
    
    console.log('\n🚀 Step 2: Check analysis cache');
    const cachedResult = analysisCache.get('file:///test.uc');
    if (cachedResult) {
        console.log('✅ Analysis result found in cache');
        const symbol = cachedResult.symbolTable.lookup('file_content');
        console.log(`   Symbol: ${symbol ? JSON.stringify(symbol.dataType) : 'NOT FOUND'}`);
    } else {
        console.log('❌ NO analysis result in cache!');
        return;
    }
    
    console.log('\n🚀 Step 3: Simulate completion request');
    const params = {
        textDocument: { uri: 'file:///test.uc' },
        position: { line: 1, character: 13 }
    };
    
    // This is exactly what the server does
    const analysisResult = analysisCache.get(params.textDocument.uri);
    console.log(`Analysis result for completion: ${analysisResult ? 'FOUND' : 'NOT FOUND'}`);
    
    if (!analysisResult) {
        console.log('❌ This is the bug! Analysis result is not in cache when completion is requested');
        return;
    }
    
    const completions = handleCompletion(params, documents, mockConnection, analysisResult);
    
    console.log(`\n📊 COMPLETION RESULTS:`);
    console.log(`Total completions: ${completions.length}`);
    
    if (completions.length === 0) {
        console.log('❌ ZERO COMPLETIONS - Something is still wrong');
    } else {
        console.log('✅ Got completions:');
        completions.slice(0, 5).forEach((comp, index) => {
            console.log(`  ${index + 1}. ${comp.label} (kind: ${comp.kind})`);
        });
        if (completions.length > 5) {
            console.log(`  ... and ${completions.length - 5} more`);
        }
    }
}

// Run the simulation
simulateDocumentEvent().catch(error => {
    console.log(`❌ SIMULATION ERROR: ${error.message}`);
    console.log(error.stack);
});