// Variable-to-variable equality narrowing
// Expected: 0 diagnostics

import { readfile as rf } from 'fs';

// Pattern 1: if (x != y) return; → x narrowed after early exit
function test_inequality_early_exit(_fs) {
    let readfile = _fs.readfile;

    if (readfile != rf)
        return;

    // After early return, readfile == rf, so readfile should have rf's type (function)
    let d = readfile;
    print(d);
}

// Pattern 2: if (x == y) { ... } → x narrowed inside if body
function test_equality_inside_if(_fs) {
    let readfile = _fs.readfile;

    if (readfile == rf) {
        // Inside: readfile == rf, so readfile should have rf's type
        let d = readfile;
        print(d);
    }
}

// Pattern 3: === and !== strict equality
function test_strict_equality(_fs) {
    let readfile = _fs.readfile;

    if (readfile !== rf)
        return;

    let d = readfile;
    print(d);
}

print(test_inequality_early_exit, test_equality_inside_if, test_strict_equality);
