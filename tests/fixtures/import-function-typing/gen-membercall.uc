'use strict';
import * as fs from 'fs';

// Return is `p.read("all")` — a CallExpression on a MemberExpression callee.
// inferNodeType can't trace this, but the function is still a function.
export function gen_membercall() {
    let p = fs.popen("cmd");
    return p.read("all");
}
