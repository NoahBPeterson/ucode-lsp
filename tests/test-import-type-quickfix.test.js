// E2e code-action tests for the import() type quick fix (UC7001), driven through
// the spawned server. When a @param type annotation names a module path that
// isn't a known type (e.g. {./lib.uc}), the server offers to replace it with
// import('./lib.uc') plus import('./lib.uc').<prop> for each property of the
// module's default-export object. Covers generateImportTypeQuickFix in server.ts.
//
// Uses real temp files so the server's FileResolver can resolve the import path.

import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLSPTestServer } = require('./lsp-test-helpers');

let getDiagnostics, getCodeActions, dir;

beforeAll(async () => {
  const server = createLSPTestServer();
  await server.initialize();
  getDiagnostics = server.getDiagnostics;
  getCodeActions = server.getCodeActions;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ucode-impfix-'));
  fs.writeFileSync(path.join(dir, 'lib.uc'), 'export default { host: "h", port: 80 };\n');
});
afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} });

describe('Import-type quick fix UC7001 (e2e)', () => {
  test('module-path @param type → import(module) + per-property replacements', async () => {
    const mainPath = path.join(dir, 'main.uc');
    const code = '/** @param {./lib.uc} cfg */\nfunction f(cfg) { return cfg; }\n';
    fs.writeFileSync(mainPath, code);
    const diags = await getDiagnostics(code, mainPath);
    const uc7001 = diags.find((d) => d.code === 'UC7001');
    expect(uc7001).toBeDefined();
    const actions = await getCodeActions(mainPath, [uc7001], uc7001.range.start.line, uc7001.range.start.character);
    const titles = actions.map((a) => a.title);
    // Bare import() option is always offered when the path resolves.
    expect(titles).toContain("Replace with import('./lib.uc')");
    // Per-property options come from the default export's object shape.
    expect(titles.some((t) => /import\('\.\/lib\.uc'\)\.host/.test(t))).toBe(true);
    expect(titles.some((t) => /import\('\.\/lib\.uc'\)\.port/.test(t))).toBe(true);
  });

  test('the import() action carries an edit replacing the brace type body', async () => {
    const mainPath = path.join(dir, 'main_edit.uc');
    const code = '/** @param {./lib.uc} cfg */\nfunction f(cfg) { return cfg; }\n';
    fs.writeFileSync(mainPath, code);
    const diags = await getDiagnostics(code, mainPath);
    const uc7001 = diags.find((d) => d.code === 'UC7001');
    const actions = await getCodeActions(mainPath, [uc7001], uc7001.range.start.line, uc7001.range.start.character);
    const bare = actions.find((a) => a.title === "Replace with import('./lib.uc')");
    expect(bare).toBeDefined();
    const edits = Object.values(bare.edit.changes)[0];
    expect(edits[0].newText).toBe("import('./lib.uc')");
  });

  test('non-module unknown type → no import() replacement offered', async () => {
    const mainPath = path.join(dir, 'main2.uc');
    const code = '/** @param {Bogus} x */\nfunction g(x) { return x; }\n';
    fs.writeFileSync(mainPath, code);
    const diags = await getDiagnostics(code, mainPath);
    const uc7001 = diags.find((d) => d.code === 'UC7001');
    expect(uc7001).toBeDefined();
    const actions = await getCodeActions(mainPath, [uc7001], uc7001.range.start.line, uc7001.range.start.character);
    expect(actions.some((a) => /Replace with import\(/.test(a.title))).toBe(false);
  });
});
