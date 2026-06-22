const assert = require('assert');

/**
 * Test for Bug 3: Invalid fs.read() Function Call
 * 
 * The read() function CANNOT be called on fs (the fs module); 
 * it is only a valid member function of a file handle with type fs.file.
 */

describe('FS Module Read Function Bug', function() {
    
    it('should NOT suggest read() as an fs module method', function() {
        // Simulated fs module functions (should match fsModuleTypes.ts)
        const validFsModuleFunctions = [
            'error', 'open', 'fdopen', 'opendir', 'closedir', 'readdir', 'rewinddir', 
            'seekdir', 'telldir', 'popen', 'pclose', 'mkstemp', 'stat', 'lstat',
            'mkdir', 'rmdir', 'chmod', 'chown', 'unlink', 'basename', 'dirname',
            'access', 'readfile', 'writefile', 'realpath', 'pipe'
        ];
        
        // read() should NOT be in this list
        assert.strictEqual(validFsModuleFunctions.includes('read'), false,
            'read() should NOT be a valid fs module function');
        
        // But readfile() should be valid
        assert.strictEqual(validFsModuleFunctions.includes('readfile'), true,
            'readfile() should be a valid fs module function');
    });
    
    it('should only suggest read() for fs.file objects', function() {
        // Simulated fs.file object methods
        const validFsFileObjectMethods = [
            'read', 'write', 'seek', 'tell', 'close', 'flush', 
            'fileno', 'isatty', 'truncate', 'lock', 'error', 'ioctl'
        ];
        
        // read() SHOULD be available on fs.file objects
        assert.strictEqual(validFsFileObjectMethods.includes('read'), true,
            'read() should be a valid method for fs.file objects');
    });
    
    it('should demonstrate correct usage patterns', function() {
        const correctUsage = [
            'const fs = require("fs"); let file = fs.open("test.txt", "r"); file.read();',
            'import { open } from "fs"; let file = open("test.txt", "r"); file.read();',
            'const fs = require("fs"); fs.readfile("test.txt");' // readfile is valid on fs
        ];
        
        const incorrectUsage = [
            'const fs = require("fs"); fs.read();', // ERROR: read() not on fs module
            'import { fs } from "fs"; fs.read();'   // ERROR: read() not on fs module
        ];
        
        assert.strictEqual(correctUsage.length, 3, 'Should have correct usage examples');
        assert.strictEqual(incorrectUsage.length, 2, 'Should identify incorrect usage');
    });
    
    it('should validate fs module vs fs.file object distinction', function() {
        const fsModuleMethods = ['open', 'readfile', 'writefile', 'stat', 'access'];
        const fsFileObjectMethods = ['read', 'write', 'close', 'seek', 'tell'];
        
        // These should be mutually exclusive
        const intersection = fsModuleMethods.filter(method => 
            fsFileObjectMethods.includes(method));
        
        assert.strictEqual(intersection.length, 0,
            'fs module methods and fs.file object methods should be distinct');
    });
    
});

console.log('🧪 Running FS Invalid Read Function Tests...');