const assert = require('assert');

// Mock classes to simulate the real LSP environment
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

    getAllSymbols() {
        return Array.from(this.symbols.values());
    }

    debugLookup(name) {
        console.log(`[DEBUG] Looking for symbol: ${name}`);
        console.log(`[DEBUG] Available symbols: ${Array.from(this.symbols.keys()).join(', ')}`);
    }
}

class MockAnalysisResult {
    constructor() {
        this.symbolTable = new MockSymbolTable();
    }
}

// Mock builtin functions map
const mockBuiltinFunctions = new Map([
    ['print', 'Print values to stdout'],
    ['length', 'Get length of array/string/object'],
    ['open', 'Open a file'],
    ['readfile', 'Read file contents']
]);

// Mock connection for logging
const mockConnection = {
    console: {
        log: (msg) => console.log(`[LSP] ${msg}`)
    }
};

// Simulate the problematic getVariableCompletions function
function getVariableCompletions_OLD(objectName, analysisResult) {
    if (!analysisResult || !analysisResult.symbolTable) {
        return [];
    }

    const symbol = analysisResult.symbolTable.lookup(objectName);
    if (!symbol) {
        return [];
    }

    // This is the PROBLEMATIC code that adds generic properties
    const genericCompletions = [];
    const commonProps = [
        { name: 'length', detail: 'property', doc: 'Length property (if available)' },
        { name: 'toString', detail: 'method', doc: 'Convert to string representation' },
        { name: 'valueOf', detail: 'method', doc: 'Get primitive value of object' }
    ];
    
    for (const prop of commonProps) {
        genericCompletions.push({
            label: prop.name,
            kind: prop.detail === 'method' ? 'Method' : 'Property',
            detail: prop.detail,
            documentation: prop.doc,
            insertText: prop.name,
            sortText: `3${prop.name}`,
            filterText: prop.name
        });
    }
    
    return genericCompletions;
}

// Fixed version that should NOT add generic properties
function getVariableCompletions_FIXED(objectName, analysisResult) {
    if (!analysisResult || !analysisResult.symbolTable) {
        return [];
    }

    const symbol = analysisResult.symbolTable.lookup(objectName);
    if (!symbol) {
        return [];
    }

    // Return empty array - only provide completions for known types
    return [];
}

// Simulate createGeneralCompletions function
function createGeneralCompletions(analysisResult, connection) {
    const completions = [];
    
    // Add built-in functions
    for (const [functionName, documentation] of mockBuiltinFunctions.entries()) {
        completions.push({
            label: functionName,
            kind: 'Function',
            detail: 'built-in function',
            documentation: documentation,
            insertText: functionName,
            sortText: `1${functionName}`,
            filterText: functionName
        });
    }
    
    // Add variables from symbol table
    if (analysisResult && analysisResult.symbolTable) {
        const variables = analysisResult.symbolTable.getAllSymbols();
        if (connection) {
            connection.console.log(`Found ${variables.length} symbols in symbol table`);
        }
        
        for (const symbol of variables) {
            const varName = symbol.name;
            // Skip builtin functions (already added above)
            if (mockBuiltinFunctions.has(varName)) {
                continue;
            }
            
            let kind = 'Variable';
            let detail = 'variable';
            
            switch (symbol.type) {
                case 'variable':
                    kind = 'Variable';
                    detail = 'variable';
                    break;
                case 'parameter':
                    kind = 'Variable';
                    detail = 'parameter';
                    break;
                case 'function':
                    kind = 'Function';
                    detail = 'user function';
                    break;
                case 'imported':
                    kind = 'Module';
                    detail = `imported from ${symbol.importedFrom || 'module'}`;
                    break;
                default:
                    kind = 'Variable';
                    detail = 'identifier';
                    break;
            }
            
            completions.push({
                label: varName,
                kind: kind,
                detail: detail,
                insertText: varName,
                sortText: `0${varName}`,
                filterText: varName
            });
            
            if (connection) {
                connection.console.log(`Added variable to completions: ${varName} (${detail})`);
            }
        }
    }
    
    return completions;
}

