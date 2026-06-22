// Folding ranges: blocks, import groups, and comments.
const { test, expect } = require('bun:test');
const path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');

const fp = path.join(__dirname, 'temp-folding.uc');

async function foldsFor(content) {
  const server = createLSPTestServer();
  try {
    await server.initialize();
    return (await server.getFoldingRanges(content, fp)) || [];
  } finally {
    server.shutdown();
  }
}
const has = (folds, startLine, endLine, kind) =>
  folds.some((f) => f.startLine === startLine && f.endLine === endLine && (kind === undefined ? !f.kind : f.kind === kind));

test('folds block-bearing nodes: function body, object, array, if-block, switch', async () => {
  const content = `function create(x) {
    let obj = {
        a: 1,
        b: 2,
    };
    let arr = [
        1,
        2,
    ];
    if (x)
    {
        return x;
    }
    switch (x) {
        case 1:
            return 1;
    }
}
`;
  const folds = await foldsFor(content);
  expect(has(folds, 0, 17)).toBe(true);  // function body { ... }
  expect(has(folds, 1, 4)).toBe(true);   // object literal
  expect(has(folds, 5, 8)).toBe(true);   // array literal
  expect(has(folds, 10, 12)).toBe(true); // Allman if-block (starts at the brace line)
  expect(has(folds, 13, 16)).toBe(true); // switch
});

test('folds a run of consecutive imports as an Imports range', async () => {
  const content = `import a from 'fs';
import b from 'uci';
import c from 'ubus';

print(a);
`;
  const folds = await foldsFor(content);
  expect(has(folds, 0, 2, 'imports')).toBe(true);
});

test('folds multi-line block comments and line-comment runs', async () => {
  const content = `// line one
// line two
// line three
/**
 * a jsdoc block
 */
function f() {
    return 1;
}
`;
  const folds = await foldsFor(content);
  expect(has(folds, 0, 2, 'comment')).toBe(true); // line-comment run
  expect(has(folds, 3, 5, 'comment')).toBe(true); // jsdoc block
});

test('does not fold single-line constructs', async () => {
  const content = `let o = { a: 1 };
let arr = [1, 2, 3];
// a lone comment
function f() { return 1; }
`;
  const folds = await foldsFor(content);
  // Nothing here spans more than one line, so there should be no folds at all.
  expect(folds.length).toBe(0);
});
