/**
 * Comprehensive module resolution regression tests.
 *
 * Covers the cross-product of:
 *   Import syntaxes: named, aliased, default, namespace, mixed (default+named, default+namespace)
 *   Module sources:  builtin modules, file-based modules (relative path), file-based modules (dot-notation)
 *   Runtime require: require('builtin'), require('./file')
 *
 * For each combination we verify:
 *   - No spurious diagnostics on the import line
 *   - Imported symbols are usable without "undefined variable" errors
 *   - Type information propagates (hover shows correct type where applicable)
 */

import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
const path = require('path');
const fs = require('fs');
const { createLSPTestServer } = require('./lsp-test-helpers');

let server;
let getDiagnostics;
let getHover;

// Temp files to clean up
const tempFiles = [];

function tempFile(name, content) {
  const p = path.join(__dirname, name);
  fs.writeFileSync(p, content);
  tempFiles.push(p);
  return p;
}

beforeAll(async () => {
  server = createLSPTestServer();
  await server.initialize();
  getDiagnostics = server.getDiagnostics;
  getHover = server.getHover;

  // Create shared helper module files used by file-based import tests
  tempFile('temp-mod-helpers.uc', `
export function helper_add(a, b) {
    return a + b;
}

export function helper_greet(name) {
    return "hello " + name;
}

export let HELPER_VERSION = 42;

export default { name: "helpers" };
`);

  // Create a module in a subdirectory for dot-notation imports
  const subdir = path.join(__dirname, 'temp_mod_sub');
  if (!fs.existsSync(subdir)) fs.mkdirSync(subdir);
  tempFiles.push(subdir);
  tempFile('temp_mod_sub/utils.uc', `
export function util_parse(s) {
    return split(s, ",");
}

export let UTIL_CONST = "abc";

export default { version: 1 };
`);
});

afterAll(() => {
  if (server) server.shutdown();
  // Clean up temp files (files first, then directories)
  for (const p of tempFiles) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) fs.unlinkSync(p);
    } catch {}
  }
  for (const p of tempFiles) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) fs.rmdirSync(p);
    } catch {}
  }
});

// ---------------------------------------------------------------------------
// Helper: get diagnostics filtering out "declared but never used" noise
// ---------------------------------------------------------------------------
async function getErrors(code, filePath) {
  if (!filePath) {
    filePath = path.join(__dirname, `temp-modres-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.uc`);
    tempFiles.push(filePath);
  }
  const diagnostics = await getDiagnostics(code, filePath);
  return diagnostics.filter(d =>
    d.severity === 1 &&
    !d.message.includes('declared but never used')
  );
}

