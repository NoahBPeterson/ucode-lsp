const { test, expect } = require('bun:test');
const path = require('path');
const { createLSPTestServer } = require('./lsp-test-helpers');

const filePath = path.join(__dirname, 'temp-import-top-level.uc');

const isPlacementDiag = (d) =>
  d.code === 'UC3007' || /top level of a module/i.test(d.message || '');

test('UC3007: import inside an if-block is flagged', async () => {
  const server = createLSPTestServer();
  try {
    await server.initialize();
    const content = `function create() {
    if (true) {
        import * as fs from 'fs';
        return fs;
    }
}
`;
    const diagnostics = await server.getDiagnostics(content, filePath);
    const placement = diagnostics.filter(isPlacementDiag);
    expect(placement.length).toBe(1);
    expect(placement[0].severity).toBe(1); // Error
    // The flagged range should be on the import line (0-indexed line 2)
    expect(placement[0].range.start.line).toBe(2);
  } finally {
    server.shutdown();
  }
});

test('UC3007: import inside a function body is flagged', async () => {
  const server = createLSPTestServer();
  try {
    await server.initialize();
    const content = `function load() {
    import { open } from 'fs';
    return open;
}
`;
    const diagnostics = await server.getDiagnostics(content, filePath);
    const placement = diagnostics.filter(isPlacementDiag);
    expect(placement.length).toBe(1);
  } finally {
    server.shutdown();
  }
});

test('UC3007: top-level import is NOT flagged', async () => {
  const server = createLSPTestServer();
  try {
    await server.initialize();
    const content = `import * as fs from 'fs';
import { open } from 'fs';

function load() {
    return open;
}
`;
    const diagnostics = await server.getDiagnostics(content, filePath);
    const placement = diagnostics.filter(isPlacementDiag);
    expect(placement.length).toBe(0);
  } finally {
    server.shutdown();
  }
});

test('UC3007: invalid nested import does NOT enter scope (downstream use is undefined)', async () => {
  const server = createLSPTestServer();
  try {
    await server.initialize();
    const content = `function create() {
    if (true) {
        import * as fs from 'fs';
        return fs.open('/x', 'r');
    }
}
`;
    const diagnostics = await server.getDiagnostics(content, filePath);
    // The import is flagged once...
    expect(diagnostics.filter(isPlacementDiag).length).toBe(1);
    // ...and because its binding never entered scope, the later `fs.open` use is
    // flagged as an unimported module (UC3006) rather than resolving silently.
    const fsUseLine = content.split('\n').findIndex((l) => l.includes('fs.open'));
    const downstream = diagnostics.filter(
      (d) => d.range.start.line === fsUseLine && /without importing it|undefined/i.test(d.message || '')
    );
    expect(downstream.length).toBeGreaterThanOrEqual(1);
  } finally {
    server.shutdown();
  }
});

test('UC3007: invalid nested import shows no module hover for its binding', async () => {
  const server = createLSPTestServer();
  try {
    await server.initialize();
    const content = `function create() {
    if (true) {
        import * as fs from 'fs';
        let h = fs.open('/', 'r');
    }
}
`;
    // Hover over `fs` in `fs.open` on line 3 (0-indexed), at the `f` of fs.
    const fsUseLine = content.split('\n').findIndex((l) => l.includes('fs.open'));
    const ch = content.split('\n')[fsUseLine].indexOf('fs.open');
    const hover = await server.getHover(content, filePath, fsUseLine, ch);
    const hoverText =
      hover && hover.contents
        ? typeof hover.contents === 'string'
          ? hover.contents
          : hover.contents.value || JSON.stringify(hover.contents)
        : '';
    // No "FS Module" / "File system operations" module documentation should appear.
    expect(/file system operations/i.test(hoverText)).toBe(false);
    expect(/\bFS Module\b/.test(hoverText)).toBe(false);
  } finally {
    server.shutdown();
  }
});
