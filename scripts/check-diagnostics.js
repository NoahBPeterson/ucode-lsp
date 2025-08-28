#!/usr/bin/env node

// Script to analyze diagnostic usage across the source codebase
const fs = require('fs');
const path = require('path');

// Function to find all TypeScript source files (excluding compiled output)
function findSourceFiles(dir) {
    const files = [];
    const items = fs.readdirSync(dir);
    
    for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);
        
        // Skip compiled output directories
        if (fullPath.includes('node_modules') || 
            fullPath.includes('.git') || 
            fullPath.includes('dist') || 
            fullPath.includes('out') ||
            fullPath.includes('.vscode')) {
            continue;
        }
        
        if (stat.isDirectory()) {
            files.push(...findSourceFiles(fullPath));
        } else if (stat.isFile() && item.endsWith('.ts') && !item.includes('.d.ts')) {
            files.push(fullPath);
        }
    }
    
    return files;
}

// Function to extract diagnostic calls from a file
function extractDiagnosticCalls(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const diagnosticCalls = [];
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Look for addDiagnostic calls
        if (line.includes('this.addDiagnostic(')) {
            // Get context (few lines before and after)
            const contextStart = Math.max(0, i - 3);
            const contextEnd = Math.min(lines.length - 1, i + 3);
            const context = lines.slice(contextStart, contextEnd + 1);
            
            diagnosticCalls.push({
                file: filePath.replace(process.cwd() + '/', ''),
                line: i + 1,
                code: line.trim(),
                context: context.map((l, idx) => `${contextStart + idx + 1}: ${l}`).join('\n'),
                type: 'addDiagnostic'
            });
        }
        
        // Look for diagnostics.push calls (common in validation files)
        if (line.includes('diagnostics.push(')) {
            // Get context (few lines before and after)
            const contextStart = Math.max(0, i - 3);
            const contextEnd = Math.min(lines.length - 1, i + 3);
            const context = lines.slice(contextStart, contextEnd + 1);
            
            diagnosticCalls.push({
                file: filePath.replace(process.cwd() + '/', ''),
                line: i + 1,
                code: line.trim(),
                context: context.map((l, idx) => `${contextStart + idx + 1}: ${l}`).join('\n'),
                type: 'diagnostics.push'
            });
        }
    }
    
    return diagnosticCalls;
}

// Find all source files
console.log('🔍 Searching for TypeScript source files...');
const sourceFiles = findSourceFiles(process.cwd());
console.log(`Found ${sourceFiles.length} TypeScript source files`);

// Extract diagnostic calls from all files
console.log('🔍 Analyzing files for diagnostic creation patterns...');
const allDiagnosticCalls = [];
const filesWithDiagnostics = [];

for (const file of sourceFiles) {
    try {
        const calls = extractDiagnosticCalls(file);
        if (calls.length > 0) {
            allDiagnosticCalls.push(...calls);
            filesWithDiagnostics.push({
                file: file.replace(process.cwd() + '/', ''),
                count: calls.length
            });
        }
    } catch (error) {
        // Skip files that can't be read
    }
}

console.log(`\n📊 Found ${allDiagnosticCalls.length} diagnostic creation calls across ${filesWithDiagnostics.length} files`);

// Show files with the most diagnostics
console.log('\n📁 Files with diagnostic creation calls:');
filesWithDiagnostics
    .sort((a, b) => b.count - a.count)
    .slice(0, 15) // Show top 15
    .forEach((file, index) => {
        console.log(`${index + 1}. ${file.file}: ${file.count} calls`);
    });

// Categorize by error code usage and type
const withErrorCodes = [];
const withoutErrorCodes = [];
const addDiagnosticCalls = [];
const diagnosticsPushCalls = [];

allDiagnosticCalls.forEach(call => {
    if (call.type === 'addDiagnostic') {
        addDiagnosticCalls.push(call);
        // Check the context for UcodeErrorCode
        const contextLines = call.context.split('\n');
        let hasErrorCode = false;
        
        for (const line of contextLines) {
            if (line.includes('UcodeErrorCode.')) {
                hasErrorCode = true;
                break;
            }
        }
        
        if (hasErrorCode) {
            withErrorCodes.push(call);
        } else {
            withoutErrorCodes.push(call);
        }
    } else if (call.type === 'diagnostics.push') {
        diagnosticsPushCalls.push(call);
        // diagnostics.push calls don't use error codes in the same way
        withoutErrorCodes.push(call);
    }
});

console.log(`\n📈 Diagnostic Creation Patterns:`);
console.log(`  this.addDiagnostic calls: ${addDiagnosticCalls.length}`);
console.log(`  diagnostics.push calls: ${diagnosticsPushCalls.length}`);

console.log(`\n✅ Using error codes: ${withErrorCodes.length}`);
console.log(`❌ Not using error codes: ${withoutErrorCodes.length}`);

if (addDiagnosticCalls.length > 0) {
    console.log(`\nProgress: ${Math.round((withErrorCodes.length / addDiagnosticCalls.length) * 100)}% of addDiagnostic calls`);
}

if (withoutErrorCodes.length > 0) {
    console.log('\n--- Diagnostics without error codes ---');
    withoutErrorCodes.slice(0, 15).forEach((call, index) => {
        // Extract a short message description from the context
        const contextLines = call.context.split('\n');
        let messageDesc = '<complex message>';
        
        for (const line of contextLines) {
            if (line.includes('addDiagnostic(') || line.includes('diagnostics.push(')) {
                const messageMatch = line.match(/["`](.*?)["`]/);
                if (messageMatch) {
                    messageDesc = messageMatch[1].substring(0, 60) + (messageMatch[1].length > 60 ? '...' : '');
                    break;
                }
            }
        }
        
        console.log(`\n${index + 1}. ${call.file}:${call.line} [${call.type}]: ${messageDesc}`);
    });
    
    if (withoutErrorCodes.length > 15) {
        console.log(`\n... and ${withoutErrorCodes.length - 15} more`);
    }
}

if (withErrorCodes.length > 0) {
    console.log('\n--- Diagnostics with error codes ---');
    withErrorCodes.forEach((call, index) => {
        // Extract the error code from context
        const contextLines = call.context.split('\n');
        let errorCode = 'Unknown';
        
        for (const line of contextLines) {
            const codeMatch = line.match(/UcodeErrorCode\.([A-Z_]+)/);
            if (codeMatch) {
                errorCode = codeMatch[1];
                break;
            }
        }
        
        console.log(`\n${index + 1}. ${call.file}:${call.line} [${call.type}]: ${errorCode}`);
    });
}

// Summary
console.log('\n--- Summary ---');
console.log(`Total diagnostic creation calls found: ${allDiagnosticCalls.length}`);
console.log(`  - addDiagnostic calls: ${addDiagnosticCalls.length}`);
console.log(`  - diagnostics.push calls: ${diagnosticsPushCalls.length}`);
console.log(`Using error codes: ${withErrorCodes.length}`);
console.log(`Need conversion: ${withoutErrorCodes.length}`);

if (addDiagnosticCalls.length > 0) {
    console.log(`Progress: ${Math.round((withErrorCodes.length / (allDiagnosticCalls.length)) * 100)}% of diagnostic calls converted`);
}

console.log('\n💡 Next steps:');
console.log('1. Convert addDiagnostic calls to use UcodeErrorCode constants');
console.log('2. Add new error codes to src/analysis/errorConstants.ts as needed');
console.log('3. Consider refactoring diagnostics.push patterns to use centralized error handling');
console.log('4. Run this script again to track progress');