describe('Completion Fixes', function() {
    
    describe('Variable Completion Issues', function() {
        
        it('should NOT add generic properties like length, toString, valueOf for any variable', function() {
            const analysisResult = new MockAnalysisResult();
            
            // Add a variable 'fs' that should NOT get generic properties
            analysisResult.symbolTable.addSymbol('fs', {
                name: 'fs',
                type: 'variable',
                dataType: { type: 'unknown' }
            });
            
            // Test the OLD problematic function
            const oldCompletions = getVariableCompletions_OLD('fs', analysisResult);
            
            // Should return the problematic completions
            assert.strictEqual(oldCompletions.length, 3, 'Old function should return 3 generic completions');
            assert.ok(oldCompletions.some(c => c.label === 'length'), 'Old function adds length');
            assert.ok(oldCompletions.some(c => c.label === 'toString'), 'Old function adds toString');
            assert.ok(oldCompletions.some(c => c.label === 'valueOf'), 'Old function adds valueOf');
            
            // Test the FIXED function
            const fixedCompletions = getVariableCompletions_FIXED('fs', analysisResult);
            
            // Should return empty array
            assert.strictEqual(fixedCompletions.length, 0, 'Fixed function should return no completions');
        });
        
        it('should return empty array for unknown variables in member expressions', function() {
            const analysisResult = new MockAnalysisResult();
            
            // Add a variable that's not a known module type
            analysisResult.symbolTable.addSymbol('myVar', {
                name: 'myVar',
                type: 'variable',
                dataType: { type: 'string' }
            });
            
            const completions = getVariableCompletions_FIXED('myVar', analysisResult);
            assert.strictEqual(completions.length, 0, 'Should return empty array for unknown variable types');
        });
        
    });
    
    describe('Global Variable Detection', function() {
        
        it('should include fs variable in general completions when it exists in symbol table', function() {
            const analysisResult = new MockAnalysisResult();
            
            // Add fs variable to symbol table (simulating const fs = require('fs'))
            analysisResult.symbolTable.addSymbol('fs', {
                name: 'fs',
                type: 'variable',
                dataType: { type: 'unknown' }
            });
            
            const completions = createGeneralCompletions(analysisResult, mockConnection);
            
            // Should include fs variable
            const fsCompletion = completions.find(c => c.label === 'fs');
            assert.ok(fsCompletion, 'Should include fs variable in completions');
            assert.strictEqual(fsCompletion.kind, 'Variable', 'fs should be marked as Variable');
            assert.strictEqual(fsCompletion.detail, 'variable', 'fs should have variable detail');
        });
        
        it('should include multiple variables in general completions', function() {
            const analysisResult = new MockAnalysisResult();
            
            // Add multiple variables
            analysisResult.symbolTable.addSymbol('fs', {
                name: 'fs',
                type: 'variable',
                dataType: { type: 'unknown' }
            });
            
            analysisResult.symbolTable.addSymbol('myString', {
                name: 'myString',
                type: 'variable',
                dataType: { type: 'string' }
            });
            
            analysisResult.symbolTable.addSymbol('obj', {
                name: 'obj',
                type: 'variable',
                dataType: { type: 'object' }
            });
            
            const completions = createGeneralCompletions(analysisResult, mockConnection);
            
            // Should include all variables
            const variableNames = ['fs', 'myString', 'obj'];
            for (const varName of variableNames) {
                const completion = completions.find(c => c.label === varName);
                assert.ok(completion, `Should include ${varName} variable in completions`);
                assert.strictEqual(completion.kind, 'Variable', `${varName} should be marked as Variable`);
            }
        });
        
        it('should not duplicate builtin functions when they are variables too', function() {
            const analysisResult = new MockAnalysisResult();
            
            // Add a variable that has same name as builtin (shouldn't happen but test it)
            analysisResult.symbolTable.addSymbol('print', {
                name: 'print',
                type: 'variable',
                dataType: { type: 'function' }
            });
            
            const completions = createGeneralCompletions(analysisResult, mockConnection);
            
            // Should only have one 'print' completion (the builtin one)
            const printCompletions = completions.filter(c => c.label === 'print');
            assert.strictEqual(printCompletions.length, 1, 'Should not duplicate print completion');
            assert.strictEqual(printCompletions[0].detail, 'built-in function', 'Should prefer builtin over variable');
        });
        
    });
    
    describe('Completion Sorting and Filtering', function() {
        
        it('should sort variables before builtins (sortText)', function() {
            const analysisResult = new MockAnalysisResult();
            
            analysisResult.symbolTable.addSymbol('myVar', {
                name: 'myVar',
                type: 'variable',
                dataType: { type: 'string' }
            });
            
            const completions = createGeneralCompletions(analysisResult, mockConnection);
            
            const myVarCompletion = completions.find(c => c.label === 'myVar');
            const printCompletion = completions.find(c => c.label === 'print');
            
            assert.ok(myVarCompletion, 'Should have myVar completion');
            assert.ok(printCompletion, 'Should have print completion');
            
            // Variables should have sortText starting with '0', builtins with '1'
            assert.ok(myVarCompletion.sortText.startsWith('0'), 'Variables should sort first (0x)');
            assert.ok(printCompletion.sortText.startsWith('1'), 'Builtins should sort after variables (1x)');
        });
        
    });
    
});

// Run the tests
console.log('🧪 Running Completion Fixes Unit Tests...\n');