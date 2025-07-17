// Integration test for fs module completion functionality
// This test verifies that the completion provider works end-to-end

// Mock dependencies
const mockDocument = {
    getText: () => "const fs = require('fs');\nfs.",
    offsetAt: (position) => {
        // Simulate VS Code position to offset conversion
        if (position.line === 1 && position.character === 3) {
            return 29; // Right after "fs."
        }
        return 0;
    }
};

const mockDocuments = {
    get: (uri) => mockDocument
};

const mockConnection = {
    console: {
        log: (message) => console.log(`[LSP] ${message}`)
    }
};

// Mock analysis result with fs module symbol
const mockAnalysisResult = {
    symbolTable: {
        lookup: (name) => {
            if (name === 'fs') {
                return {
                    name: 'fs',
                    type: 'module', // SymbolType.MODULE
                    dataType: {
                        type: 'object',
                        moduleName: 'fs'
                    }
                };
            }
            return null;
        }
    }
};

// Import the actual completion handler
import { handleCompletion } from '../src/completion';

console.log('🧪 Testing FS Completion Integration...\\n');

// Test completion at "fs." position
const testParams = {
    textDocument: { uri: 'file:///test.uc' },
    position: { line: 1, character: 3 } // Right after "fs."
};

console.log('📋 Test scenario: User types "fs." and requests completion');
console.log('Expected: Should return fs module method completions');

try {
    const completions = handleCompletion(
        testParams,
        mockDocuments,
        mockConnection,
        mockAnalysisResult
    );
    
    console.log(`\\n📊 Completion Results:`);
    console.log(`- Total completions: ${completions ? completions.length : 0}`);
    
    if (completions && completions.length > 0) {
        console.log(`- Sample completions:`);
        
        // Check for expected fs methods
        const expectedMethods = ['open', 'readfile', 'mkdir', 'stat', 'error'];
        let foundMethods = 0;
        
        completions.slice(0, 10).forEach((item, index) => {
            console.log(`  [${index + 1}] ${item.label} (${item.kind}) - ${item.detail}`);
            
            if (expectedMethods.includes(item.label)) {
                foundMethods++;
            }
        });
        
        console.log(`\\n✅ Found ${foundMethods}/${expectedMethods.length} expected fs methods`);
        
        // Check for proper completion item structure
        const firstCompletion = completions[0];
        const hasProperStructure = firstCompletion.label && 
                                  firstCompletion.kind && 
                                  firstCompletion.documentation &&
                                  firstCompletion.insertText;
        
        console.log(`✅ Completion items have proper structure: ${hasProperStructure}`);
        
        // Check if methods have snippet format
        const hasSnippets = completions.some(item => 
            item.insertText && item.insertText.includes('($1)')
        );
        
        console.log(`✅ Methods include snippet format: ${hasSnippets}`);
        
        if (foundMethods >= 3 && hasProperStructure && hasSnippets) {
            console.log('\\n🎉 FS completion integration test PASSED!');
            console.log('✅ fs module methods are properly provided in autocomplete');
            console.log('✅ Completion items have rich documentation');
            console.log('✅ Methods are formatted as snippets for better UX');
        } else {
            console.log('\\n❌ FS completion integration test FAILED!');
            console.log('- Check completion detection logic');
            console.log('- Verify fs module symbol recognition');
            console.log('- Ensure completion item formatting');
        }
        
    } else {
        console.log('\\n❌ No completions returned!');
        console.log('- Check member expression detection');
        console.log('- Verify fs module symbol lookup');
        console.log('- Check completion provider logic');
    }
    
} catch (error) {
    console.log(`\\n❌ Error during completion test: ${error.message}`);
    console.log('- Check import paths and dependencies');
    console.log('- Verify mock setup');
}

console.log('\\n💡 This test verifies end-to-end completion functionality.');
console.log('💡 In VS Code, users should see rich autocomplete when typing "fs."');