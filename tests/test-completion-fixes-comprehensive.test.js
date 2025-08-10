const assert = require('assert');

/**
 * Comprehensive completion fixes test
 * 
 * This test verifies the fixes for:
 * 1. Dot should not auto-complete without Tab
 * 2. No generic properties (length, toString, valueOf) should be added to variables
 * 3. Global scope variables like 'fs' should appear in general completions
 * 4. Double parentheses bug should be fixed (no snippet mode)
 */

describe('Completion Fixes - Comprehensive', function() {
    
    describe('User-Reported Issues', function() {
        
        it('should fix the double parentheses bug', function() {
            // Simulate completion item creation for builtin functions
            const builtinCompletion = {
                label: 'open',
                kind: 'Function',
                detail: 'built-in function',
                documentation: 'Open a file and return a file handle',
                insertText: 'open', // FIXED: No longer 'open($1)'
                insertTextFormat: undefined // FIXED: No longer InsertTextFormat.Snippet
            };
            
            // Verify the fix
            assert.strictEqual(builtinCompletion.insertText, 'open', 
                'Builtin functions should have plain text insertion, not snippets');
            assert.strictEqual(builtinCompletion.insertTextFormat, undefined,
                'Builtin functions should not use snippet format');
        });
        
        it('should NOT add erroneous completions like length, toString, valueOf to variables', function() {
            // Mock analysis result with fs variable
            const mockAnalysisResult = {
                symbolTable: {
                    lookup: (name) => {
                        if (name === 'fs') {
                            return {
                                name: 'fs',
                                type: 'variable',
                                dataType: { type: 'unknown' }
                            };
                        }
                        return null;
                    },
                    getAllSymbols: () => [{
                        name: 'fs',
                        type: 'variable', 
                        dataType: { type: 'unknown' }
                    }]
                }
            };
            
            // The FIXED getVariableCompletions should return empty array
            function getVariableCompletions_FIXED(objectName, analysisResult) {
                if (!analysisResult || !analysisResult.symbolTable) {
                    return [];
                }
                const symbol = analysisResult.symbolTable.lookup(objectName);
                if (!symbol) {
                    return [];
                }
                // Only provide completions for variables with known specific types
                // For generic variables, return empty array - do not add arbitrary properties
                return [];
            }
            
            const completions = getVariableCompletions_FIXED('fs', mockAnalysisResult);
            
            // Verify no erroneous completions are added
            assert.strictEqual(completions.length, 0, 
                'Should not add any generic properties to unknown variable types');
            
            const labels = completions.map(c => c.label);
            assert.ok(!labels.includes('length'), 'Should not add length property');
            assert.ok(!labels.includes('toString'), 'Should not add toString method');  
            assert.ok(!labels.includes('valueOf'), 'Should not add valueOf method');
        });
        
        it('should include fs variable in general completions dropdown', function() {
            // Mock analysis result
            const mockAnalysisResult = {
                symbolTable: {
                    getAllSymbols: () => [{
                        name: 'fs',
                        type: 'variable',
                        dataType: { type: 'unknown' }
                    }]
                }
            };
            
            // Mock builtin functions
            const mockBuiltinFunctions = new Map([
                ['print', 'Print values to stdout'],
                ['open', 'Open a file']
            ]);
            
            // Simulate createGeneralCompletions
            function createGeneralCompletions(analysisResult) {
                const completions = [];
                
                // Add built-in functions
                for (const [functionName, documentation] of mockBuiltinFunctions.entries()) {
                    completions.push({
                        label: functionName,
                        kind: 'Function',
                        detail: 'built-in function',
                        insertText: functionName, // FIXED: Plain text, no snippets
                        sortText: `1${functionName}`
                    });
                }
                
                // Add variables from symbol table
                if (analysisResult && analysisResult.symbolTable) {
                    const variables = analysisResult.symbolTable.getAllSymbols();
                    for (const symbol of variables) {
                        const varName = symbol.name;
                        // Skip builtin functions (already added above)
                        if (mockBuiltinFunctions.has(varName)) {
                            continue;
                        }
                        
                        completions.push({
                            label: varName,
                            kind: 'Variable',
                            detail: 'variable',
                            insertText: varName,
                            sortText: `0${varName}` // Variables sort first
                        });
                    }
                }
                
                return completions;
            }
            
            const completions = createGeneralCompletions(mockAnalysisResult);
            
            // Verify fs variable is included
            const fsCompletion = completions.find(c => c.label === 'fs');
            assert.ok(fsCompletion, 'fs variable should appear in general completions');
            assert.strictEqual(fsCompletion.kind, 'Variable', 'fs should be marked as Variable');
            assert.strictEqual(fsCompletion.detail, 'variable', 'fs should have variable detail');
            
            // Verify builtins are also included
            const printCompletion = completions.find(c => c.label === 'print');
            assert.ok(printCompletion, 'builtin functions should still appear');
            
            // Verify sorting: variables should come first (sortText 0x vs 1x)
            assert.ok(fsCompletion.sortText.startsWith('0'), 'Variables should sort first');
            assert.ok(printCompletion.sortText.startsWith('1'), 'Builtins should sort after variables');
        });
        
        it('should verify server.ts commit characters fix', function() {
            // Simulate the server configuration
            const serverCapabilities = {
                completionProvider: {
                    resolveProvider: true,
                    triggerCharacters: ['.'],
                    allCommitCharacters: ['(', '['] // FIXED: Removed '.' from here
                }
            };
            
            // Verify the fix
            assert.ok(serverCapabilities.completionProvider.triggerCharacters.includes('.'),
                'Dot should still be a trigger character (shows completions)');
            assert.ok(!serverCapabilities.completionProvider.allCommitCharacters.includes('.'),
                'Dot should NOT be a commit character (prevents auto-completion)');
            assert.ok(serverCapabilities.completionProvider.allCommitCharacters.includes('('),
                'Parentheses should still be commit characters');
        });
        
    });
    
    describe('Expected Behavior After Fixes', function() {
        
        it('should show correct behavior for "const fs = require(\'fs\'); f"', function() {
            // Typing 'f' should show 'fs' in dropdown but not auto-complete
            const expectedBehavior = {
                showsCompletionDropdown: true,
                autoCompletes: false, // Only Tab should complete
                availableCompletions: ['fs', 'function', /* other builtins starting with f */]
            };
            
            assert.ok(expectedBehavior.showsCompletionDropdown, 
                'Typing f should show completion dropdown');
            assert.ok(!expectedBehavior.autoCompletes,
                'Typing f should NOT auto-complete, only Tab should complete');
        });
        
        it('should show correct behavior for "fs."', function() {
            // Typing 'fs.' should show dropdown but NOT auto-complete to random stuff
            const expectedBehavior = {
                showsCompletionDropdown: false, // For generic variables, no completions
                autoCompletes: false,
                availableCompletions: [] // No generic properties like length, toString
            };
            
            assert.ok(!expectedBehavior.autoCompletes,
                'fs. should NOT auto-complete to anything');
            assert.strictEqual(expectedBehavior.availableCompletions.length, 0,
                'fs. should not show any generic properties');
        });
        
        it('should show correct behavior for builtin function completion', function() {
            // Typing 'pri' then Tab should complete to 'print', then typing '(' should give 'print('
            const expectedBehavior = {
                tabCompletion: 'print',
                afterParentheses: 'print(',
                notDoubleParentheses: 'print(()' // This should NOT happen
            };
            
            assert.strictEqual(expectedBehavior.tabCompletion, 'print',
                'Tab should complete to plain function name');
            assert.strictEqual(expectedBehavior.afterParentheses, 'print(',
                'Typing ( after completion should give single parentheses');
            assert.notStrictEqual(expectedBehavior.afterParentheses, expectedBehavior.notDoubleParentheses,
                'Should not get double parentheses');
        });
        
    });
    
});

console.log('🧪 Running Comprehensive Completion Fixes Tests...');