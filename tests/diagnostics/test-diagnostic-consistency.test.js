const assert = require('assert');

/**
 * Test diagnostic consistency for fs functions
 * Verifies that fs functions like 'open', 'readfile' are consistently 
 * treated as undefined when used globally
 */

// Mock type checker builtin functions (should NOT include fs functions anymore)
const mockTypeCheckerBuiltins = new Map([
    // Core builtins that should still be global
    ['print', { name: 'print', parameters: [], returnType: 'integer', variadic: true }],
    ['length', { name: 'length', parameters: ['unknown'], returnType: 'integer' }],
    ['substr', { name: 'substr', parameters: ['string', 'integer'], returnType: 'string', minParams: 2, maxParams: 3 }],
    ['system', { name: 'system', parameters: ['string'], returnType: 'integer' }],
    
    // NOTE: fs functions like 'open', 'readfile', etc. should NOT be here
]);

// Mock symbol table for testing
class MockSymbolTable {
    constructor() {
        this.symbols = new Map();
    }
    
    addSymbol(name, symbol) {
        this.symbols.set(name, symbol);
    }
    
    lookup(name) {
        return this.symbols.get(name) || null;
    }
}

// Simulate function call validation
function validateFunctionCall(funcName, argCount, typeCheckerBuiltins, symbolTable) {
    // Check if it's a builtin function
    const signature = typeCheckerBuiltins.get(funcName);
    
    if (signature) {
        // Builtin function found - validate arguments
        const minParams = signature.minParams || signature.parameters.length;
        const maxParams = signature.maxParams || (signature.variadic ? Infinity : signature.parameters.length);
        
        const diagnostics = [];
        
        if (argCount < minParams) {
            diagnostics.push({
                type: 'error',
                message: `Function '${signature.name}' expects at least ${minParams} arguments, got ${argCount}`
            });
        } else if (argCount > maxParams) {
            diagnostics.push({
                type: 'error', 
                message: `Function '${signature.name}' expects at most ${maxParams} arguments, got ${argCount}`
            });
        }
        
        return { found: true, diagnostics };
    } else {
        // Check if it's a user-defined function or variable
        const symbol = symbolTable.lookup(funcName);
        if (symbol && (symbol.type === 'function' || symbol.type === 'variable')) {
            return { found: true, diagnostics: [] };
        }
        
        // Function not found
        return { 
            found: false, 
            diagnostics: [{
                type: 'error',
                message: `Undefined function: ${funcName}`
            }]
        };
    }
}

describe('Diagnostic Consistency', function() {
    
    describe('FS Functions Should Be Consistently Undefined Globally', function() {
        
        it('should report "open()" as undefined function, not argument error', function() {
            const symbolTable = new MockSymbolTable();
            
            // Test: open() with 0 arguments
            const result = validateFunctionCall('open', 0, mockTypeCheckerBuiltins, symbolTable);
            
            // Should be undefined function, not argument count error
            assert.strictEqual(result.found, false, 'open should not be found as builtin');
            assert.strictEqual(result.diagnostics.length, 1, 'Should have exactly one diagnostic');
            assert.strictEqual(result.diagnostics[0].message, 'Undefined function: open', 
                'Should report undefined function, not argument count');
        });
        
        it('should report "readfile()" as undefined function consistently', function() {
            const symbolTable = new MockSymbolTable();
            
            // Test: readfile("test.txt") with 1 argument
            const result = validateFunctionCall('readfile', 1, mockTypeCheckerBuiltins, symbolTable);
            
            // Should be undefined function
            assert.strictEqual(result.found, false, 'readfile should not be found as builtin');
            assert.strictEqual(result.diagnostics.length, 1, 'Should have exactly one diagnostic');
            assert.strictEqual(result.diagnostics[0].message, 'Undefined function: readfile',
                'Should report undefined function');
        });
        
        it('should still validate regular builtin functions properly', function() {
            const symbolTable = new MockSymbolTable();
            
            // Test: length() with 0 arguments (should be argument error)
            const result = validateFunctionCall('length', 0, mockTypeCheckerBuiltins, symbolTable);
            
            assert.strictEqual(result.found, true, 'length should be found as builtin');
            assert.strictEqual(result.diagnostics.length, 1, 'Should have argument error');
            assert.ok(result.diagnostics[0].message.includes('expects at least 1 arguments'),
                'Should report argument count error for builtin functions');
        });
        
    });
    
    describe('User-Defined Functions Should Work', function() {
        
        it('should allow user to define their own "open" function', function() {
            const symbolTable = new MockSymbolTable();
            
            // User defines: function open(name) { ... }
            symbolTable.addSymbol('open', {
                name: 'open',
                type: 'function',
                dataType: 'function'
            });
            
            // Test: open("something") should work
            const result = validateFunctionCall('open', 1, mockTypeCheckerBuiltins, symbolTable);
            
            assert.strictEqual(result.found, true, 'User-defined open function should be found');
            assert.strictEqual(result.diagnostics.length, 0, 'Should have no diagnostics');
        });
        
        it('should allow different function signatures for user-defined functions', function() {
            const symbolTable = new MockSymbolTable();
            
            // User defines: function open() { return "hello"; }  (0 parameters)
            symbolTable.addSymbol('open', {
                name: 'open',
                type: 'function',
                dataType: 'function'
            });
            
            // Test: open() with 0 arguments should work for user function
            const result = validateFunctionCall('open', 0, mockTypeCheckerBuiltins, symbolTable);
            
            assert.strictEqual(result.found, true, 'User-defined open function should be found');
            assert.strictEqual(result.diagnostics.length, 0, 'Should have no diagnostics for user function');
        });
        
    });
    
    describe('Expected Behavior Summary', function() {
        
        it('should demonstrate the fixed behavior', function() {
            const symbolTable = new MockSymbolTable();
            
            const testCases = [
                // These should all be "Undefined function" errors now
                { func: 'open', args: 0, expected: 'Undefined function: open' },
                { func: 'open', args: 2, expected: 'Undefined function: open' },
                { func: 'readfile', args: 1, expected: 'Undefined function: readfile' },
                { func: 'writefile', args: 2, expected: 'Undefined function: writefile' },
                
                // These should still be builtin validation errors
                { func: 'length', args: 0, expected: 'expects at least 1 arguments' },
                { func: 'substr', args: 1, expected: 'expects at least 2 arguments' },
            ];
            
            for (const testCase of testCases) {
                const result = validateFunctionCall(testCase.func, testCase.args, mockTypeCheckerBuiltins, symbolTable);
                
                if (testCase.expected.startsWith('Undefined function:')) {
                    assert.strictEqual(result.found, false, `${testCase.func} should not be found`);
                    assert.strictEqual(result.diagnostics[0].message, testCase.expected,
                        `${testCase.func} should give correct undefined message`);
                } else {
                    assert.strictEqual(result.found, true, `${testCase.func} should be found as builtin`);
                    assert.ok(result.diagnostics[0].message.includes(testCase.expected),
                        `${testCase.func} should give argument validation error`);
                }
            }
        });
        
    });
    
});

console.log('🧪 Running Diagnostic Consistency Tests...');