// Direct parser test using TypeScript compilation on-the-fly
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

async function testParserDirectly() {
    console.log('🚀 Direct AST Parser Test');
    console.log('==========================');
    
    // Test files to parse
    const testFiles = [
        'test-valid.uc',
        'test-syntax-errors.uc',
        'test-complex.uc'
    ];
    
    for (const file of testFiles) {
        console.log(`\n=== Testing ${file} ===`);
        
        try {
            const content = fs.readFileSync(file, 'utf8');
            console.log(`File size: ${content.length} characters`);
            
            // Create a test script that imports our TypeScript modules
            const testScript = `
const fs = require('fs');

// Mock TextDocument for testing
class MockTextDocument {
    constructor(content) {
        this.content = content;
    }
    
    getText() {
        return this.content;
    }
    
    positionAt(offset) {
        const lines = this.content.slice(0, offset).split('\\n');
        return {
            line: lines.length - 1,
            character: lines[lines.length - 1].length
        };
    }
}

// Mock connection for testing
const mockConnection = {
    console: {
        log: (msg) => console.log('[LSP]', msg),
        warn: (msg) => console.warn('[LSP]', msg),
        error: (msg) => console.error('[LSP]', msg)
    }
};

// Import and test
const { validateDocument, createValidationConfig } = require('./out/validations/hybrid-validator.js');

const content = fs.readFileSync('${file}', 'utf8');
const document = new MockTextDocument(content);
const config = createValidationConfig('ast-basic');

console.log('Testing with AST parser...');
const startTime = Date.now();

try {
    const diagnostics = validateDocument(document, mockConnection, {
        ...config,
        enablePerformanceLogging: true
    });
    
    const parseTime = Date.now() - startTime;
    
    console.log(\`Parse time: \${parseTime}ms\`);
    console.log(\`Diagnostics found: \${diagnostics.length}\`);
    
    if (diagnostics.length > 0) {
        console.log('Diagnostics:');
        diagnostics.slice(0, 10).forEach((diag, i) => {
            console.log(\`  \${i + 1}. [\${diag.severity === 1 ? 'ERROR' : 'WARNING'}] \${diag.message}\`);
        });
        if (diagnostics.length > 10) {
            console.log(\`  ... and \${diagnostics.length - 10} more\`);
        }
    }
    
    console.log('✅ Parse completed successfully');
    
} catch (error) {
    console.error('❌ Parse failed:', error.message);
}
`;
            
            // Write the test script
            fs.writeFileSync('temp-test.js', testScript);
            
            // Run the test
            try {
                const output = execSync('node temp-test.js', { 
                    encoding: 'utf8',
                    timeout: 10000 
                });
                console.log(output);
            } catch (error) {
                console.error('Test execution failed:', error.message);
                if (error.stdout) console.log('STDOUT:', error.stdout);
                if (error.stderr) console.log('STDERR:', error.stderr);
            }
            
        } catch (error) {
            console.error(`Failed to test ${file}:`, error.message);
        }
    }
    
    // Cleanup
    try {
        fs.unlinkSync('temp-test.js');
    } catch (e) {
        // Ignore cleanup errors
    }
    
    console.log('\n🎯 Direct parser test complete!');
}

testParserDirectly().catch(console.error);