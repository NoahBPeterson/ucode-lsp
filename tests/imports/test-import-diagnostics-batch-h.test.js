const { test, expect } = require('bun:test');
const path = require('path');
const fs = require('fs');
const { createLSPTestServer } = require('../lsp-test-helpers');

// Regression tests for batch-H import/module-resolution fixes.
// Multi-file dependencies live on disk under tests/fixtures/import-batch-h/;
// the importing/consumer file's content is fed inline (its PATH points into that
// dir so relative imports resolve on disk).
const FIX = path.join(__dirname, '..', 'fixtures', 'import-batch-h');
const inDir = (name) => path.join(FIX, name);

async function withServer(fn) {
  const server = createLSPTestServer();
  try {
    await server.initialize();
    return await fn(server);
  } finally {
    server.shutdown();
  }
}

// ── Ticket 73: a parse-failed dependency is reported as such, not "does not export"
test('73: importing from a dependency that fails to parse → UC3009 parse-failure, no cascade', async () => {
  await withServer(async (server) => {
    const content = `import { something } from './broken.uc';\nsomething();\n`;
    const diags = await server.getDiagnostics(content, inDir('importer.uc'));

    const parseErr = diags.filter(d => d.code === 'UC3009');
    expect(parseErr.length).toBe(1);
    expect(parseErr[0].message).toContain('could not be parsed');

    // No misleading "does not export" and no cascading "Undefined function".
    expect(diags.some(d => d.code === 'UC3005')).toBe(false);
    expect(diags.some(d => d.code === 'UC1002')).toBe(false);
  });
});

// ── Ticket 74: a file importing from itself gets a dedicated self-import diagnostic
test('74: a self-import is flagged (UC3010), not a confusing "already declared"', async () => {
  await withServer(async (server) => {
    const content = fs.readFileSync(inDir('selfx.uc'), 'utf-8');
    const diags = await server.getDiagnostics(content, inDir('selfx.uc'));

    const selfImport = diags.filter(d => d.code === 'UC3010');
    expect(selfImport.length).toBe(1);
    expect(selfImport[0].message).toContain('imports from itself');

    // The incidental "already declared" (UC3001) must be suppressed.
    expect(diags.some(d => d.code === 'UC3001')).toBe(false);
  });
});

// ── Ticket 75: a true cycle A→B→A is flagged; a DAG diamond is NOT
test('75: circular import A↔B is flagged (UC3004) with the cycle path', async () => {
  await withServer(async (server) => {
    const content = fs.readFileSync(inDir('circa.uc'), 'utf-8');
    const diags = await server.getDiagnostics(content, inDir('circa.uc'));

    const cycle = diags.filter(d => d.code === 'UC3004');
    expect(cycle.length).toBe(1);
    expect(cycle[0].message).toContain('Circular import detected');
    expect(cycle[0].message).toContain('circa.uc');
    expect(cycle[0].message).toContain('circb.uc');
  });
});

test('75: a DAG diamond (top→left/right→base) is NOT flagged as circular', async () => {
  await withServer(async (server) => {
    const content = fs.readFileSync(inDir('top.uc'), 'utf-8');
    const diags = await server.getDiagnostics(content, inDir('top.uc'));
    expect(diags.some(d => d.code === 'UC3004')).toBe(false);
  });
});

// ── Ticket 90: an unused import gets an import-specific message + Unnecessary tag
test('90: an unused import reads "Import \'x\' is unused" and carries the Unnecessary tag', async () => {
  await withServer(async (server) => {
    const content = `import { open } from 'fs';\nprint('hi');\n`;
    const diags = await server.getDiagnostics(content, inDir('unused.uc'));

    const unused = diags.filter(d => d.code === 'UC1006' && /open/.test(d.message));
    expect(unused.length).toBe(1);
    expect(unused[0].message).toBe("Import 'open' is unused");
    // DiagnosticTag.Unnecessary === 1
    expect(Array.isArray(unused[0].tags) && unused[0].tags.includes(1)).toBe(true);
  });
});

// ── Ticket 168: an inline `export default { … }` shape is closed → unknown member flagged
test('168: default-imported inline-literal object flags an unknown member (UC7004)', async () => {
  await withServer(async (server) => {
    const content = `import D from './d_inline.uc';\nD.x;\nD.nope;\n`;
    const diags = await server.getDiagnostics(content, inDir('main.uc'));

    const unknownMember = diags.filter(d => d.code === 'UC7004' && /nope/.test(d.message));
    expect(unknownMember.length).toBe(1);
    expect(unknownMember[0].message).toContain('does not exist');
  });
});

test('168: a default-imported `const cfg = {…}` binding is NOT treated as closed (sound)', async () => {
  await withServer(async (server) => {
    // A named `const` object can be mutated later (cfg.x = …), so its shape is not
    // provably closed — accessing an unlisted member must NOT be flagged.
    const content = `import D from './d_obj.uc';\nD.x;\nD.nope;\n`;
    const diags = await server.getDiagnostics(content, inDir('main.uc'));
    expect(diags.some(d => d.code === 'UC7004')).toBe(false);
  });
});

// ── Ticket 170: a transitive re-export (const VAL2 = VAL; export {VAL2}) carries VAL's type
test('170: a transitive re-export propagates the source type across the chain', async () => {
  await withServer(async (server) => {
    // b.uc: import { VAL } from './c.uc'; const VAL2 = VAL; export { VAL2 };
    // c.uc: export const VAL = 99;  → VAL2 should hover as `integer`, not `unknown`.
    const content = `import { VAL2 } from './b.uc';\nVAL2 + 1;\n`;
    const consumerPath = inDir('consumer.uc');
    const lines = content.split('\n');
    const li = lines.findIndex(l => l.includes('VAL2 + 1'));
    const ch = lines[li].indexOf('VAL2') + 2;

    const hover = await server.getHover(content, consumerPath, li, ch);
    const value = hover && hover.contents && hover.contents.value;
    expect(value).toBeTruthy();
    expect(value).toContain('integer');
    expect(value).not.toContain('unknown');
  });
});
