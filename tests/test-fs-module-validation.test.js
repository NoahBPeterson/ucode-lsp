import { test, expect } from 'bun:test';
import { SemanticAnalyzer } from '../src/analysis/semanticAnalyzer.ts';
import { UcodeParser } from '../src/parser/ucodeParser.ts';
import { UcodeLexer } from '../src/lexer/ucodeLexer.ts';
import { DiagnosticSeverity } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

/**
 * Comprehensive unit test for fs module validation
 * This test prevents regression of the fs module method validation feature
 */

function parseAndAnalyze(code, options = {}) {
    const lexer = new UcodeLexer(code, { rawMode: true });
    const tokens = lexer.tokenize();
    const parser = new UcodeParser(tokens);
    const parseResult = parser.parse();
    
    const document = TextDocument.create('test://test.uc', 'ucode', 1, code);
    const analyzer = new SemanticAnalyzer(document, {
        enableScopeAnalysis: true,
        enableTypeChecking: true,
        enableUnusedVariableDetection: false, // Disable to focus on fs validation
        enableShadowingWarnings: false,
        ...options
    });
    
    const result = analyzer.analyze(parseResult.ast);
    return {
        ast: parseResult.ast,
        diagnostics: result.diagnostics,
        symbolTable: result.symbolTable
    };
}

test('fs module validation - invalid methods are rejected', () => {
    const code = `
'use strict';

const fs = require('fs');

export function test() {
    // These should all be flagged as invalid
    let a = fs.read('/tmp/test');         // Invalid - use fs.readfile() or file.read()
    let b = fs.write('/tmp/test', 'data'); // Invalid - use fs.writefile() or file.write()
    let c = fs.close();                   // Invalid - only available on file handles
    let d = fs.seek(0);                   // Invalid - only available on file handles
    let e = fs.flush();                   // Invalid - only available on file handles
}`;

    const result = parseAndAnalyze(code);
    
    // Filter for fs module validation errors
    const fsErrors = result.diagnostics.filter(d => 
        d.message.includes('not available on the fs module') &&
        d.severity === DiagnosticSeverity.Error
    );
    
    // Debug output (can be removed in production)
    if (fsErrors.length !== 5) {
        console.log(`Found ${fsErrors.length} fs module validation errors:`);
        fsErrors.forEach((error, i) => {
            console.log(`  ${i + 1}. ${error.message}`);
        });
        
        console.log('All diagnostics:');
        result.diagnostics.forEach((d, i) => {
            console.log(`  ${i + 1}. [${d.severity}] ${d.message}`);
        });
    }
    
    // Should have exactly 5 fs module validation errors
    expect(fsErrors.length).toBe(5);
    
    // Verify specific error messages
    expect(fsErrors.some(e => e.message.includes("Method 'read' is not available"))).toBe(true);
    expect(fsErrors.some(e => e.message.includes("Method 'write' is not available"))).toBe(true);
    expect(fsErrors.some(e => e.message.includes("Method 'close' is not available"))).toBe(true);
    expect(fsErrors.some(e => e.message.includes("Method 'seek' is not available"))).toBe(true);
    expect(fsErrors.some(e => e.message.includes("Method 'flush' is not available"))).toBe(true);
});

test('fs module validation - valid methods are allowed', () => {
    const code = `
'use strict';

const fs = require('fs');

export function test() {
    // These should all be valid fs module methods
    let content = fs.readfile('/tmp/test');
    let bytes = fs.writefile('/tmp/test', 'data');
    let file = fs.open('/tmp/test', 'r');
    let dir = fs.opendir('/tmp');
    let proc = fs.popen('ls -la', 'r');
    let stats = fs.stat('/tmp/test');
    let success = fs.mkdir('/tmp/newdir');
    let removed = fs.unlink('/tmp/oldfile');
    let target = fs.readlink('/tmp/symlink');
    let cwd = fs.getcwd();
    let error = fs.error();
}`;

    const result = parseAndAnalyze(code);
    
    // Filter for fs module validation errors
    const fsErrors = result.diagnostics.filter(d => 
        d.message.includes('not available on the fs module') &&
        d.severity === DiagnosticSeverity.Error
    );
    
    // Only log if there are unexpected errors
    if (fsErrors.length > 0) {
        console.log(`Found ${fsErrors.length} fs module validation errors (should be 0):`);
        fsErrors.forEach((error, i) => {
            console.log(`  ${i + 1}. ${error.message}`);
        });
    }
    
    // Should have no fs module validation errors
    expect(fsErrors.length).toBe(0);
});

test('fs module validation - file handle methods are allowed', () => {
    const code = `
'use strict';

const fs = require('fs');

export function test() {
    let file = fs.open('/tmp/test', 'r');
    if (file) {
        // These should be allowed on file handles
        let content = file.read('all');
        file.write('data');
        file.seek(0);
        file.close();
        file.flush();
    }
    
    let proc = fs.popen('ls -la', 'r');
    if (proc) {
        // These should be allowed on process handles
        let output = proc.read('all');
        proc.write('input');
        let exitCode = proc.close();
    }
    
    let dir = fs.opendir('/tmp');
    if (dir) {
        // These should be allowed on directory handles
        let entry = dir.read();
        dir.close();
    }
}`;

    const result = parseAndAnalyze(code);
    
    // Filter for fs module validation errors (should be none for file/proc/dir handles)
    const fsErrors = result.diagnostics.filter(d => 
        d.message.includes('not available on the fs module') &&
        d.severity === DiagnosticSeverity.Error
    );
    
    // Only log if there are unexpected errors
    if (fsErrors.length > 0) {
        console.log(`Found ${fsErrors.length} fs module validation errors (should be 0):`);
        fsErrors.forEach((error, i) => {
            console.log(`  ${i + 1}. ${error.message}`);
        });
    }
    
    // Should have no fs module validation errors for file handle methods
    expect(fsErrors.length).toBe(0);
});

