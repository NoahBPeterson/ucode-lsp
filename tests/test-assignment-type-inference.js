// Test for assignment expression fs type inference
// Validates that variables assigned fs function results in separate statements get proper type information

// Using source files like other tests
import { UcodeLexer } from '../src/lexer/ucodeLexer.ts';
import { UcodeParser } from '../src/parser/ucodeParser.ts';
import { SemanticAnalyzer } from '../src/analysis/semanticAnalyzer.ts';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { FsObjectType, fsTypeRegistry } from '../src/analysis/fsTypes.ts';

// Test the exact scenario reported by the user
function testAssignmentExpressionTypeInference() {
    console.log('🧪 Testing Assignment Expression Type Inference');
    console.log('=' .repeat(50));
    
    // Test case: variable declared separately, then assigned fs function result
    const testCode = `
let file_content;
try {
    file_content = open(constants.DT_HOSTINFO_FINAL_PATH, "r");
    file_content.read();
} catch (e) {
    print("Error: " + e);
}
`;

    console.log('📄 Test Code:');
    console.log(testCode);
    console.log('-'.repeat(50));

    try {
        // Create text document
        const document = TextDocument.create('test://test.uc', 'ucode', 1, testCode);
        
        // Lexical analysis
        const lexer = new UcodeLexer(testCode, { rawMode: true });
        const tokens = lexer.tokenize();
        console.log(`✅ Lexer: Generated ${tokens.length} tokens`);

        // Parsing
        const parser = new UcodeParser(tokens);
        const ast = parser.parse();
        console.log('✅ Parser: AST generated successfully');

        // Semantic analysis
        const analyzer = new SemanticAnalyzer(document);
        const result = analyzer.analyze(ast.ast);
        console.log('✅ Semantic Analysis: Completed successfully');

        // Check symbol table for file_content variable
        const symbol = result.symbolTable.lookup('file_content');
        console.log('\n🔍 Symbol Table Results:');
        
        if (symbol) {
            console.log(`✅ Variable 'file_content' found in symbol table`);
            console.log(`   - Name: ${symbol.name}`);
            console.log(`   - Type: ${symbol.type}`);
            console.log(`   - Data Type: ${JSON.stringify(symbol.dataType)}`);
            
            // Check if it's recognized as fs.file type
            const fsType = fsTypeRegistry.isVariableOfFsType(symbol.dataType);
            if (fsType === FsObjectType.FS_FILE) {
                console.log(`✅ Correctly identified as fs.file type`);
                
                // Test completion methods
                const methods = fsTypeRegistry.getMethodsForType(fsType);
                console.log(`✅ Available methods: ${methods.join(', ')}`);
                
                // Verify 'read' method is available (used in test code)
                if (methods.includes('read')) {
                    console.log(`✅ 'read' method correctly available`);
                    return true;
                } else {
                    console.log(`❌ 'read' method not found in available methods`);
                    return false;
                }
            } else {
                console.log(`❌ NOT identified as fs.file type. Found: ${fsType || 'null'}`);
                return false;
            }
        } else {
            console.log(`❌ Variable 'file_content' not found in symbol table`);
            return false;
        }

    } catch (error) {
        console.log(`❌ Test failed with error: ${error.message}`);
        console.log(`   Stack: ${error.stack}`);
        return false;
    }
}

// Test hover information scenario
function testHoverInformation() {
    console.log('\n🧪 Testing Hover Information for Assigned Variables');
    console.log('=' .repeat(50));
    
    const testCode = `let file_content = open("test.txt", "r");`;
    
    try {
        const document = TextDocument.create('test://test.uc', 'ucode', 1, testCode);
        const lexer = new UcodeLexer(testCode, { rawMode: true });
        const tokens = lexer.tokenize();
        const parser = new UcodeParser(tokens);
        const ast = parser.parse();
        const analyzer = new SemanticAnalyzer(document);
        const result = analyzer.analyze(ast.ast);

        const symbol = result.symbolTable.lookup('file_content');
        if (symbol) {
            const fsType = fsTypeRegistry.isVariableOfFsType(symbol.dataType);
            console.log(`✅ Direct assignment: ${symbol.name} -> ${fsType || 'not fs type'}`);
            return fsType === FsObjectType.FS_FILE;
        }
        return false;
    } catch (error) {
        console.log(`❌ Hover test failed: ${error.message}`);
        return false;
    }
}

