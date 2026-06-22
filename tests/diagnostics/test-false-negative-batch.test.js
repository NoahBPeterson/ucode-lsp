// Regression for three false negatives — genuine ucode errors the LSP was silent on:
//   #105  function redeclaration in strict mode (UC1007)
//   #15   `delete arr[i]` (delete on an array element — runtime error)
//   #167  exporting a non-module-local name (UC3003)
// All three verified against /usr/local/bin/ucode.

import { test, expect, describe, beforeAll } from 'bun:test';
const { createLSPTestServer } = require('../lsp-test-helpers');

let getDiagnostics;
beforeAll(async () => {
  const server = createLSPTestServer();
  await server.initialize();
  getDiagnostics = server.getDiagnostics;
});
const has = (diags, pred) => diags.filter(pred);

describe('#105 function redeclaration', () => {
  test('strict mode: a redeclared function is flagged UC1007 on the 2nd declaration', async () => {
    const code = "'use strict';\nfunction f(){ return 1; }\nfunction f(){ return 2; }\nprint(f());\n";
    const d = await getDiagnostics(code, '/tmp/fnb-redecl-strict.uc');
    const re = has(d, (x) => x.code === 'UC1007');
    expect(re.length).toBe(1);
    expect(re[0].range.start.line).toBe(2); // the second `function f`
  });

  test('non-strict: redeclaration is allowed (last wins) — no UC1007', async () => {
    const code = 'function f(){ return 1; }\nfunction f(){ return 2; }\nprint(f());\n';
    const d = await getDiagnostics(code, '/tmp/fnb-redecl-nonstrict.uc');
    expect(has(d, (x) => x.code === 'UC1007')).toEqual([]);
  });

  test('strict: distinct names + nested same-name shadow are clean (no false positive)', async () => {
    const code = "'use strict';\nfunction f(){ return 1; }\nfunction g(){ return 2; }\nfunction outer(){ function f(){ return 3; } return f(); }\nprint(f(), g(), outer());\n";
    const d = await getDiagnostics(code, '/tmp/fnb-redecl-clean.uc');
    expect(has(d, (x) => x.code === 'UC1007')).toEqual([]);
  });
});

describe('#15 delete on an array element', () => {
  const delMsg = (x) => /delete/i.test(x.message);
  test('`delete arr[i]` on an array variable is flagged', async () => {
    const d = await getDiagnostics('let a = [1, 2, 3];\ndelete a[0];\n', '/tmp/fnb-del-arr.uc');
    expect(has(d, delMsg).length).toBe(1);
  });
  test('`delete arr[i]` on a split() array result is flagged', async () => {
    const d = await getDiagnostics('let p = split("a,b", ",");\ndelete p[1];\n', '/tmp/fnb-del-split.uc');
    expect(has(d, delMsg).length).toBe(1);
  });
  test('`delete obj.k` and `delete obj[k]` stay clean', async () => {
    const d = await getDiagnostics('let o = { a: 1 };\nlet k = "a";\ndelete o.a;\ndelete o[k];\n', '/tmp/fnb-del-obj.uc');
    expect(has(d, delMsg)).toEqual([]);
  });
  test('`delete x[i]` on an unknown-typed param is not flagged (no over-reach)', async () => {
    const d = await getDiagnostics('function f(x) { delete x[0]; }\n', '/tmp/fnb-del-unknown.uc');
    expect(has(d, delMsg)).toEqual([]);
  });
});

describe('#167 exporting a non-local name', () => {
  const expMsg = (x) => x.code === 'UC3003';
  test('exporting an undeclared name is flagged (and only that name)', async () => {
    const d = await getDiagnostics('const a = 1;\nexport { a, ghost };\n', '/tmp/fnb-exp-ghost.uc');
    const e = has(d, expMsg);
    expect(e.length).toBe(1);
    expect(e[0].message).toMatch(/ghost/);
  });
  test('exporting a builtin or an imported name is flagged (non-local)', async () => {
    const dBuiltin = await getDiagnostics('const a = 1;\nexport { length };\n', '/tmp/fnb-exp-builtin.uc');
    expect(has(dBuiltin, expMsg).length).toBe(1);
    const dImport = await getDiagnostics("import { readfile } from 'fs';\nexport { readfile };\n", '/tmp/fnb-exp-import.uc');
    expect(has(dImport, expMsg).length).toBe(1);
  });
  test('exporting module-local let/const/function (named or inline) is clean', async () => {
    const d1 = await getDiagnostics('const a = 1;\nfunction f(){}\nexport { a, f };\n', '/tmp/fnb-exp-local.uc');
    expect(has(d1, expMsg)).toEqual([]);
    const d2 = await getDiagnostics('export const a = 1;\nexport function f(){}\n', '/tmp/fnb-exp-inline.uc');
    expect(has(d2, expMsg)).toEqual([]);
  });
});