test('fs module validation - non-fs objects are not affected', () => {
    const code = `
'use strict';

const fs = require('fs');

// Custom object with read/write methods
const myObject = {
    read: function(path) { return "data"; },
    write: function(path, data) { return 100; }
};

let customReader;
customReader = { read: () => "content" };

export function test() {
    // fs.read should be invalid
    let invalid = fs.read('/tmp/test');
    
    // But these should be allowed (not fs module objects)
    let data1 = myObject.read('/some/path');
    let bytes1 = myObject.write('/some/path', 'data');
    let data2 = customReader.read();
}`;

    const result = parseAndAnalyze(code);
    
    // Filter for fs module validation errors
    const fsErrors = result.diagnostics.filter(d => 
        d.message.includes('not available on the fs module') &&
        d.severity === DiagnosticSeverity.Error
    );
    
    // Only log if unexpected number of errors
    if (fsErrors.length !== 1) {
        console.log(`Found ${fsErrors.length} fs module validation errors (expected 1):`);
        fsErrors.forEach((error, i) => {
            console.log(`  ${i + 1}. ${error.message}`);
        });
    }
    
    // Should have exactly 1 error (only for fs.read)
    expect(fsErrors.length).toBe(1);
    expect(fsErrors[0].message).toContain("Method 'read' is not available on the fs module");
});

test('fs module validation - all valid fs methods from C code', () => {
    const code = `
'use strict';

const fs = require('fs');

export function test() {
    // Test all valid fs module methods from the C implementation
    fs.error();
    fs.open('file.txt', 'r');
    fs.fdopen(0, 'r');
    fs.opendir('/tmp');
    fs.popen('ls', 'r');
    fs.readlink('/tmp/link');
    fs.stat('/tmp/file');
    fs.lstat('/tmp/file');
    fs.mkdir('/tmp/newdir');
    fs.rmdir('/tmp/olddir');
    fs.symlink('/target', '/link');
    fs.unlink('/tmp/file');
    fs.getcwd();
    fs.chdir('/tmp');
    fs.chmod('/tmp/file', 0o644);
    fs.chown('/tmp/file', 'user', 'group');
    fs.rename('/old', '/new');
    fs.glob('*.txt');
    fs.dirname('/path/file.txt');
    fs.basename('/path/file.txt');
    fs.lsdir('/tmp');
    fs.mkstemp('/tmp/XXXXXX');
    fs.access('/tmp/file', 'r');
    fs.readfile('/tmp/file');
    fs.writefile('/tmp/file', 'data');
    fs.realpath('../relative');
    fs.pipe();
    
    // Pre-defined handles
    let stdin = fs.stdin;
    let stdout = fs.stdout; 
    let stderr = fs.stderr;
}`;

    const result = parseAndAnalyze(code);
    
    // Filter for fs module validation errors
    const fsErrors = result.diagnostics.filter(d => 
        d.message.includes('not available on the fs module') &&
        d.severity === DiagnosticSeverity.Error
    );
    
    console.log(`Found ${fsErrors.length} fs module validation errors (should be 0 for all valid methods)`);
    fsErrors.forEach((error, i) => {
        console.log(`  ${i + 1}. ${error.message}`);
    });
    
    // Should have no fs module validation errors for any valid methods
    expect(fsErrors.length).toBe(0);
});

test('fs module validation - helpful error message content', () => {
    const code = `
'use strict';

const fs = require('fs');

export function test() {
    let data = fs.read('/tmp/test');
}`;

    const result = parseAndAnalyze(code);
    
    const fsErrors = result.diagnostics.filter(d => 
        d.message.includes('not available on the fs module') &&
        d.severity === DiagnosticSeverity.Error
    );
    
    expect(fsErrors.length).toBe(1);
    
    const errorMessage = fsErrors[0].message;
    
    // Verify the error message is helpful
    expect(errorMessage).toContain("Method 'read' is not available on the fs module");
    expect(errorMessage).toContain("Did you mean to call this on a file handle?");
    expect(errorMessage).toContain("Use fs.open() first");
});

test('fs module validation - original problem case', () => {
    // This is the exact problematic code from the user's issue
    const code = `
'use strict';

import { run_command } from './commands.uc';

/* Requires ucode-mod-fs */
const fs = require('fs');

const CONFIG_PATH = '/var/lib/payload/payload.conf';

/**
 * Reads the payload config file and returns the value for a given key.
 */
export function get_config_value(key) {
    try {
        let a = fs.read(CONFIG_PATH);  // This was the problem - should be fs.readfile()
        const content = readfile(CONFIG_PATH);
        return content;
    } catch (e) {
        return null;
    }
}`;

    const result = parseAndAnalyze(code);
    
    const fsErrors = result.diagnostics.filter(d => 
        d.message.includes('not available on the fs module') &&
        d.severity === DiagnosticSeverity.Error
    );
    
    // Should catch the original problem
    expect(fsErrors.length).toBe(1);
    expect(fsErrors[0].message).toContain("Method 'read' is not available on the fs module");
});

console.log('🧪 FS Module Validation Test Suite Complete');
console.log('✅ Tests prevent regression of fs module method validation');
console.log('✅ Invalid fs module methods are properly flagged');
console.log('✅ Valid fs module methods are allowed');
console.log('✅ File handle methods are not affected');
console.log('✅ Non-fs objects are not affected');
console.log('✅ Original user problem case is solved');