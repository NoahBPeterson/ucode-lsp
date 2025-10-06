const { test, expect } = require('bun:test');
const path = require('path');
const { createLSPTestServer } = require('./lsp-test-helpers');

test('should mark identifiers in template literals as used', async () => {
  const server = createLSPTestServer();

  try {
    await server.initialize();

    const testPath = path.join(__dirname, 'temp-test-template-literal.uc');
    const testContent = `import { warn } from 'log';

function ubus_error() {
  return "UBUS_ERROR_TIMEOUT";
}

warn(\`Error: \${ubus_error()}\`);
`;

    const diagnostics = await server.getDiagnostics(testContent, testPath);

    // DEBUG: Print ALL diagnostics
    console.log('ALL diagnostics for test 1:', JSON.stringify(diagnostics, null, 2));

    // Filter for unused variable warnings
    const unusedWarnings = diagnostics.filter(d =>
      d.message && (d.message.includes('is declared but never used') || d.message.includes('unused'))
    );

    console.log('Unused variable warnings:', unusedWarnings);

    // ubus_error() is used in the template literal, so should NOT be marked as unused
    const ubus_errorUnused = unusedWarnings.find(d => d.message.includes('ubus_error'));

    // NOTE: This test may fail if the ucode parser does not create TemplateLiteral AST nodes
    // for backtick strings. If the parser treats backtick strings as regular string literals,
    // the template literal visitor will never be invoked and identifiers inside ${} expressions
    // will incorrectly appear as unused.
    //
    // If this test fails, it indicates a parser limitation rather than an LSP bug.
    // Workaround: Use string concatenation instead of template literals.

    expect(ubus_errorUnused).toBeUndefined();

    console.log('✓ Identifiers used in template literals are marked as used');
  } finally {
    server.shutdown();
  }
});

test('should mark unused identifiers even when template literals are present', async () => {
  const server = createLSPTestServer();

  try {
    await server.initialize();

    const testPath = path.join(__dirname, 'temp-test-template-literal-unused.uc');
    const testContent = `import { warn } from 'log';

function ubus_error() {
  return "UBUS_ERROR_TIMEOUT";
}

function unused_function() {
  return "never called";
}

warn(\`Error: \${ubus_error()}\`);
`;

    const diagnostics = await server.getDiagnostics(testContent, testPath);

    // Filter for unused variable warnings
    const unusedWarnings = diagnostics.filter(d =>
      d.message && (d.message.includes('is declared but never used') || d.message.includes('unused'))
    );

    console.log('Unused variable warnings:', unusedWarnings);

    // unused_function should be marked as unused
    const unusedFunctionWarning = unusedWarnings.find(d => d.message.includes('unused_function'));

    expect(unusedFunctionWarning).toBeDefined();
    expect(unusedFunctionWarning.message).toContain('unused_function');

    // ubus_error should NOT be marked as unused (it's used in template literal)
    const ubus_errorUnused = unusedWarnings.find(d => d.message.includes('ubus_error'));
    expect(ubus_errorUnused).toBeUndefined();

    console.log('✓ Unused identifiers are correctly flagged even with template literals present');
  } finally {
    server.shutdown();
  }
});

test('should handle template literals with multiple embedded expressions', async () => {
  const server = createLSPTestServer();

  try {
    await server.initialize();

    const testPath = path.join(__dirname, 'temp-test-template-literal-multiple.uc');
    const testContent = `import { warn } from 'log';

function get_error_code() {
  return 500;
}

function get_error_message() {
  return "Internal Server Error";
}

warn(\`Error \${get_error_code()}: \${get_error_message()}\`);
`;

    const diagnostics = await server.getDiagnostics(testContent, testPath);

    // Filter for unused variable warnings
    const unusedWarnings = diagnostics.filter(d =>
      d.message && (d.message.includes('is declared but never used') || d.message.includes('unused'))
    );

    console.log('Unused variable warnings:', unusedWarnings);

    // Both functions are used in template literal, neither should be marked as unused
    const get_error_codeUnused = unusedWarnings.find(d => d.message.includes('get_error_code'));
    const get_error_messageUnused = unusedWarnings.find(d => d.message.includes('get_error_message'));

    expect(get_error_codeUnused).toBeUndefined();
    expect(get_error_messageUnused).toBeUndefined();

    console.log('✓ Multiple embedded expressions in template literals are all marked as used');
  } finally {
    server.shutdown();
  }
});
