// Manual test file for digest module implementation
// Test completion, hover, and functionality for digest functions

// Test 1: Named imports
import { md5, sha1, sha256, md5_file, sha1_file, sha256_file } from 'digest';

let hash1 = md5("Hello World");
let hash2 = sha1("Test String");
let hash3 = sha256("Another Test");

let fileHash1 = md5_file("/etc/passwd");
let fileHash2 = sha1_file("/etc/hosts");
let fileHash3 = sha256_file("/tmp/testfile.txt");

// Test 2: Namespace import with completion
import * as digest from 'digest';

let namespaceHash1 = digest.md5("namespace test");
let namespaceHash2 = digest.sha256("another namespace test");
let namespaceFileHash = digest.md5_file("/path/to/file");

// Test autocomplete after typing: digest.
// Should show: md5, sha1, sha256, md5_file, sha1_file, sha256_file, md2, md4, sha384, sha512, md2_file, md4_file, sha384_file, sha512_file

// Test 3: Extended digest functions (may not be available on all systems)
import { md2, md4, sha384, sha512 } from 'digest';

let extendedHash1 = md2("extended test");
let extendedHash2 = md4("another extended test");
let extendedHash3 = sha384("sha384 test");
let extendedHash4 = sha512("sha512 test");

// Test 4: Direct function calls (builtin functions)
let directHash1 = md5("direct call test");
let directHash2 = sha1("another direct test");
let directFileHash = sha256_file("/direct/file/path");

// Test 5: Mixed usage
function calculateHashes(data, filePath) {
    return {
        md5Hash: md5(data),
        sha1Hash: sha1(data),
        sha256Hash: sha256(data),
        fileHash: md5_file(filePath)
    };
}

// Test hover information by placing cursor over:
// - md5 (should show function signature and documentation)
// - digest (namespace identifier - should show module documentation)
// - sha256_file (should show file hashing function info)

print("Testing digest module implementation");