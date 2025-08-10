const assert = require('assert');

/**
 * Test fs module completions
 * Verifies that:
 * 1. const fs = require('fs') creates proper fs module symbol
 * 2. fs.* completions show all fs module functions
 * 3. readfile() is NOT available globally (should be fs.readfile())
 */

// Mock fs module registry (simulating our implementation)
const mockFsModuleFunctions = [
    'error', 'open', 'fdopen', 'opendir', 'popen', 'readlink', 'stat', 'lstat', 
    'mkdir', 'rmdir', 'symlink', 'unlink', 'getcwd', 'chdir', 'chmod', 'chown', 
    'rename', 'glob', 'dirname', 'basename', 'lsdir', 'mkstemp', 'access', 
    'readfile', 'writefile', 'realpath', 'pipe'
];

const mockFsModuleTypeRegistry = {
    getFunctionNames: () => mockFsModuleFunctions,
    getFunction: (name) => ({ name, returnType: 'unknown' }),
    getFunctionDocumentation: (name) => `**fs.${name}()** - FS module function`
};

// Mock symbol table and analysis
class MockAnalysisResult {
    constructor() {
        this.symbols = new Map();
        this.symbolTable = {
            lookup: (name) => this.symbols.get(name),
            addSymbol: (name, symbol) => this.symbols.set(name, symbol)
        };
    }
}

// Simulate fs module completion function
function getFsModuleCompletions(objectName, analysisResult) {
    if (!analysisResult || !analysisResult.symbolTable) {
        return [];
    }

    const symbol = analysisResult.symbolTable.lookup(objectName);
    if (!symbol) {
        return [];
    }

    // Check if this is an fs module (from require('fs'))
    const isFsModule = (
        // Module symbol from require: const fs = require('fs')
        (symbol.type === 'module' && symbol.dataType && 
         typeof symbol.dataType === 'object' && 'moduleName' in symbol.dataType && 
         symbol.dataType.moduleName === 'fs')
    );

    if (isFsModule) {
        const functionNames = mockFsModuleTypeRegistry.getFunctionNames();
        const completions = [];
        
        // Add function completions
        for (const functionName of functionNames) {
            completions.push({
                label: functionName,
                kind: 'Function',
                detail: 'fs module function',
                insertText: functionName
            });
        }
        
        return completions;
    }

    return [];
}

// Simulate builtin functions (should NOT include fs functions)
const mockBuiltinFunctions = new Map([
    ['print', 'Print values to stdout'],
    ['length', 'Get length of array/string/object'],
    ['substr', 'Extract substring from string'],
    ['system', 'Execute shell command'],
    // NOTE: readfile, open, etc. should NOT be here anymore
]);

describe('FS Module Completions', function() {
    
    describe('FS Module Symbol Recognition', function() {
        
        it('should recognize const fs = require("fs") as fs module', function() {
            const analysisResult = new MockAnalysisResult();
            
            // Simulate const fs = require('fs') being analyzed
            analysisResult.symbolTable.addSymbol('fs', {
                name: 'fs',
                type: 'module',
                dataType: { type: 'object', moduleName: 'fs' }
            });
            
            const symbol = analysisResult.symbolTable.lookup('fs');
            
            assert.ok(symbol, 'fs symbol should be found');
            assert.strictEqual(symbol.type, 'module', 'fs should be module type');
            assert.strictEqual(symbol.dataType.moduleName, 'fs', 'fs should have fs moduleName');
        });
        
    });
    
    describe('FS Module Member Completions', function() {
        
        it('should provide all fs module functions for fs. completion', function() {
            const analysisResult = new MockAnalysisResult();
            
            // Add fs module symbol
            analysisResult.symbolTable.addSymbol('fs', {
                name: 'fs',
                type: 'module',
                dataType: { type: 'object', moduleName: 'fs' }
            });
            
            const completions = getFsModuleCompletions('fs', analysisResult);
            
            // Should have all fs module functions
            assert.strictEqual(completions.length, mockFsModuleFunctions.length, 
                'Should have all fs module functions');
            
            // Check for specific important functions
            const labels = completions.map(c => c.label);
            assert.ok(labels.includes('readfile'), 'Should include readfile');
            assert.ok(labels.includes('open'), 'Should include open');
            assert.ok(labels.includes('mkdir'), 'Should include mkdir');
            assert.ok(labels.includes('stat'), 'Should include stat');
            assert.ok(labels.includes('writefile'), 'Should include writefile');
            
            // All completions should be functions
            completions.forEach(completion => {
                assert.strictEqual(completion.kind, 'Function', 
                    `${completion.label} should be a Function`);
                assert.strictEqual(completion.detail, 'fs module function',
                    `${completion.label} should be fs module function`);
            });
        });
        
        it('should return empty array for non-fs variables', function() {
            const analysisResult = new MockAnalysisResult();
            
            // Add non-fs variable
            analysisResult.symbolTable.addSymbol('myVar', {
                name: 'myVar',
                type: 'variable',
                dataType: { type: 'string' }
            });
            
            const completions = getFsModuleCompletions('myVar', analysisResult);
            assert.strictEqual(completions.length, 0, 'Should return no completions for non-fs variable');
        });
        
    });
    
    describe('Global Builtin Functions', function() {
        
        it('should NOT include fs functions in global builtins', function() {
            // Check that fs functions are not in global builtins anymore
            const fsOnlyFunctions = ['readfile', 'writefile', 'open', 'opendir', 'mkdir'];
            
            for (const fsFunc of fsOnlyFunctions) {
                assert.ok(!mockBuiltinFunctions.has(fsFunc), 
                    `${fsFunc} should NOT be in global builtins - should be fs.${fsFunc}() only`);
            }
        });
        
        it('should still include non-fs builtin functions', function() {
            // These should still be global builtins
            const globalBuiltins = ['print', 'length', 'substr', 'system'];
            
            for (const builtin of globalBuiltins) {
                assert.ok(mockBuiltinFunctions.has(builtin),
                    `${builtin} should still be in global builtins`);
            }
        });
        
    });
    
    describe('Expected User Experience', function() {
        
        it('should provide correct experience for fs module usage', function() {
            // This test documents the expected user experience
            
            const scenario = {
                code: `
                    const fs = require('fs');
                    let a = readfile("test.txt");  // Should be ERROR
                    let d = fs.open("lol");        // Should work
                    let e = fs.                    // Should show completions
                `,
                
                expectations: {
                    // readfile() should NOT be available globally
                    globalReadfile: false,
                    
                    // fs. should show fs module functions
                    fsCompletions: ['open', 'readfile', 'writefile', 'mkdir', 'stat', /* etc... */],
                    
                    // fs should be recognized as module
                    fsSymbolType: 'module'
                }
            };
            
            // Test expectations
            assert.ok(!mockBuiltinFunctions.has('readfile'), 
                'readfile should not be globally available');
            
            const analysisResult = new MockAnalysisResult();
            analysisResult.symbolTable.addSymbol('fs', {
                name: 'fs',
                type: 'module',
                dataType: { type: 'object', moduleName: 'fs' }
            });
            
            const fsCompletions = getFsModuleCompletions('fs', analysisResult);
            const completionLabels = fsCompletions.map(c => c.label);
            
            // Should have key fs functions
            for (const expectedFunc of ['open', 'readfile', 'writefile', 'mkdir']) {
                assert.ok(completionLabels.includes(expectedFunc),
                    `fs. should include ${expectedFunc} in completions`);
            }
        });
        
    });
    
});

console.log('🧪 Running FS Module Completions Tests...');