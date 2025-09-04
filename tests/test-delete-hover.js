const assert = require('assert');
const { createLSPTestServer } = require('./lsp-test-helpers');

describe('Delete Method Hover Tests', function() {
  this.timeout(15000); // 15 second timeout for LSP tests

  let lspServer;
  let getHover;

  before(async function() {
    lspServer = createLSPTestServer();
    await lspServer.initialize();
    getHover = lspServer.getHover;
  });

  after(function() {
    if (lspServer) {
      lspServer.shutdown();
    }
  });

  describe('Uloop Delete Method Hover', function() {
    const testContent = `import * as uloop from 'uloop';

let handle = uloop.handle(3, () => {}, uloop.ULOOP_READ);
let process = uloop.process("/bin/sleep", ["1"], {}, (exitCode) => {});
let signal = uloop.signal("SIGUSR1", () => {});

handle.delete();
process.delete();
signal.delete();`;

    it('should provide hover information for handle.delete()', async function() {
      const lines = testContent.split('\n');
      let handleDeleteLine = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('handle.delete()')) {
          handleDeleteLine = i;
          break;
        }
      }

      const handleDeleteChar = lines[handleDeleteLine].indexOf('delete') + 2; // Middle of "delete"
      
      const hoverResult = await getHover(testContent, `/tmp/test-delete-hover-${Date.now()}.uc`, handleDeleteLine, handleDeleteChar);
      
      assert(hoverResult, 'Should return hover information');
      assert(hoverResult.contents && hoverResult.contents.value, 'Should have hover content');
      
      const content = hoverResult.contents.value || JSON.stringify(hoverResult.contents);
      assert(content.includes('delete'), 'Should mention delete method');
      assert(content.includes('Unregisters') || content.includes('unregisters'), 'Should have proper description');
    });

    it('should provide hover information for process.delete()', async function() {
      const lines = testContent.split('\n');
      let processDeleteLine = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('process.delete()')) {
          processDeleteLine = i;
          break;
        }
      }

      const processDeleteChar = lines[processDeleteLine].indexOf('delete') + 2;
      
      const hoverResult = await getHover(testContent, `/tmp/test-delete-hover-process-${Date.now()}.uc`, processDeleteLine, processDeleteChar);
      
      assert(hoverResult, 'Should return hover information');
      assert(hoverResult.contents && hoverResult.contents.value, 'Should have hover content');
      
      const content = hoverResult.contents.value || JSON.stringify(hoverResult.contents);
      assert(content.includes('delete'), 'Should mention delete method');
    });

    it('should provide hover information for signal.delete()', async function() {
      const lines = testContent.split('\n');
      let signalDeleteLine = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('signal.delete()')) {
          signalDeleteLine = i;
          break;
        }
      }

      const signalDeleteChar = lines[signalDeleteLine].indexOf('delete') + 2;
      
      const hoverResult = await getHover(testContent, `/tmp/test-delete-hover-signal-${Date.now()}.uc`, signalDeleteLine, signalDeleteChar);
      
      assert(hoverResult, 'Should return hover information');
      assert(hoverResult.contents && hoverResult.contents.value, 'Should have hover content');
      
      const content = hoverResult.contents.value || JSON.stringify(hoverResult.contents);
      assert(content.includes('delete'), 'Should mention delete method');
    });

    it('should have consistent hover content format', async function() {
      const lines = testContent.split('\n');
      let handleDeleteLine = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('handle.delete()')) {
          handleDeleteLine = i;
          break;
        }
      }

      const handleDeleteChar = lines[handleDeleteLine].indexOf('delete') + 2;
      
      const hoverResult = await getHover(testContent, `/tmp/test-delete-hover-format-${Date.now()}.uc`, handleDeleteLine, handleDeleteChar);
      
      assert(hoverResult, 'Should return hover information');
      assert(hoverResult.contents.kind === 'markdown', 'Should use markdown format');
      
      const content = hoverResult.contents.value;
      assert(content.includes('**'), 'Should use markdown formatting');
      assert(content.includes('delete'), 'Should mention the method name');
    });
  });
});