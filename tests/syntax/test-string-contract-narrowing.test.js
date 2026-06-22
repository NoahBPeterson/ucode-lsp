// String-contract narrowing: a value passed to a builtin that returns null for any
// non-string arg (fs.stat/readfile/open/…, and globals match/substr/split/…) is
// narrowed `unknown -> string` in the branch where that call is truthy — including
// the fall-through of an early-exit guard `if (!stat(path) || …) return;`.
const { test, expect } = require('bun:test');
const path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');

const fp = path.join(__dirname, 'temp-string-contract.uc');

// Hover the LAST standalone occurrence of `varName` on the line containing `marker`
// (so `return p` is targeted, not the `p` inside `split`).
async function hoverType(content, marker, varName) {
  const server = createLSPTestServer();
  try {
    await server.initialize();
    const lines = content.split('\n');
    const ln = lines.findIndex((l) => l.includes(marker));
    const re = new RegExp('\\b' + varName + '\\b', 'g');
    let ch = -1, m;
    while ((m = re.exec(lines[ln])) !== null) ch = m.index;
    const h = await server.getHover(content, fp, ln, ch);
    if (!h || !h.contents) return '';
    return (typeof h.contents === 'string' ? h.contents : h.contents.value || '').split('\n')[0];
  } finally {
    server.shutdown();
  }
}

test('fs.stat alias + `||` early-exit (the real pbr pattern) narrows to string', async () => {
  const content = `let _fs = require('fs');
function user_file_process(enabled, p) {
    let stat = _fs.stat;
    if (!stat(p) || stat(p).size == 0) return 1;
    return match(p, /x/); // USE
}
`;
  expect(await hoverType(content, '// USE', 'p')).toMatch(/: `string`/);
});

test('fs member call `_fs.stat(p)` early-exit narrows', async () => {
  const content = `let _fs = require('fs');
function f(p) {
    if (!_fs.stat(p)) return 1;
    return p; // USE
}
`;
  expect(await hoverType(content, '// USE', 'p')).toMatch(/: `string`/);
});

test('global match() early-exit narrows', async () => {
  const content = `function f(p) {
    if (!match(p, /a/)) return 1;
    return p; // USE
}
`;
  expect(await hoverType(content, '// USE', 'p')).toMatch(/: `string`/);
});

test('positive consequent branch narrows too', async () => {
  const content = `function f(p) {
    if (split(p, ",")) { return p; } // USE
}
`;
  expect(await hoverType(content, '// USE', 'p')).toMatch(/: `string`/);
});

test('coercing builtins (uc/lc) do NOT narrow', async () => {
  const content = `function f(p) {
    if (!uc(p)) return 1;
    return p; // USE
}
`;
  expect(await hoverType(content, '// USE', 'p')).toMatch(/: `unknown`/);
});

test('a user-shadowed builtin name is NOT treated as the builtin', async () => {
  const content = `function match(a) { return a; }
function f(p) {
    if (!match(p)) return 1;
    return p; // USE
}
`;
  expect(await hoverType(content, '// USE', 'p')).toMatch(/: `unknown`/);
});

test('positive-only: the FAILURE branch is not narrowed', async () => {
  // Inside `if (!stat(p)) { … }`, the call FAILED — p may be a non-string, so it
  // must stay unknown (a falsy result does not prove anything about p).
  const content = `let _fs = require('fs');
function f(p) {
    if (!_fs.stat(p)) {
        return p; // USE
    }
    return 0;
}
`;
  expect(await hoverType(content, '// USE', 'p')).toMatch(/: `unknown`/);
});
