// Debug write method diagnostic issue
import { UcodeLexer } from '../src/lexer/ucodeLexer.ts';
import { UcodeParser } from '../src/parser/ucodeParser.ts';
import { SemanticAnalyzer } from '../src/analysis/semanticAnalyzer.ts';
import { TextDocument } from 'vscode-languageserver-textdocument';

console.log('🔍 Debugging Write Method Diagnostic\n');

const documentText = `file_content = open(constants.DT_HOSTINFO_FINAL_PATH, "r");
file_content.write("lol");`;

console.log('📄 Document Text:');
console.log(documentText);
console.log('\n' + '='.repeat(50));

try {
    const document = TextDocument.create('test://test.uc', 'ucode', 1, documentText);
    const lexer = new UcodeLexer(documentText, { rawMode: true });
    const tokens = lexer.tokenize();
    const parser = new UcodeParser(tokens);
    const ast = parser.parse();
    const analyzer = new SemanticAnalyzer(document);
    const result = analyzer.analyze(ast.ast);
    
    console.log('🧠 Analysis Result:');
    const symbol = result.symbolTable.lookup('file_content');
    if (symbol) {
        console.log(`✅ file_content symbol found: ${JSON.stringify(symbol.dataType)}`);
    } else {
        console.log('❌ file_content symbol NOT found');
    }
    
    console.log('\n🚨 DIAGNOSTICS:');
    if (result.diagnostics.length === 0) {
        console.log('✅ No diagnostics found');
    } else {
        result.diagnostics.forEach((diag, index) => {
            const severityMap = {
                1: 'Error',
                2: 'Warning', 
                3: 'Information',
                4: 'Hint'
            };
            const severity = severityMap[diag.severity] || 'Unknown';
            console.log(`${index + 1}. [${severity}] ${diag.message}`);
            console.log(`   Range: ${diag.range.start.line}:${diag.range.start.character}-${diag.range.end.line}:${diag.range.end.character}`);
        });
    }
    
} catch (error) {
    console.log(`❌ Error: ${error.message}`);
    console.log(error.stack);
}