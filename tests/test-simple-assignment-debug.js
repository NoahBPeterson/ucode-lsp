// Debug test for assignment expression parsing
import { UcodeLexer } from '../src/lexer/ucodeLexer.ts';
import { UcodeParser } from '../src/parser/ucodeParser.ts';
import { SemanticAnalyzer } from '../src/analysis/semanticAnalyzer.ts';
import { TextDocument } from 'vscode-languageserver-textdocument';

console.log('🔍 Debugging Assignment Expression Parsing\n');

// Test the exact user scenario - separate declaration and assignment in try block
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
    // Lexical analysis
    console.log('🔤 LEXER OUTPUT:');
    const lexer = new UcodeLexer(testCode, { rawMode: true });
    const tokens = lexer.tokenize();
    
    console.log(`Total tokens: ${tokens.length}`);
    tokens.forEach((token, index) => {
        console.log(`${index}: ${token.type} = "${token.value}" (pos: ${token.pos}-${token.end})`);
    });

    console.log('\n🌳 PARSER OUTPUT:');
    const parser = new UcodeParser(tokens);
    const ast = parser.parse();
    
    console.log('AST structure:');
    console.log(JSON.stringify(ast, null, 2));

    console.log('\n🧠 SEMANTIC ANALYSIS:');
    const document = TextDocument.create('test://test.uc', 'ucode', 1, testCode);
    const analyzer = new SemanticAnalyzer(document);
    
    // Check the analyzer options
    console.log('Analyzer options:', {
        enableScopeAnalysis: analyzer.options?.enableScopeAnalysis,
        enableTypeChecking: analyzer.options?.enableTypeChecking
    });
    
    const result = analyzer.analyze(ast.ast); // Use ast.ast instead of ast
    
    console.log('Symbol table contents:');
    const allSymbols = result.symbolTable.getAllSymbols();
    const symbols = allSymbols.map(symbol => ({ 
        name: symbol.name, 
        type: symbol.type, 
        dataType: symbol.dataType 
    }));
    
    console.log('Symbols found:', symbols);
    
    // Try to lookup file_content specifically
    const fileContentSymbol = result.symbolTable.lookup('file_content');
    if (fileContentSymbol) {
        console.log('✅ file_content symbol found:');
        console.log(`   Name: ${fileContentSymbol.name}`);
        console.log(`   Type: ${fileContentSymbol.type}`);
        console.log(`   Data Type: ${JSON.stringify(fileContentSymbol.dataType)}`);
        
        // Check if it's recognized as fs.file type
        const { FsObjectType, fsTypeRegistry } = await import('../src/analysis/fsTypes.ts');
        const fsType = fsTypeRegistry.isVariableOfFsType(fileContentSymbol.dataType);
        if (fsType === FsObjectType.FS_FILE) {
            console.log('✅ Correctly identified as fs.file type');
            console.log('🎯 USER SCENARIO WORKS! Hover will show fs.file type');
        } else {
            console.log(`❌ NOT identified as fs.file type. Found: ${fsType || 'null'}`);
        }
    } else {
        console.log('❌ file_content symbol NOT found');
    }
    
    console.log('\nDiagnostics:');
    result.diagnostics.forEach(diag => {
        console.log(`${diag.severity}: ${diag.message}`);
    });

} catch (error) {
    console.log(`❌ Error: ${error.message}`);
    console.log(error.stack);
}