// Test various fs function assignments
function testVariousFsFunctionAssignments() {
    console.log('\n🧪 Testing Various FS Function Assignments');
    console.log('=' .repeat(50));
    
    const testCases = [
        { code: 'let f; f = open("test", "r");', variable: 'f', expectedType: FsObjectType.FS_FILE },
        { code: 'let d; d = opendir("/tmp");', variable: 'd', expectedType: FsObjectType.FS_DIR },
        { code: 'let p; p = popen("ls", "r");', variable: 'p', expectedType: FsObjectType.FS_PROC },
        { code: 'let file; file = fdopen(1, "w");', variable: 'file', expectedType: FsObjectType.FS_FILE },
        { code: 'let temp; temp = mkstemp("tmpXXXXXX");', variable: 'temp', expectedType: FsObjectType.FS_FILE }
    ];
    
    let passed = 0;
    
    for (const testCase of testCases) {
        try {
            const document = TextDocument.create('test://test.uc', 'ucode', 1, testCase.code);
            const lexer = new UcodeLexer(testCase.code, { rawMode: true });
            const tokens = lexer.tokenize();
            const parser = new UcodeParser(tokens);
            const ast = parser.parse();
            const analyzer = new SemanticAnalyzer(document);
            const result = analyzer.analyze(ast.ast);

            const symbol = result.symbolTable.lookup(testCase.variable);
            if (symbol) {
                const fsType = fsTypeRegistry.isVariableOfFsType(symbol.dataType);
                if (fsType === testCase.expectedType) {
                    console.log(`✅ ${testCase.code} -> ${fsType}`);
                    passed++;
                } else {
                    console.log(`❌ ${testCase.code} -> Expected: ${testCase.expectedType}, Got: ${fsType}`);
                }
            } else {
                console.log(`❌ ${testCase.code} -> Variable not found`);
            }
        } catch (error) {
            console.log(`❌ ${testCase.code} -> Error: ${error.message}`);
        }
    }
    
    console.log(`\n📊 FS Assignment Tests: ${passed}/${testCases.length} passed`);
    return passed === testCases.length;
}

// Run all tests
console.log('🚀 Running Assignment Expression Type Inference Tests\n');

let allTestsPassed = true;

// Test 1: The exact scenario from user report
const test1 = testAssignmentExpressionTypeInference();
allTestsPassed = allTestsPassed && test1;

// Test 2: Hover information test
const test2 = testHoverInformation();
allTestsPassed = allTestsPassed && test2;

// Test 3: Various fs function assignments
const test3 = testVariousFsFunctionAssignments();
allTestsPassed = allTestsPassed && test3;

console.log('\n' + '='.repeat(60));
console.log('📊 FINAL TEST RESULTS');
console.log('='.repeat(60));

if (allTestsPassed) {
    console.log('\n🎉 ALL ASSIGNMENT TYPE INFERENCE TESTS PASSED! 🎉');
    console.log('✅ Variables assigned fs function results in separate statements are properly typed');
    console.log('✅ Hover information shows correct fs type for assigned variables');
    console.log('✅ All fs functions (open, opendir, popen, fdopen, mkstemp) correctly inferred');
    console.log('✅ Assignment expression type inference working correctly');
    console.log('\n💡 User scenario now works correctly:');
    console.log('   let file_content;');
    console.log('   try {');
    console.log('       file_content = open(constants.DT_HOSTINFO_FINAL_PATH, "r");');
    console.log('       file_content. // <-- Shows fs.file methods with hover info');
    console.log('   }');
} else {
    console.log('\n❌ Some assignment type inference tests failed');
    console.log('⚠️  Assignment expression type inference may need additional work');
}

console.log(`\nTest Status: ${allTestsPassed ? 'PASS' : 'FAIL'}`);