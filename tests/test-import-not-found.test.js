const { test, expect } = require('bun:test');
const path = require('path');
const { createLSPTestServer } = require('./lsp-test-helpers');

test('should warn when relative import cannot be resolved', async () => {
  const server = createLSPTestServer();

  try {
    await server.initialize();

    const testPath = path.join(__dirname, 'temp-test-import-not-found.uc');
    const testContent = `import { run_command } from '../lib/commands.uc';

let result = run_command('test');
`;

    const diagnostics = await server.getDiagnostics(testContent, testPath);

    // Filter for MODULE_NOT_FOUND warnings
    const moduleNotFoundWarnings = diagnostics.filter(d =>
      d.message && d.message.includes("Cannot find module") && d.message.includes("../lib/commands.uc")
    );

    console.log('Module not found warnings:', moduleNotFoundWarnings);

    // Should have exactly one warning for the unresolved import
    expect(moduleNotFoundWarnings.length).toBe(1);
    expect(moduleNotFoundWarnings[0].message).toContain("Cannot find module '../lib/commands.uc'");
    expect(moduleNotFoundWarnings[0].severity).toBe(2); // Warning severity

    console.log('✓ Unresolved relative imports generate MODULE_NOT_FOUND warnings');
  } finally {
    server.shutdown();
  }
});

test('should not warn when relative import can be resolved', async () => {
  const server = createLSPTestServer();

  try {
    await server.initialize();

    // Create the module file that will be imported
    const modulePath = path.join(__dirname, 'temp-test-existing-module.uc');
    const moduleContent = `export function run_command(cmd) {
  return "executed: " + cmd;
}
`;
    const fs = require('fs');
    fs.writeFileSync(modulePath, moduleContent);

    try {
      const testPath = path.join(__dirname, 'temp-test-import-found.uc');
      const testContent = `import { run_command } from './temp-test-existing-module';

let result = run_command('test');
`;

      const diagnostics = await server.getDiagnostics(testContent, testPath);

      // Filter for MODULE_NOT_FOUND warnings
      const moduleNotFoundWarnings = diagnostics.filter(d =>
        d.message && d.message.includes("Cannot find module")
      );

      console.log('Module not found warnings:', moduleNotFoundWarnings);

      // Should have no MODULE_NOT_FOUND warnings
      expect(moduleNotFoundWarnings.length).toBe(0);

      console.log('✓ Resolved relative imports do not generate MODULE_NOT_FOUND warnings');
    } finally {
      if (fs.existsSync(modulePath)) {
        fs.unlinkSync(modulePath);
      }
    }
  } finally {
    server.shutdown();
  }
});

test('should warn for multiple unresolved imports', async () => {
  const server = createLSPTestServer();

  try {
    await server.initialize();

    const testPath = path.join(__dirname, 'temp-test-multiple-imports.uc');
    const testContent = `import { run_command } from '../lib/commands.uc';
import { parse_config } from './nonexistent/config.uc';
import { helper } from '../utils/helper.uc';

run_command('test');
parse_config({});
helper();
`;

    const diagnostics = await server.getDiagnostics(testContent, testPath);

    // Filter for MODULE_NOT_FOUND warnings
    const moduleNotFoundWarnings = diagnostics.filter(d =>
      d.message && d.message.includes("Cannot find module")
    );

    console.log('Module not found warnings:', moduleNotFoundWarnings);

    // Should have three warnings for the three unresolved imports
    expect(moduleNotFoundWarnings.length).toBe(3);

    const importPaths = moduleNotFoundWarnings.map(d => {
      const match = d.message.match(/Cannot find module '([^']+)'/);
      return match ? match[1] : null;
    });

    expect(importPaths).toContain('../lib/commands.uc');
    expect(importPaths).toContain('./nonexistent/config.uc');
    expect(importPaths).toContain('../utils/helper.uc');

    console.log('✓ Multiple unresolved imports each generate MODULE_NOT_FOUND warnings');
  } finally {
    server.shutdown();
  }
});
