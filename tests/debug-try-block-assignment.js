// Debug try block assignment issue
import { UcodeLexer } from '../src/lexer/ucodeLexer.ts';
import { UcodeParser } from '../src/parser/ucodeParser.ts';
import { SemanticAnalyzer } from '../src/analysis/semanticAnalyzer.ts';
import { TextDocument } from 'vscode-languageserver-textdocument';

console.log('🔍 Debugging Try Block Assignment\n');

// Test the exact failing case
const testCode = `let file_content;
try {
    file_content = open(constants.DT_HOSTINFO_FINAL_PATH, "r");
    file_content.read();
} catch (e) {
    print("Error: " + e);
}`;

console.log('📄 Test Code:');
console.log(testCode);
console.log('\n' + '='.repeat(50));

try {
    const document = TextDocument.create('test://test.uc', 'ucode', 1, testCode);
    const lexer = new UcodeLexer(testCode, { rawMode: true });
    const tokens = lexer.tokenize();
    const parser = new UcodeParser(tokens);
    const ast = parser.parse();

    console.log('🔤 TOKENS:');
    tokens.forEach((token, index) => {
        console.log(`${index}: ${token.type} = "${token.value}" (pos: ${token.pos}-${token.end})`);
    });

    console.log('\n🌳 AST Structure:');
    console.log(JSON.stringify(ast.ast, null, 2));

    const analyzer = new SemanticAnalyzer(document);
    const result = analyzer.analyze(ast.ast);

    console.log('\n🧠 Symbol Analysis:');
    const symbol = result.symbolTable.lookup('file_content');
    if (symbol) {
        console.log('✅ file_content symbol found:');
        console.log(`   Name: ${symbol.name}`);
        console.log(`   Type: ${symbol.type}`);
        console.log(`   Data Type: ${JSON.stringify(symbol.dataType)}`);
        console.log(`   Is fs.file?: ${symbol.dataType?.moduleName === 'fs.file'}`);
    } else {
        console.log('❌ file_content symbol NOT found');
    }

    console.log('\n📊 All Symbols:');
    const allSymbols = result.symbolTable.getAllSymbols();
    allSymbols.forEach(sym => {
        if (sym.type === 'variable') {
            console.log(`- ${sym.name}: ${JSON.stringify(sym.dataType)}`);
        }
    });

} catch (error) {
    console.log(`❌ Error: ${error.message}`);
    console.log(error.stack);
}