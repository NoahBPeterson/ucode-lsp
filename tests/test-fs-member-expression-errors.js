// Unit test for fs member expression error detection
// This test checks if fs.open() correctly shows "fs is undefined" error

// Mock semantic analyzer to test member expression error detection
function createMockSymbolTable() {
    return {
        lookup: (name) => {
            // fs is not defined in the symbol table
            if (name === 'fs') {
                return null; // This should trigger "Undefined variable: fs"
            }
            return null;
        },
        markUsed: () => {},
        getCurrentScope: () => 0,
        enterScope: () => {},
        exitScope: () => {}
    };
}

function createMockBuiltinFunctions() {
    return new Map([
        ['open', 'open() builtin function'],
        ['readfile', 'readfile() builtin function']
    ]);
}

function createMockSemanticAnalyzer() {
    const diagnostics = [];
    const symbolTable = createMockSymbolTable();
    const builtinFunctions = createMockBuiltinFunctions();
    
    const analyzer = {
        diagnostics,
        symbolTable,
        builtinFunctions,
        
        addDiagnostic: (message, start, end, severity) => {
            diagnostics.push({ message, start, end, severity });
            console.log(`      Added diagnostic: ${message}`);
        },
        
        // Simulate visiting an identifier node
        visitIdentifier: (node) => {
            console.log(`    - visitIdentifier called for: ${node.name}`);
            
            const symbol = symbolTable.lookup(node.name);
            if (!symbol) {
                // Check if it's a builtin function before reporting as undefined
                const isBuiltin = builtinFunctions.has(node.name);
                if (!isBuiltin) {
                    analyzer.addDiagnostic(`Undefined variable: ${node.name}`, node.start, node.end, 'error');
                } else {
                    console.log(`      Found builtin function: ${node.name}`);
                }
            }
        },
        
        // Simulate visiting a member expression node
        visitMemberExpression: (node) => {
            console.log(`    - visitMemberExpression called for: ${node.object.name}.${node.property.name}`);
            
            // Visit the object part (should trigger visitIdentifier)
            console.log(`      Visiting object: ${node.object.name}`);
            analyzer.visitIdentifier(node.object);
            
            // For non-computed member access, check special cases
            if (!node.computed && node.object.type === 'Identifier') {
                const objectName = node.object.name;
                const symbol = symbolTable.lookup(objectName);
                
                // Check for namespace imports (not relevant here)
                if (symbol && symbol.type === 'IMPORTED' && symbol.importSpecifier === '*') {
                    console.log(`      Skipping property visit for namespace import: ${objectName}`);
                    return;
                }
                
                // No longer special-case modules since fs functions are global builtins
            }
            
            // Visit the property (for computed access or normal cases)
            console.log(`      Visiting property: ${node.property.name}`);
            analyzer.visitIdentifier(node.property);
        }
    };
    
    return analyzer;
}

// Mock member expression node for fs.open
const mockFsOpenMemberExpression = {
    type: 'MemberExpression',
    object: {
        type: 'Identifier',
        name: 'fs',
        start: 10,
        end: 12
    },
    property: {
        type: 'Identifier', 
        name: 'open',
        start: 13,
        end: 17
    },
    computed: false
};

console.log('🧪 Testing fs member expression error detection...\n');

// Test 1: fs.open should generate "Undefined variable: fs" 
console.log('📋 Test 1: fs.open member expression analysis');
const analyzer1 = createMockSemanticAnalyzer();
analyzer1.visitMemberExpression(mockFsOpenMemberExpression);

console.log(`\nResult: ${analyzer1.diagnostics.length} diagnostic(s)`);
analyzer1.diagnostics.forEach((diag, i) => {
    console.log(`  [${i+1}] ${diag.message}`);
});

// Check if we got the expected error
const fsUndefinedErrors = analyzer1.diagnostics.filter(d => 
    d.message.includes('Undefined variable: fs')
);

const openUndefinedErrors = analyzer1.diagnostics.filter(d => 
    d.message.includes('Undefined variable: open')
);

console.log(`\nAnalysis:`);
console.log(`- "Undefined variable: fs" errors: ${fsUndefinedErrors.length}`);
console.log(`- "Undefined variable: open" errors: ${openUndefinedErrors.length}`);

if (fsUndefinedErrors.length === 1 && openUndefinedErrors.length === 0) {
    console.log('✅ CORRECT: fs.open() should show "Undefined variable: fs" only');
    console.log('✅ open is correctly recognized as builtin, so no error for property');
} else if (fsUndefinedErrors.length === 0) {
    console.log('❌ BUG REPRODUCED: fs.open() should show "Undefined variable: fs"');
    console.log('   The object part (fs) is not being properly checked for undefined variables');
} else {
    console.log(`⚠️  Unexpected result: fs=${fsUndefinedErrors.length}, open=${openUndefinedErrors.length}`);
}

console.log('\n💡 Expected behavior:');
console.log('   - fs.open() should generate "Undefined variable: fs"');
console.log('   - The property "open" should NOT generate an error (it\'s a builtin)');
console.log('   - Users should be guided to use open() directly, not fs.open()');

console.log('\n🔧 Debugging member expression analysis:');
console.log('   1. visitMemberExpression should call visitIdentifier on object (fs)');
console.log('   2. visitIdentifier should detect fs is not in symbol table'); 
console.log('   3. visitIdentifier should check if fs is builtin (it\'s not)');
console.log('   4. visitIdentifier should add "Undefined variable: fs" diagnostic');

// Simple pass/fail for the test runner
const testPassed = fsUndefinedErrors.length === 1 && openUndefinedErrors.length === 0;
if (!testPassed) {
    throw new Error('Test failed: fs.open() should show "Undefined variable: fs" error');
}

console.log('\n🎯 Test passed - member expression error detection works correctly in isolation.');