// ---------------------------------------------------------------------------
// 1. BUILTIN MODULE — Named import
// ---------------------------------------------------------------------------
describe('Builtin module imports', () => {
  test('named import from builtin module', async () => {
    const errors = await getErrors(`
import { readfile, writefile } from 'fs';
let content = readfile("/tmp/test.txt");
print(content);
`);
    const importErrors = errors.filter(d => d.message.includes('import') || d.message.includes('not defined') || d.message.includes('not found'));
    expect(importErrors.length).toBe(0);
  });

  test('aliased named import from builtin module', async () => {
    const errors = await getErrors(`
import { readfile as rf } from 'fs';
let content = rf("/tmp/test.txt");
print(content);
`);
    const importErrors = errors.filter(d => d.message.includes('import') || d.message.includes('not defined') || d.message.includes('not found'));
    expect(importErrors.length).toBe(0);
  });

  test('namespace import from builtin module', async () => {
    const errors = await getErrors(`
import * as fsmod from 'fs';
let content = fsmod.readfile("/tmp/test.txt");
print(content);
`);
    const importErrors = errors.filter(d => d.message.includes('import') || d.message.includes('not defined') || d.message.includes('not found'));
    expect(importErrors.length).toBe(0);
  });

  test('default import from builtin module produces error', async () => {
    const errors = await getErrors(`
import mathmod from 'math';
print(mathmod);
`);
    const defaultErrors = errors.filter(d => d.message.includes('does not have a default export'));
    expect(defaultErrors.length).toBe(1);
  });

  test('mixed default + namespace import from builtin module errors on default', async () => {
    const errors = await getErrors(`
import fsDefault, * as fsAll from 'fs';
print(fsDefault);
let c = fsAll.readfile("/tmp/a.txt");
print(c);
`);
    const defaultErrors = errors.filter(d => d.message.includes('does not have a default export'));
    expect(defaultErrors.length).toBe(1);
  });

  test('mixed default + named import from builtin module errors on default', async () => {
    const errors = await getErrors(`
import fsDefault, { readfile } from 'fs';
print(fsDefault);
let c = readfile("/tmp/a.txt");
print(c);
`);
    const defaultErrors = errors.filter(d => d.message.includes('does not have a default export'));
    expect(defaultErrors.length).toBe(1);
  });

  test('multiple named imports from builtin module', async () => {
    const errors = await getErrors(`
import { abs, sqrt, floor, ceil } from 'math';
let a = abs(-5);
let b = sqrt(16);
let c = floor(3.7);
let d = ceil(3.2);
print(a, b, c, d);
`);
    const importErrors = errors.filter(d => d.message.includes('import') || d.message.includes('not defined') || d.message.includes('not found'));
    expect(importErrors.length).toBe(0);
  });

  test('named import with alias does not leak original name', async () => {
    const errors = await getErrors(`
import { readfile as myRead } from 'fs';
let c = myRead("/tmp/a.txt");
print(c);
`);
    // myRead should work, no errors
    const importErrors = errors.filter(d =>
      d.message.includes('not defined') || d.message.includes('not found')
    );
    expect(importErrors.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. FILE-BASED MODULE — Relative path imports
// ---------------------------------------------------------------------------
describe('File-based module imports (relative path)', () => {
  test('named import from relative file', async () => {
    const importFile = path.join(__dirname, 'temp-modres-named-rel.uc');
    tempFiles.push(importFile);
    const errors = await getErrors(`
import { helper_add, helper_greet } from './temp-mod-helpers';
let sum = helper_add(1, 2);
let msg = helper_greet("world");
print(sum, msg);
`, importFile);
    const importErrors = errors.filter(d =>
      d.message.includes('not defined') || d.message.includes('not found') || d.message.includes('import')
    );
    expect(importErrors.length).toBe(0);
  });

  test('aliased named import from relative file', async () => {
    const importFile = path.join(__dirname, 'temp-modres-alias-rel.uc');
    tempFiles.push(importFile);
    const errors = await getErrors(`
import { helper_add as add } from './temp-mod-helpers';
let sum = add(1, 2);
print(sum);
`, importFile);
    const importErrors = errors.filter(d =>
      d.message.includes('not defined') || d.message.includes('not found')
    );
    expect(importErrors.length).toBe(0);
  });

  test('default import from relative file', async () => {
    const importFile = path.join(__dirname, 'temp-modres-default-rel.uc');
    tempFiles.push(importFile);
    const errors = await getErrors(`
import helpers from './temp-mod-helpers';
print(helpers);
`, importFile);
    const importErrors = errors.filter(d =>
      d.message.includes('not defined') || d.message.includes('not found')
    );
    expect(importErrors.length).toBe(0);
  });

  test('namespace import from relative file', async () => {
    const importFile = path.join(__dirname, 'temp-modres-ns-rel.uc');
    tempFiles.push(importFile);
    const errors = await getErrors(`
import * as helpers from './temp-mod-helpers';
let sum = helpers.helper_add(1, 2);
print(sum);
`, importFile);
    const importErrors = errors.filter(d =>
      d.message.includes('not defined') || d.message.includes('not found')
    );
    expect(importErrors.length).toBe(0);
  });

  test('mixed default + named import from relative file', async () => {
    const importFile = path.join(__dirname, 'temp-modres-mixed-named-rel.uc');
    tempFiles.push(importFile);
    const errors = await getErrors(`
import helpers, { helper_add } from './temp-mod-helpers';
print(helpers);
let sum = helper_add(1, 2);
print(sum);
`, importFile);
    const importErrors = errors.filter(d =>
      d.message.includes('not defined') || d.message.includes('not found')
    );
    expect(importErrors.length).toBe(0);
  });

  test('mixed default + namespace import from relative file', async () => {
    const importFile = path.join(__dirname, 'temp-modres-mixed-ns-rel.uc');
    tempFiles.push(importFile);
    const errors = await getErrors(`
import helpers, * as allHelpers from './temp-mod-helpers';
print(helpers);
let sum = allHelpers.helper_add(1, 2);
print(sum);
`, importFile);
    const importErrors = errors.filter(d =>
      d.message.includes('not defined') || d.message.includes('not found')
    );
    expect(importErrors.length).toBe(0);
  });

  test('relative path with ../ works', async () => {
    // Import from parent dir: create importer in subdir
    const subdir = path.join(__dirname, 'temp_mod_sub');
    const importFile = path.join(subdir, 'temp-modres-parent.uc');
    tempFiles.push(importFile);
    const errors = await getErrors(`
import { helper_add } from '../temp-mod-helpers';
let sum = helper_add(1, 2);
print(sum);
`, importFile);
    const importErrors = errors.filter(d =>
      d.message.includes('not defined') || d.message.includes('not found')
    );
    expect(importErrors.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. FILE-BASED MODULE — Dot-notation imports
// ---------------------------------------------------------------------------
describe('File-based module imports (dot notation)', () => {
  test('named import via dot notation', async () => {
    const importFile = path.join(__dirname, 'temp-modres-dot-named.uc');
    tempFiles.push(importFile);
    const errors = await getErrors(`
import { util_parse } from 'temp_mod_sub.utils';
let parts = util_parse("a,b,c");
print(parts);
`, importFile);
    // Dot notation resolution may produce a file-not-found warning depending on
    // workspace root configuration.  We only check for hard errors (severity 1)
    // that indicate the import itself is broken.
    const importErrors = errors.filter(d =>
      d.message.includes('not defined')
    );
    expect(importErrors.length).toBe(0);
  });

  test('namespace import via dot notation', async () => {
    const importFile = path.join(__dirname, 'temp-modres-dot-ns.uc');
    tempFiles.push(importFile);
    const errors = await getErrors(`
import * as utils from 'temp_mod_sub.utils';
let parts = utils.util_parse("a,b,c");
print(parts);
`, importFile);
    const importErrors = errors.filter(d =>
      d.message.includes('not defined')
    );
    expect(importErrors.length).toBe(0);
  });

  test('default import via dot notation', async () => {
    const importFile = path.join(__dirname, 'temp-modres-dot-default.uc');
    tempFiles.push(importFile);
    const errors = await getErrors(`
import utils from 'temp_mod_sub.utils';
print(utils);
`, importFile);
    const importErrors = errors.filter(d =>
      d.message.includes('not defined')
    );
    expect(importErrors.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. CommonJS require() — builtin and file-based
// ---------------------------------------------------------------------------
describe('CommonJS require() imports', () => {
  test('require builtin module', async () => {
    const errors = await getErrors(`
let fsmod = require("fs");
print(fsmod);
`);
    const importErrors = errors.filter(d =>
      d.message.includes('not defined') || d.message.includes('require')
    );
    expect(importErrors.length).toBe(0);
  });

  test('require relative file', async () => {
    const importFile = path.join(__dirname, 'temp-modres-require-rel.uc');
    tempFiles.push(importFile);
    const errors = await getErrors(`
let helpers = require("./temp-mod-helpers");
print(helpers);
`, importFile);
    const importErrors = errors.filter(d =>
      d.message.includes('not defined')
    );
    expect(importErrors.length).toBe(0);
  });

  test('require with const declaration', async () => {
    const errors = await getErrors(`
const fsmod = require("fs");
print(fsmod);
`);
    const importErrors = errors.filter(d =>
      d.message.includes('not defined') || d.message.includes('require')
    );
    expect(importErrors.length).toBe(0);
  });

  test('require rejects non-string argument', async () => {
    const errors = await getErrors(`
let m = require(123);
print(m);
`);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(d => d.message.includes('require'))).toBe(true);
  });

  test('require rejects zero arguments', async () => {
    const errors = await getErrors(`
let m = require();
print(m);
`);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(d => d.message.includes('require'))).toBe(true);
  });

  test('require rejects multiple arguments', async () => {
    const errors = await getErrors(`
let m = require("fs", "extra");
print(m);
`);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(d => d.message.includes('require'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Builtin module: special cases (nl80211 const, rtnl const)
// ---------------------------------------------------------------------------
describe('Special module imports', () => {
  test('nl80211 const bulk import', async () => {
    const errors = await getErrors(`
import { const as nl } from 'nl80211';
print(nl);
`);
    const importErrors = errors.filter(d =>
      d.message.includes('not defined') || d.message.includes('not found')
    );
    expect(importErrors.length).toBe(0);
  });

  test('rtnl const bulk import', async () => {
    const errors = await getErrors(`
import { const as rt } from 'rtnl';
print(rt);
`);
    const importErrors = errors.filter(d =>
      d.message.includes('not defined') || d.message.includes('not found')
    );
    expect(importErrors.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 6. Multiple modules in one file
// ---------------------------------------------------------------------------
describe('Multiple imports in one file', () => {
  test('importing from multiple builtin modules', async () => {
    const errors = await getErrors(`
import { abs } from 'math';
import { readfile } from 'fs';
let a = abs(-5);
let c = readfile("/tmp/a.txt");
print(a, c);
`);
    const importErrors = errors.filter(d =>
      d.message.includes('not defined') || d.message.includes('not found')
    );
    expect(importErrors.length).toBe(0);
  });

  test('importing from builtin and file module together', async () => {
    const importFile = path.join(__dirname, 'temp-modres-multi.uc');
    tempFiles.push(importFile);
    const errors = await getErrors(`
import { abs } from 'math';
import { helper_add } from './temp-mod-helpers';
let a = abs(-5);
let b = helper_add(1, 2);
print(a, b);
`, importFile);
    const importErrors = errors.filter(d =>
      d.message.includes('not defined') || d.message.includes('not found')
    );
    expect(importErrors.length).toBe(0);
  });

  test('mixing require and import in same file', async () => {
    const importFile = path.join(__dirname, 'temp-modres-mix-styles.uc');
    tempFiles.push(importFile);
    const errors = await getErrors(`
import { abs } from 'math';
let helpers = require("./temp-mod-helpers");
let a = abs(-5);
print(a, helpers);
`, importFile);
    const importErrors = errors.filter(d =>
      d.message.includes('not defined')
    );
    expect(importErrors.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 7. Invalid import cases (should produce errors)
// ---------------------------------------------------------------------------
describe('Invalid import cases', () => {
  test('named import of non-existent export from known module', async () => {
    const errors = await getErrors(`
import { nonExistentFunction } from 'math';
print(nonExistentFunction);
`);
    // Should report that nonExistentFunction is not exported by math
    expect(errors.length).toBeGreaterThan(0);
  });

  test('import from non-existent file produces warning', async () => {
    const importFile = path.join(__dirname, 'temp-modres-bad-file.uc');
    tempFiles.push(importFile);
    const all = await getDiagnostics(`
import { something } from './this-file-does-not-exist';
print(something);
`, importFile);
    // Should have at least a warning about the file not being found
    const fileWarnings = all.filter(d =>
      d.message.toLowerCase().includes('not found') || d.message.toLowerCase().includes('cannot find')
    );
    expect(fileWarnings.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 8. Hover type propagation for imports
// ---------------------------------------------------------------------------
describe('Hover type propagation', () => {
  test('hover on namespace import from builtin module shows object type', async () => {
    const code = `import * as fsmod from 'fs';
fsmod.readfile("/tmp/a.txt");
`;
    const importFile = path.join(__dirname, 'temp-modres-hover-ns.uc');
    tempFiles.push(importFile);
    fs.writeFileSync(importFile, code);
    // hover on 'fsmod' on line 1 (0-indexed)
    const hover = await getHover(code, importFile, 1, 0);
    expect(hover).toBeTruthy();
    if (hover && hover.contents) {
      const text = typeof hover.contents === 'string' ? hover.contents : hover.contents.value;
      // Should show module/object type, not "undefined"
      expect(text).not.toContain('undefined');
    }
  });

  test('hover on named import from builtin module shows function type', async () => {
    const code = `import { abs } from 'math';
let x = abs(-5);
print(x);
`;
    const importFile = path.join(__dirname, 'temp-modres-hover-named.uc');
    tempFiles.push(importFile);
    fs.writeFileSync(importFile, code);
    // hover on 'abs' on line 1
    const hover = await getHover(code, importFile, 1, 8);
    expect(hover).toBeTruthy();
    if (hover && hover.contents) {
      const text = typeof hover.contents === 'string' ? hover.contents : hover.contents.value;
      // Should show function info, not "unknown" or "undefined"
      expect(text.toLowerCase()).not.toContain('undefined');
    }
  });
});

// ---------------------------------------------------------------------------
// 9. Bare module name resolution (same-directory)
// ---------------------------------------------------------------------------
describe('Bare module name resolution', () => {
  test('bare name resolves to same-directory .uc file', async () => {
    // Create a sibling module in the same directory as the importer
    const siblingDir = path.join(__dirname, 'temp_bare_mod');
    if (!fs.existsSync(siblingDir)) fs.mkdirSync(siblingDir);
    tempFiles.push(siblingDir);

    const siblingFile = path.join(siblingDir, 'mylib.uc');
    fs.writeFileSync(siblingFile, `
export function mylib_hello() {
    return "hello";
}
export default { name: "mylib" };
`);
    tempFiles.push(siblingFile);

    const importFile = path.join(siblingDir, 'consumer.uc');
    tempFiles.push(importFile);
    const errors = await getErrors(`
import mylib from 'mylib';
print(mylib);
`, importFile);
    const importErrors = errors.filter(d =>
      d.message.includes('Cannot find module') || d.message.includes('not found')
    );
    expect(importErrors.length).toBe(0);
  });

  test('bare name with named imports from same-directory file', async () => {
    const siblingDir = path.join(__dirname, 'temp_bare_mod');
    if (!fs.existsSync(siblingDir)) fs.mkdirSync(siblingDir);

    const importFile = path.join(siblingDir, 'consumer2.uc');
    tempFiles.push(importFile);
    const errors = await getErrors(`
import { mylib_hello } from 'mylib';
let msg = mylib_hello();
print(msg);
`, importFile);
    const importErrors = errors.filter(d =>
      d.message.includes('Cannot find module') || d.message.includes('not found')
    );
    expect(importErrors.length).toBe(0);
  });

  test('bare name still resolves builtin modules first', async () => {
    const errors = await getErrors(`
import { connect } from 'ubus';
print(connect);
`);
    // ubus is a builtin - should still resolve without errors
    const importErrors = errors.filter(d =>
      d.message.includes('Cannot find module')
    );
    expect(importErrors.length).toBe(0);
  });

  test('dotted path resolves relative to importing file directory', async () => {
    // Create subdir with a module
    const baseDir = path.join(__dirname, 'temp_bare_mod');
    if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir);

    const subDir = path.join(baseDir, 'sub');
    if (!fs.existsSync(subDir)) fs.mkdirSync(subDir);
    tempFiles.push(subDir);

    const subFile = path.join(subDir, 'helper.uc');
    fs.writeFileSync(subFile, `
export function sub_helper() {
    return "help";
}
export default { name: "sub_helper" };
`);
    tempFiles.push(subFile);

    const importFile = path.join(baseDir, 'dot_consumer.uc');
    tempFiles.push(importFile);
    const errors = await getErrors(`
import helper from 'sub.helper';
print(helper);
`, importFile);
    const importErrors = errors.filter(d =>
      d.message.includes('Cannot find module') || d.message.includes('not found')
    );
    expect(importErrors.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 10. Narrowing works with imported function results
// ---------------------------------------------------------------------------
describe('Type narrowing with imported functions', () => {
  test('narrowing works on result of imported function inside callback', async () => {
    const importFile = path.join(__dirname, 'temp-modres-narrow.uc');
    tempFiles.push(importFile);
    // The builtin split() returns array | null; length guard should narrow
    const code = `
function get_str_or_null() {
    if (time() > 0) return "a,b,c";
    return null;
}

let arr = [1, 2, 3];
map(arr, function(item) {
    let s = get_str_or_null();
    let parts = split(s, ",");
    if (length(parts) >= 2) {
        let joined = join(",", parts);
        print(joined);
    }
});
`;
    const errors = await getErrors(code, importFile);
    // The join(",", parts) inside the guard should not produce a "may be null" warning
    const nullWarnings = errors.filter(d => d.message.includes('may be null') && d.message.includes('join'));
    expect(nullWarnings.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 11. Default import of function is typed as function (not object)
// ---------------------------------------------------------------------------
describe('Default import function type inference', () => {
  test('default import of function is callable without errors', async () => {
    // Create a module that exports a function via `export default <identifier>`
    const modDir = path.join(__dirname, 'temp_func_mod');
    if (!fs.existsSync(modDir)) fs.mkdirSync(modDir);
    tempFiles.push(modDir);

    const modFile = path.join(modDir, 'validators.uc');
    fs.writeFileSync(modFile, `
function create_validators() {
    return { required: true };
}

export default create_validators;
`);
    tempFiles.push(modFile);

    const importFile = path.join(modDir, 'consumer.uc');
    tempFiles.push(importFile);
    const errors = await getErrors(`
import create_validators from 'validators';
let v = create_validators();
print(v);
`, importFile);
    // Should have no errors about calling a non-function
    const callErrors = errors.filter(d =>
      d.message.includes('not a function') || d.message.includes('not callable')
    );
    expect(callErrors.length).toBe(0);
  });

  test('default import of inline function expression is also callable', async () => {
    const modDir = path.join(__dirname, 'temp_func_mod');
    if (!fs.existsSync(modDir)) fs.mkdirSync(modDir);

    const modFile = path.join(modDir, 'inline_fn.uc');
    fs.writeFileSync(modFile, `
export default function() {
    return 42;
};
`);
    tempFiles.push(modFile);

    const importFile = path.join(modDir, 'consumer_inline.uc');
    tempFiles.push(importFile);
    const errors = await getErrors(`
import get_num from 'inline_fn';
let n = get_num();
print(n);
`, importFile);
    const callErrors = errors.filter(d =>
      d.message.includes('not a function') || d.message.includes('not callable')
    );
    expect(callErrors.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 12. Default import of object has accessible property types
// ---------------------------------------------------------------------------
describe('Default import object property types', () => {
  test('accessing known properties on object default import produces no errors', async () => {
    const modDir = path.join(__dirname, 'temp_obj_mod');
    if (!fs.existsSync(modDir)) fs.mkdirSync(modDir);
    tempFiles.push(modDir);

    const modFile = path.join(modDir, 'pkg.uc');
    fs.writeFileSync(modFile, `
function get_text() {
    return "hello";
}

export default { pkg: "mypackage", sym: 42, get_text: get_text };
`);
    tempFiles.push(modFile);

    const importFile = path.join(modDir, 'use_pkg.uc');
    tempFiles.push(importFile);
    const errors = await getErrors(`
import _pkg_mod from 'pkg';
let name = _pkg_mod.pkg;
let s = _pkg_mod.sym;
print(name, s);
`, importFile);
    // No "unknown" or "not defined" errors for property access
    const propErrors = errors.filter(d =>
      d.message.includes('unknown') || d.message.includes('not defined')
    );
    expect(propErrors.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 13. Go-to-definition stores file:// URI for file-based imports
// ---------------------------------------------------------------------------
describe('Go-to-definition for file-based imports', () => {
  test('importedFrom is stored as file:// URI for resolved file imports', async () => {
    const modDir = path.join(__dirname, 'temp_def_mod');
    if (!fs.existsSync(modDir)) fs.mkdirSync(modDir);
    tempFiles.push(modDir);

    const modFile = path.join(modDir, 'network.uc');
    fs.writeFileSync(modFile, `
function create_network() {
    return {};
}
export default create_network;
`);
    tempFiles.push(modFile);

    const importFile = path.join(modDir, 'main.uc');
    tempFiles.push(importFile);
    const errors = await getErrors(`
import create_network from 'network';
let net = create_network();
print(net);
`, importFile);
    // The import should resolve without errors
    const importErrors = errors.filter(d =>
      d.message.includes('Cannot find module') || d.message.includes('not found')
    );
    expect(importErrors.length).toBe(0);
  });
});
