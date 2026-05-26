'use strict';
import * as fs from 'fs';

// Bodies where inferFunctionReturnType returns null. The export is still a
// function; that's what 0.6.79 makes sure shows up in hover.
export function gen_chained() {
    return fs.popen("cmd").read("all");  // chained call — opaque to inferNodeType
}

export function gen_methodlet() {
    let p = fs.popen("cmd");
    return p.read("all");  // p.read — opaque to inferNodeType
}
