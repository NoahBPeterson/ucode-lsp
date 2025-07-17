// Debug the real-world issue - why is there zero intellisense?
import { UcodeLexer } from '../src/lexer/ucodeLexer.ts';
import { UcodeParser } from '../src/parser/ucodeParser.ts';
import { SemanticAnalyzer } from '../src/analysis/semanticAnalyzer.ts';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { handleCompletion } from '../src/completion.ts';

console.log('🔍 Debugging Real-World Zero Intellisense Issue\n');

// Test the exact user case
const documentText = `let file_content = open(constants.DT_HOSTINFO_FINAL_PATH, "r");
file_content.`;

console.log('📄 Document Text:');
console.log(documentText);
console.log('\n' + '='.repeat(60));

// Mock the exact same setup as the LSP server
const mockDocuments = {
    get: (uri) => {
        if (uri === 'file:///test.uc') {
            return TextDocument.create(uri, 'ucode', 1, documentText);
        }
        return null;
    }
};

const mockConnection = {
    console: {
        log: (message) => console.log(`[SERVER LOG] ${message}`)
    }
};

console.log('🧪 Step 1: Create Analysis Result (like server.ts does)');
try {
    const document = TextDocument.create('file:///test.uc', 'ucode', 1, documentText);
    const lexer = new UcodeLexer(documentText, { rawMode: true });
    const tokens = lexer.tokenize();
    console.log(`✅ Tokenized: ${tokens.length} tokens`);
    
    const parser = new UcodeParser(tokens);
    const ast = parser.parse();
    console.log(`✅ Parsed: ${ast.errors.length} errors`);
    if (ast.errors.length > 0) {
        console.log('Parser errors:', ast.errors);
    }
    
    const analyzer = new SemanticAnalyzer(document);
    const analysisResult = analyzer.analyze(ast.ast);
    console.log(`✅ Analyzed: ${analysisResult.diagnostics.length} diagnostics`);
    
    // Check symbol table
    const symbol = analysisResult.symbolTable.lookup('file_content');
    if (symbol) {
        console.log(`✅ Symbol found: ${JSON.stringify(symbol.dataType)}`);
    } else {
        console.log(`❌ Symbol NOT found`);
    }
    
    console.log('\n🧪 Step 2: Test Completion at cursor position');
    
    // Position right after the dot: line 1, character 13
    const position = { line: 1, character: 13 };
    const offset = document.offsetAt(position);
    console.log(`Cursor position: line ${position.line}, char ${position.character}, offset ${offset}`);
    console.log(`Character at offset: "${documentText[offset] || '<EOF>'}"`);
    
    const params = {
        textDocument: { uri: 'file:///test.uc' },
        position: position
    };
    
    console.log('\n📡 Calling handleCompletion (exact same as server)...');
    const completions = handleCompletion(params, mockDocuments, mockConnection, analysisResult);
    
    console.log(`\n📊 COMPLETION RESULTS:`);
    console.log(`Total completions: ${completions.length}`);
    
    if (completions.length === 0) {
        console.log('❌ ZERO COMPLETIONS - This is the bug!');
        
        // Debug what went wrong
        console.log('\n🔍 DEBUGGING WHY ZERO COMPLETIONS:');
        
        // Test member expression detection manually
        const memberTokens = lexer.tokenize();
        console.log('Testing member expression detection...');
        
        // Copy the detection logic from completion.ts
        let dotTokenIndex = -1;
        for (let i = memberTokens.length - 1; i >= 0; i--) {
            const token = memberTokens[i];
            if (token.type === 47 && token.pos < offset) { // TK_DOT = 47
                dotTokenIndex = i;
                break;
            }
        }
        
        console.log(`Dot token index: ${dotTokenIndex}`);
        if (dotTokenIndex > 0) {
            const dotToken = memberTokens[dotTokenIndex];
            const prevToken = memberTokens[dotTokenIndex - 1];
            console.log(`Dot token: ${JSON.stringify(dotToken)}`);
            console.log(`Prev token: ${JSON.stringify(prevToken)}`);
            console.log(`Prev token type: ${prevToken.type} (should be 63 for TK_LABEL)`);
            console.log(`Prev token end === dot pos? ${prevToken.end === dotToken.pos}`);
            console.log(`Offset >= dot end? ${offset >= dotToken.end}`);
        }
        
    } else {
        completions.forEach((comp, index) => {
            console.log(`  ${index + 1}. ${comp.label} (kind: ${comp.kind})`);
        });
    }
    
} catch (error) {
    console.log(`❌ CRITICAL ERROR: ${error.message}`);
    console.log(error.stack);
}