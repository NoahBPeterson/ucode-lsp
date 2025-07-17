// Debug completion for the exact user scenario
import { UcodeLexer } from '../src/lexer/ucodeLexer.ts';
import { handleCompletion } from '../src/completion.ts';
import { UcodeParser } from '../src/parser/ucodeParser.ts';
import { SemanticAnalyzer } from '../src/analysis/semanticAnalyzer.ts';
import { TextDocument } from 'vscode-languageserver-textdocument';

console.log('🔍 Debugging Real Completion Scenario\n');

// Test the exact user scenario - undeclared variable
const documentText = `file_content = open(constants.DT_HOSTINFO_FINAL_PATH, "r");
file_content.write("lol");`;

console.log('📄 Document Text:');
console.log(documentText);
console.log('\n' + '='.repeat(60));

// Mock document manager
const mockDocuments = {
    get: (uri) => {
        if (uri === 'test://test.uc') {
            return TextDocument.create(uri, 'ucode', 1, documentText);
        }
        return null;
    }
};

// Mock connection for logging
const mockConnection = {
    console: {
        log: (message) => console.log(`[LOG] ${message}`)
    }
};

// Create analysis result like the server would
function createAnalysisResult() {
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
        
        return result;
    } catch (error) {
        console.log(`❌ Analysis failed: ${error.message}`);
        return null;
    }
}

// Test completion at different positions
function testCompletion(position, description) {
    console.log(`\n🧪 Testing completion: ${description}`);
    console.log(`Position: line ${position.line}, character ${position.character}`);
    
    const document = mockDocuments.get('test://test.uc');
    const offset = document.offsetAt(position);
    
    console.log(`Offset: ${offset}`);
    console.log(`Character at offset: "${documentText[offset]}"`);
    console.log(`Context: "${documentText.substring(Math.max(0, offset - 10), offset + 10)}"`);
    
    const params = {
        textDocument: { uri: 'test://test.uc' },
        position: position
    };
    
    const analysisResult = createAnalysisResult();
    const completions = handleCompletion(params, mockDocuments, mockConnection, analysisResult);
    
    console.log(`✅ Got ${completions.length} completions:`);
    if (completions.length > 0 && completions.length <= 20) {
        completions.forEach((comp, index) => {
            console.log(`  ${index + 1}. ${comp.label} (${comp.kind})`);
        });
    } else if (completions.length > 20) {
        console.log(`  First 10:`);
        completions.slice(0, 10).forEach((comp, index) => {
            console.log(`  ${index + 1}. ${comp.label} (${comp.kind})`);
        });
        console.log(`  ... and ${completions.length - 10} more`);
    }
    
    // Check if fs.file methods are present
    const fsFileMethods = ['read', 'write', 'close', 'seek', 'tell', 'flush'];
    const foundFsMethods = completions.filter(comp => fsFileMethods.includes(comp.label));
    console.log(`🎯 Found fs.file methods: ${foundFsMethods.map(c => c.label).join(', ')}`);
    
    // Check if builtin functions are present (they shouldn't be for member expressions)
    const builtinFunctions = ['print', 'printf', 'length', 'substr'];
    const foundBuiltins = completions.filter(comp => builtinFunctions.includes(comp.label));
    console.log(`⚠️  Found builtin functions: ${foundBuiltins.map(c => c.label).join(', ')}`);
    
    // Check if keywords are present (they shouldn't be for member expressions)
    const keywords = ['let', 'const', 'function', 'if', 'for', 'while'];
    const foundKeywords = completions.filter(comp => keywords.includes(comp.label));
    console.log(`❌ Found keywords: ${foundKeywords.map(c => c.label).join(', ')}`);
    
    return {
        total: completions.length,
        fsMethods: foundFsMethods.length,
        builtins: foundBuiltins.length,
        keywords: foundKeywords.length
    };
}

// Test scenarios
console.log('\n' + '='.repeat(60));
console.log('🧪 COMPLETION TEST SCENARIOS');
console.log('='.repeat(60));

// 1. Right after the dot in "file_content."
const result1 = testCompletion({ line: 1, character: 13 }, "After dot in file_content.");

// 2. After typing "w" in "file_content.w"
const documentText2 = `file_content = open(constants.DT_HOSTINFO_FINAL_PATH, "r");
file_content.w`;

// Update the mock for this test
const mockDocuments2 = {
    get: (uri) => {
        if (uri === 'test://test2.uc') {
            return TextDocument.create(uri, 'ucode', 1, documentText2);
        }
        return null;
    }
};

console.log('\n📄 Document Text 2:');
console.log(documentText2);

// Re-run the test with the new document
const result2 = testCompletion({ line: 1, character: 14 }, "After typing 'w' in file_content.w");

console.log('\n' + '='.repeat(60));
console.log('📊 SUMMARY');
console.log('='.repeat(60));

console.log(`Test 1 (file_content.): ${result1.fsMethods} fs methods, ${result1.builtins} builtins, ${result1.keywords} keywords`);
console.log(`Test 2 (file_content.w): ${result2.fsMethods} fs methods, ${result2.builtins} builtins, ${result2.keywords} keywords`);

const success1 = result1.fsMethods > 0 && result1.builtins === 0 && result1.keywords === 0;
const success2 = result2.fsMethods > 0 && result2.builtins === 0 && result2.keywords === 0;

console.log(`\nTest 1 Status: ${success1 ? '✅ PASS' : '❌ FAIL'}`);
console.log(`Test 2 Status: ${success2 ? '✅ PASS' : '❌ FAIL'}`);

if (success1 && success2) {
    console.log('\n🎉 COMPLETION SYSTEM WORKING CORRECTLY!');
} else {
    console.log('\n⚠️  COMPLETION SYSTEM NEEDS FIXES');
    if (result1.builtins > 0 || result1.keywords > 0) {
        console.log('- Member expression detection may be failing');
        console.log('- General completions being shown instead of fs-specific ones');
    }
    if (result1.fsMethods === 0) {
        console.log('- fs.file type inference or completion generation failing');
    }
}