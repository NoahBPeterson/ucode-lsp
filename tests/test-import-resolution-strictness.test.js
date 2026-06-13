// Regression for auto-docs #69–72 — import/export resolution made faithful to ucode
// (all verified against /usr/local/bin/ucode):
//   #69  `export … from` / `export *` re-exports are not valid ucode syntax
//   #70  relative imports require the explicit `.uc` (no auto-append)
//   #71  `./` is importer-relative only (no workspace-root fallback)
//   #72  absolute `/path` is a real filesystem path (checked on disk first)

import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
const path = require('path');
const fs = require('fs');
const { createLSPTestServer } = require('./lsp-test-helpers');

const ws = '/tmp/test-import-strict';
const sub = path.join(ws, 'sub');
const FILES = {
  'impl.uc': 'export function helper() { return 7; }\n',
  'reexport.uc': 'export { helper } from "./impl.uc";\n',
  'reexportstar.uc': 'export * from "./impl.uc";\n',
};

let server;
beforeAll(async () => {
  fs.mkdirSync(sub, { recursive: true });
  for (const [name, content] of Object.entries(FILES)) fs.writeFileSync(path.join(ws, name), content);
  server = createLSPTestServer({ workspaceRoot: ws });
  await server.initialize();
});
afterAll(() => { try { server.shutdown(); } catch {} try { fs.rmSync(ws, { recursive: true, force: true }); } catch {} });

const diagsAt = (content, file) => server.getDiagnostics(content, path.join(ws, file));
const moduleNotFound = (d) => d.filter((x) => x.code === 'UC3002');
const reExportErr = (d) => d.filter((x) => /does not support/.test(x.message));

describe('#70/#71 relative import resolution', () => {
  test('extensionless relative import is flagged UC3002 (ucode requires .uc)', async () => {
    const d = await diagsAt('import { helper } from "./impl";\nhelper();\n', 'app.uc');
    expect(moduleNotFound(d).length).toBe(1);
  });
  test('relative import WITH .uc resolves cleanly', async () => {
    const d = await diagsAt('import { helper } from "./impl.uc";\nhelper();\n', 'app.uc');
    expect(moduleNotFound(d)).toEqual([]);
  });
  test('`./x.uc` from a subdir does NOT fall back to workspace root', async () => {
    // impl.uc is at the workspace ROOT; from sub/ it must not resolve.
    const d = await diagsAt('import { helper } from "./impl.uc";\nhelper();\n', 'sub/from-sub.uc');
    expect(moduleNotFound(d).length).toBe(1);
    // ...but the correct relative path up to the root does resolve.
    const d2 = await diagsAt('import { helper } from "../impl.uc";\nhelper();\n', 'sub/from-sub.uc');
    expect(moduleNotFound(d2)).toEqual([]);
  });
});

describe('#72 absolute import resolution', () => {
  test('a real absolute path that exists on disk resolves', async () => {
    const d = await diagsAt(`import { helper } from "${path.join(ws, 'impl.uc')}";\nhelper();\n`, 'app.uc');
    expect(moduleNotFound(d)).toEqual([]);
  });
  test('a non-existent absolute path is flagged', async () => {
    const d = await diagsAt('import { helper } from "/nope/missing.uc";\nhelper();\n', 'app.uc');
    expect(moduleNotFound(d).length).toBe(1);
  });
});

describe('#69 re-export syntax', () => {
  test('`export { x } from "…"` is flagged as unsupported syntax', async () => {
    const d = await diagsAt('export { helper } from "./impl.uc";\n', 'reexport.uc');
    expect(reExportErr(d).length).toBe(1);
  });
  test('`export * from "…"` is flagged as unsupported syntax', async () => {
    const d = await diagsAt('export * from "./impl.uc";\n', 'reexportstar.uc');
    expect(reExportErr(d).length).toBe(1);
  });
  test('a re-exported name is NOT invented as a real export (downstream import fails)', async () => {
    // reexport.uc re-exports `helper`; importing it must NOT resolve a phantom export.
    const d = await diagsAt('import { helper } from "./reexport.uc";\nhelper();\n', 'consumer.uc');
    expect(d.filter((x) => x.code === 'UC3005').length).toBe(1); // EXPORT_NOT_FOUND
  });
});
