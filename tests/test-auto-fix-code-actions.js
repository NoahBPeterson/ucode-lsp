const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createLSPTestServer } = require('./lsp-test-helpers');

describe('Auto-Fix Code Actions Tests', function() {
  this.timeout(15000); // 15 second timeout for LSP tests

  let lspServer;
  let getDiagnostics;
  let getCodeActions;

  before(async function() {
    lspServer = createLSPTestServer({
      capabilities: {
        textDocument: {
          codeAction: {
            dynamicRegistration: false,
            codeActionLiteralSupport: {
              codeActionKind: {
                valueSet: ['quickfix']
              }
            }
          }
        }
      }
    });
    await lspServer.initialize();
    getDiagnostics = lspServer.getDiagnostics;
    
    getCodeActions = lspServer.getCodeActions;
  });

  after(function() {
    if (lspServer) {
      lspServer.shutdown();
    }
  });

  describe('Auto-Fix Code Actions', function() {
    let diagnostics;
    const testFilePath = path.join(__dirname, 'test-auto-fix.uc');

    before(async function() {
      if (!fs.existsSync(testFilePath)) {
        throw new Error(`Test file does not exist: ${testFilePath}`);
      }
      
      const testContent = fs.readFileSync(testFilePath, 'utf8');
      diagnostics = await getDiagnostics(testContent, testFilePath);
      
      console.log(`\nTotal diagnostics for auto-fix test: ${diagnostics.length}`);
      diagnostics.forEach((d, i) => {
        console.log(`  [${i}] Line ${d.range.start.line}: "${d.message}" (severity: ${d.severity}, source: ${d.source})`);
      });
    });

    it('should provide code actions for ucode-semantic diagnostics', async function() {
      // Find a ucode-semantic diagnostic
      const semanticDiagnostics = diagnostics.filter(d => d.source === 'ucode-semantic');
      assert(semanticDiagnostics.length > 0, 'Should have at least one ucode-semantic diagnostic');
      
      const diagnostic = semanticDiagnostics[0];
      const codeActions = await getCodeActions(testFilePath, [diagnostic], diagnostic.range.start.line, diagnostic.range.start.character);
      
      console.log(`\nCode actions for line ${diagnostic.range.start.line}:`, codeActions);
      
      assert(Array.isArray(codeActions), 'Code actions should be an array');
      assert(codeActions.length > 0, 'Should provide at least one code action');
      
      const disableAction = codeActions.find(action => 
        action.title === 'Disable ucode-lsp for this line' && 
        action.kind === 'quickfix'
      );
      
      assert(disableAction, 'Should provide a disable comment code action');
      assert(disableAction.edit, 'Code action should have edit');
      assert(disableAction.edit.changes, 'Code action should have changes');
    });

    it('should have correct text edit for disable comment', async function() {
      const semanticDiagnostics = diagnostics.filter(d => d.source === 'ucode-semantic');
      const diagnostic = semanticDiagnostics[0];
      const codeActions = await getCodeActions(testFilePath, [diagnostic], diagnostic.range.start.line, diagnostic.range.start.character);
      
      const disableAction = codeActions.find(action => action.title === 'Disable ucode-lsp for this line');
      assert(disableAction, 'Should have disable action');
      
      const changes = disableAction.edit.changes;
      const fileUri = `file://${testFilePath}`;
      assert(changes[fileUri], 'Should have changes for the test file');
      
      const textEdits = changes[fileUri];
      assert(Array.isArray(textEdits), 'Should have text edits array');
      assert(textEdits.length > 0, 'Should have at least one text edit');
      
      const edit = textEdits[0];
      assert.strictEqual(edit.newText, ' // ucode-lsp disable', 'Should insert disable comment');
      assert.strictEqual(edit.range.start.line, diagnostic.range.start.line, 'Should edit the correct line');
    });

    it('should not provide code actions for lines that already have disable comments', async function() {
      // Test with content that already has disable comment
      const testContentWithDisable = `
let errorVar = undefinedFunc(); // ucode-lsp disable
let anotherError = undefinedVar2();
      `;
      
      const uniqueFileName = `/tmp/test-with-disable-${Date.now()}.uc`;
      const diagnosticsWithDisable = await getDiagnostics(testContentWithDisable, uniqueFileName);
      
      // Find diagnostic on line with disable comment (should be none due to suppression)
      // But if any exist from other sources, code action should not be provided
      const line0Diagnostics = diagnosticsWithDisable.filter(d => d.range.start.line === 1);
      
      if (line0Diagnostics.length > 0) {
        const codeActions = await getCodeActions(uniqueFileName, line0Diagnostics, 1, 0);
        
        const disableActions = codeActions.filter(action => action.title === 'Disable ucode-lsp for this line');
        assert.strictEqual(disableActions.length, 0, 'Should not provide disable action for line that already has disable comment');
      }
    });

    it('should provide separate code actions for multiple diagnostics', async function() {
      // Find multiple diagnostics if available
      const semanticDiagnostics = diagnostics.filter(d => d.source === 'ucode-semantic');
      
      if (semanticDiagnostics.length > 1) {
        // Test with multiple diagnostics
        const multipleDiagnostics = semanticDiagnostics.slice(0, 2);
        const firstDiagnostic = multipleDiagnostics[0];
        
        const codeActions = await getCodeActions(testFilePath, multipleDiagnostics, firstDiagnostic.range.start.line, firstDiagnostic.range.start.character);
        
        const disableActions = codeActions.filter(action => action.title === 'Disable ucode-lsp for this line');
        assert(disableActions.length >= 1, 'Should provide disable actions for multiple diagnostics');
      }
    });
  });
});