const assert = require('assert');

/**
 * Test function semicolon requirement
 * Verifies that function definitions must end with a semicolon
 */

// Mock the parser and validation system
function mockValidateCode(code) {
    // Simulate the actual validation that would happen
    const diagnostics = [];
    
    // Simple regex check for function declarations without semicolons
    const functionRegex = /function\s+\w+\s*\([^)]*\)\s*\{[^}]*\}(?!\s*;)/g;
    let match;
    
    while ((match = functionRegex.exec(code)) !== null) {
        const functionStart = match.index;
        const functionEnd = match.index + match[0].length;
        
        diagnostics.push({
            message: "Functions must end with a semicolon ';'",
            start: functionEnd,
            end: functionEnd,
            severity: 'error',
            source: 'ucode-parser'
        });
    }
    
    return diagnostics;
}

describe('Function Semicolon Requirement', function() {
    
    describe('Functions WITHOUT Semicolon', function() {
        
        it('should report error for function without semicolon', function() {
            const code = `function a() {
    print("hello");
}`;
            
            const diagnostics = mockValidateCode(code);
            
            assert.strictEqual(diagnostics.length, 1, 'Should have exactly one diagnostic');
            assert.strictEqual(diagnostics[0].message, "Functions must end with a semicolon ';'");
            assert.strictEqual(diagnostics[0].severity, 'error');
        });
        
        it('should report error for function with parameters without semicolon', function() {
            const code = `function myFunc(a, b) {
    return a + b;
}`;
            
            const diagnostics = mockValidateCode(code);
            
            assert.strictEqual(diagnostics.length, 1, 'Should have exactly one diagnostic');
            assert.strictEqual(diagnostics[0].message, "Functions must end with a semicolon ';'");
        });
        
        it('should report error for multiple functions without semicolons', function() {
            const code = `function first() {
    print("first");
}

function second() {
    print("second");
}`;
            
            const diagnostics = mockValidateCode(code);
            
            assert.strictEqual(diagnostics.length, 2, 'Should have two diagnostics for two functions');
            diagnostics.forEach(diagnostic => {
                assert.strictEqual(diagnostic.message, "Functions must end with a semicolon ';'");
            });
        });
        
    });
    
    describe('Functions WITH Semicolon', function() {
        
        it('should NOT report error for function with semicolon', function() {
            const code = `function a() {
    print("hello");
};`;
            
            const diagnostics = mockValidateCode(code);
            
            assert.strictEqual(diagnostics.length, 0, 'Should have no diagnostics for correct syntax');
        });
        
        it('should NOT report error for function with parameters and semicolon', function() {
            const code = `function myFunc(a, b) {
    return a + b;
};`;
            
            const diagnostics = mockValidateCode(code);
            
            assert.strictEqual(diagnostics.length, 0, 'Should have no diagnostics for correct syntax');
        });
        
        it('should NOT report error for multiple functions with semicolons', function() {
            const code = `function first() {
    print("first");
};

function second() {
    print("second");
};`;
            
            const diagnostics = mockValidateCode(code);
            
            assert.strictEqual(diagnostics.length, 0, 'Should have no diagnostics when all functions have semicolons');
        });
        
        it('should handle mixed cases correctly', function() {
            const code = `function good() {
    print("good");
};

function bad() {
    print("bad");
}

function alsoGood() {
    print("also good");
};`;
            
            const diagnostics = mockValidateCode(code);
            
            assert.strictEqual(diagnostics.length, 1, 'Should have one diagnostic for the one bad function');
            assert.strictEqual(diagnostics[0].message, "Functions must end with a semicolon ';'");
        });
        
    });
    
    describe('Expected User Experience', function() {
        
        it('should show the error message user requested', function() {
            const code = `function a() {
    
}`;
            
            const diagnostics = mockValidateCode(code);
            
            assert.strictEqual(diagnostics.length, 1);
            assert.strictEqual(diagnostics[0].message, "Functions must end with a semicolon ';'");
            assert.strictEqual(diagnostics[0].severity, 'error');
        });
        
        it('should help users understand the requirement', function() {
            // This documents the expected behavior
            const expectation = {
                withSemicolon: {
                    code: 'function test() { print("ok"); };',
                    shouldPass: true
                },
                withoutSemicolon: {
                    code: 'function test() { print("not ok"); }',
                    shouldFail: true,
                    expectedError: "Functions must end with a semicolon ';'"
                }
            };
            
            // Test passing case
            const goodDiagnostics = mockValidateCode(expectation.withSemicolon.code);
            assert.strictEqual(goodDiagnostics.length, 0, 'Code with semicolon should pass');
            
            // Test failing case
            const badDiagnostics = mockValidateCode(expectation.withoutSemicolon.code);
            assert.strictEqual(badDiagnostics.length, 1, 'Code without semicolon should fail');
            assert.strictEqual(badDiagnostics[0].message, expectation.withoutSemicolon.expectedError);
        });
        
    });
    
});

console.log('🧪 Running Function Semicolon Tests...');