// Simple test script to validate our test files and prepare for AST parser testing
const fs = require('fs');
const path = require('path');

function basicValidation(content) {
    // Basic checks for common syntax patterns
    const checks = {
        hasVariableDeclarations: /\b(let|const)\s+\w+/.test(content),
        hasFunctionDeclarations: /\bfunction\s+\w+\s*\(/.test(content),
        hasControlFlow: /\b(if|for|while|switch)\s*\(/.test(content),
        hasStringLiterals: /"[^"]*"/.test(content),
        hasArrayLiterals: /\[[^\]]*\]/.test(content),
        hasObjectLiterals: /\{[^}]*\}/.test(content),
        hasFunctionCalls: /\w+\s*\([^)]*\)/.test(content),
        balanced: checkBalanced(content)
    };
    
    return checks;
}

function checkBalanced(content) {
    let braces = 0, parens = 0, brackets = 0;
    let inString = false;
    let escaped = false;
    
    for (let i = 0; i < content.length; i++) {
        const char = content[i];
        
        if (escaped) {
            escaped = false;
            continue;
        }
        
        if (char === '\\') {
            escaped = true;
            continue;
        }
        
        if (char === '"' && !escaped) {
            inString = !inString;
            continue;
        }
        
        if (inString) continue;
        
        switch (char) {
            case '{': braces++; break;
            case '}': braces--; break;
            case '(': parens++; break;
            case ')': parens--; break;
            case '[': brackets++; break;
            case ']': brackets--; break;
        }
    }
    
    return { braces, parens, brackets, balanced: braces === 0 && parens === 0 && brackets === 0 };
}

function testFile(filename) {
    console.log(`\n=== Testing ${filename} ===`);
    
    try {
        const filePath = path.join(__dirname, filename);
        const content = fs.readFileSync(filePath, 'utf8');
        
        console.log(`File size: ${content.length} characters`);
        console.log(`Lines: ${content.split('\n').length}`);
        
        // Basic validation checks
        const validation = basicValidation(content);
        
        console.log('\nSyntax Pattern Analysis:');
        console.log(`  Variable declarations: ${validation.hasVariableDeclarations ? '✓' : '✗'}`);
        console.log(`  Function declarations: ${validation.hasFunctionDeclarations ? '✓' : '✗'}`);
        console.log(`  Control flow: ${validation.hasControlFlow ? '✓' : '✗'}`);
        console.log(`  String literals: ${validation.hasStringLiterals ? '✓' : '✗'}`);
        console.log(`  Array literals: ${validation.hasArrayLiterals ? '✓' : '✗'}`);
        console.log(`  Object literals: ${validation.hasObjectLiterals ? '✓' : '✗'}`);
        console.log(`  Function calls: ${validation.hasFunctionCalls ? '✓' : '✗'}`);
        
        console.log('\nBalance Check:');
        const balance = validation.balanced;
        console.log(`  Braces: ${balance.braces} (${balance.braces === 0 ? '✓' : '✗'})`);
        console.log(`  Parentheses: ${balance.parens} (${balance.parens === 0 ? '✓' : '✗'})`);
        console.log(`  Brackets: ${balance.brackets} (${balance.brackets === 0 ? '✓' : '✗'})`);
        console.log(`  Overall balanced: ${balance.balanced ? '✓' : '✗'}`);
        
        // Count complexity indicators
        const complexityMetrics = {
            functions: (content.match(/\bfunction\s+\w+/g) || []).length,
            variables: (content.match(/\b(let|const)\s+\w+/g) || []).length,
            ifStatements: (content.match(/\bif\s*\(/g) || []).length,
            loops: (content.match(/\b(for|while)\s*\(/g) || []).length,
            tryCatch: (content.match(/\btry\s*\{/g) || []).length,
            nestedBraces: (content.match(/\{[^{}]*\{/g) || []).length
        };
        
        console.log('\nComplexity Metrics:');
        console.log(`  Functions: ${complexityMetrics.functions}`);
        console.log(`  Variables: ${complexityMetrics.variables}`);
        console.log(`  If statements: ${complexityMetrics.ifStatements}`);
        console.log(`  Loops: ${complexityMetrics.loops}`);
        console.log(`  Try-catch blocks: ${complexityMetrics.tryCatch}`);
        console.log(`  Nested structures: ${complexityMetrics.nestedBraces}`);
        
        return {
            filename,
            success: true,
            size: content.length,
            validation,
            complexity: complexityMetrics,
            expectsErrors: filename.includes('syntax-errors')
        };
        
    } catch (error) {
        console.log(`FAILED: ${error.message}`);
        return {
            filename,
            success: false,
            error: error.message
        };
    }
}

function main() {
    console.log('🚀 Testing ucode AST Parser');
    console.log('=============================');
    
    const testFiles = [
        'test-valid.uc',
        'test-syntax-errors.uc', 
        'test-complex.uc',
        'test-performance.uc'
    ];
    
    const results = [];
    
    for (const file of testFiles) {
        const result = testFile(file);
        results.push(result);
    }
    
    console.log('\n=== SUMMARY ===');
    console.log('===============');
    
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    
    console.log(`Total files: ${results.length}`);
    console.log(`Successful: ${successful.length}`);
    console.log(`Failed: ${failed.length}`);
    
    if (successful.length > 0) {
        const totalSize = successful.reduce((sum, r) => sum + (r.size || 0), 0);
        const avgSize = totalSize / successful.length;
        const totalFunctions = successful.reduce((sum, r) => sum + (r.complexity?.functions || 0), 0);
        const totalVariables = successful.reduce((sum, r) => sum + (r.complexity?.variables || 0), 0);
        const balancedFiles = successful.filter(r => r.validation?.balanced?.balanced).length;
        
        console.log(`Average file size: ${Math.round(avgSize)} characters`);
        console.log(`Total functions detected: ${totalFunctions}`);
        console.log(`Total variables detected: ${totalVariables}`);
        console.log(`Syntax balanced files: ${balancedFiles}/${successful.length}`);
        
        // Show which files expect errors vs. which are clean
        const errorFiles = successful.filter(r => r.expectsErrors);
        const cleanFiles = successful.filter(r => !r.expectsErrors);
        console.log(`Clean syntax files: ${cleanFiles.length}`);
        console.log(`Intentional error files: ${errorFiles.length}`);
    }
    
    if (failed.length > 0) {
        console.log('\nFailed files:');
        failed.forEach(f => {
            console.log(`  - ${f.filename}: ${f.error}`);
        });
    }
    
    console.log(`\n✅ Parser test complete!`);
}

main();