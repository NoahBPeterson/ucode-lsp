// Batch I provider fixes — definition (46), document symbols (47), folding (48).
const { test, expect } = require('bun:test');
const path = require('path');
const { createLSPTestServer } = require('../lsp-test-helpers');

const fp = path.join(__dirname, 'temp-batch-i-other.uc');

async function withServer(fn) {
  const server = createLSPTestServer();
  try {
    await server.initialize();
    return await fn(server);
  } finally {
    server.shutdown();
  }
}

// #46 — go-to-definition returns a non-empty (name-width) range for a local symbol.
test('#46 definition range spans the symbol name', async () => {
  const content = `function greeting() { return 1; }\ngreeting();\n`;
  const def = await withServer((s) => s.getDefinition(content, fp, 1, 0)); // on the call
  const d = Array.isArray(def) ? def[0] : def;
  expect(d).toBeTruthy();
  expect(d.range.start.line).toBe(0);
  // Non-zero width: 'greeting' is 8 chars starting at column 9.
  expect(d.range.end.character).toBeGreaterThan(d.range.start.character);
  expect(d.range.end.character - d.range.start.character).toBe('greeting'.length);
});

// #47 — document symbols include return-object members and function params.
test('#47 document symbols include return {} members and params', async () => {
  const content = `function make(alpha) {\n  return { exec: function(a){ return a; }, val: 5 };\n}\n`;
  const syms = await withServer((s) => s.getDocumentSymbols(content, fp));
  const flat = [];
  const walk = (arr) => { for (const x of (arr || [])) { flat.push(x.name); walk(x.children); } };
  walk(syms);
  expect(flat).toContain('make');
  expect(flat).toContain('alpha'); // param
  expect(flat).toContain('exec');  // returned object member
  expect(flat).toContain('val');   // returned object member
});

// #48 — folding emits a fold per switch case clause.
test('#48 folding includes per-case folds', async () => {
  const content = `function f(x) {
    switch (x) {
        case 1:
            print("one");
            return 1;
        case 2:
            print("two");
            return 2;
        default:
            print("other");
            return 0;
    }
}
`;
  const folds = await withServer((s) => s.getFoldingRanges(content, fp)) || [];
  // The whole switch folds (line 1) plus each clause should fold on its own start line.
  const caseFolds = folds.filter((fo) => fo.startLine === 2 || fo.startLine === 5 || fo.startLine === 8);
  expect(caseFolds.length).toBeGreaterThanOrEqual(3);
});
