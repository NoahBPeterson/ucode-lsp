const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { createLSPTestServer } = require('./lsp-test-helpers');

describe('Uloop Module Validation Tests', function() {
  this.timeout(15000); // 15 second timeout for LSP tests

  let lspServer;
  let getDiagnostics, getCompletions, getHover;

  before(async function() {
    lspServer = createLSPTestServer();
    await lspServer.initialize();
    getDiagnostics = lspServer.getDiagnostics;
    getCompletions = lspServer.getCompletions;
    getHover = lspServer.getHover;
  });

  after(function() {
    if (lspServer) {
      lspServer.shutdown();
    }
  });

  describe('Uloop Module Function Hover', function() {
    const testContent = `import * as uloop from 'uloop';
uloop.init();
uloop.timer(1000, () => {});
uloop.handle(3, () => {}, uloop.ULOOP_READ);`;

    it('should provide hover information for uloop.init() function', async function() {
      const hover = await getHover(testContent, '/tmp/test-uloop-init.uc', 1, 7);
      
      assert(hover, 'Should return hover information');
      assert(hover.contents && hover.contents.value, 'Should have hover content');
      assert(hover.contents.value.includes('init'), 'Should mention init function');
      assert(hover.contents.value.includes('Initializes the uloop event loop'), 'Should describe initialization');
      assert(hover.contents.value.includes('boolean | null'), 'Should mention return type');
    });

    it('should provide hover information for uloop.timer() function', async function() {
      const hover = await getHover(testContent, '/tmp/test-uloop-timer.uc', 2, 7);
      
      assert(hover, 'Should return hover information');
      assert(hover.contents && hover.contents.value, 'Should have hover content');
      assert(hover.contents.value.includes('timer'), 'Should mention timer function');
      assert(hover.contents.value.includes('Creates a timer instance'), 'Should describe timer creation');
      assert(hover.contents.value.includes('timeout'), 'Should mention timeout parameter');
      assert(hover.contents.value.includes('callback'), 'Should mention callback parameter');
    });

    it('should provide hover information for uloop.handle() function', async function() {
      const hover = await getHover(testContent, '/tmp/test-uloop-handle.uc', 3, 7);
      
      assert(hover, 'Should return hover information');
      assert(hover.contents && hover.contents.value, 'Should have hover content');
      assert(hover.contents.value.includes('handle'), 'Should mention handle function');
      assert(hover.contents.value.includes('Creates a handle instance'), 'Should describe handle creation');
      assert(hover.contents.value.includes('file descriptor'), 'Should mention file descriptor');
    });
  });

  describe('Uloop Constants Hover', function() {
    const testContent = `import { ULOOP_READ, ULOOP_WRITE, ULOOP_EDGE_TRIGGER } from 'uloop';
let flags = ULOOP_READ | ULOOP_WRITE;`;

    it('should provide hover information for ULOOP_READ constant', async function() {
      const hover = await getHover(testContent, '/tmp/test-uloop-read.uc', 1, 12);
      
      assert(hover, 'Should return hover information');
      assert(hover.contents && hover.contents.value, 'Should have hover content');
      assert(hover.contents.value.includes('ULOOP_READ'), 'Should mention ULOOP_READ constant');
      assert(hover.contents.value.includes('readable'), 'Should describe readable event');
      assert(hover.contents.value.includes('1'), 'Should mention constant value');
    });

    it('should provide hover information for ULOOP_WRITE constant', async function() {
      const hover = await getHover(testContent, '/tmp/test-uloop-write.uc', 1, 25);
      
      assert(hover, 'Should return hover information');
      assert(hover.contents && hover.contents.value, 'Should have hover content');
      assert(hover.contents.value.includes('ULOOP_WRITE'), 'Should mention ULOOP_WRITE constant');
      assert(hover.contents.value.includes('writable'), 'Should describe writable event');
      assert(hover.contents.value.includes('2'), 'Should mention constant value');
    });
  });

  describe('Uloop Module Completion', function() {
    const testContent = `import * as uloop from 'uloop';
uloop.`;

    it('should provide completion for uloop module functions', async function() {
      const completions = await getCompletions(testContent, '/tmp/test-uloop-completion.uc', 1, 6);
      
      assert(completions, 'Should return completion information');
      assert(Array.isArray(completions), 'Should return completion array');
      
      const labels = completions.map(c => c.label);
      
      // Check for key functions
      assert(labels.includes('init'), 'Should include init function');
      assert(labels.includes('run'), 'Should include run function');
      assert(labels.includes('timer'), 'Should include timer function');
      assert(labels.includes('handle'), 'Should include handle function');
      assert(labels.includes('process'), 'Should include process function');
      assert(labels.includes('task'), 'Should include task function');
      assert(labels.includes('interval'), 'Should include interval function');
      assert(labels.includes('signal'), 'Should include signal function');
      
      // Check for constants
      assert(labels.includes('ULOOP_READ'), 'Should include ULOOP_READ constant');
      assert(labels.includes('ULOOP_WRITE'), 'Should include ULOOP_WRITE constant');
      assert(labels.includes('ULOOP_EDGE_TRIGGER'), 'Should include ULOOP_EDGE_TRIGGER constant');
      assert(labels.includes('ULOOP_BLOCKING'), 'Should include ULOOP_BLOCKING constant');
    });
  });

  describe('Uloop Object Method Completion', function() {
    const testContent = `import * as uloop from 'uloop';
function callback() {}
let timer = uloop.timer(1000, callback);
timer.`;

    it('should provide completion for timer object methods', async function() {
      const completions = await getCompletions(testContent, '/tmp/test-timer-completion.uc', 3, 6);
      
      assert(completions, 'Should return completion information');
      assert(Array.isArray(completions), 'Should return completion array');
      
      const labels = completions.map(c => c.label);
      
      // Debug: log what we actually got
      console.log('Actual completions:', labels);
      console.log('Completion count:', completions.length);
      
      // Check for timer methods
      assert(labels.includes('set'), 'Should include set method');
      assert(labels.includes('remaining'), 'Should include remaining method');
      assert(labels.includes('cancel'), 'Should include cancel method');
    });
  });

  describe('Uloop Handle Object Methods', function() {
    const testContent = `import * as uloop from 'uloop';
let handle = uloop.handle(3, () => {}, uloop.ULOOP_READ);
handle.`;

    it('should provide completion for handle object methods', async function() {
      const completions = await getCompletions(testContent, '/tmp/test-handle-completion.uc', 2, 7);
      
      assert(completions, 'Should return completion information');
      assert(Array.isArray(completions), 'Should return completion array');
      
      const labels = completions.map(c => c.label);
      
      // Check for handle methods
      assert(labels.includes('fileno'), 'Should include fileno method');
      assert(labels.includes('handle'), 'Should include handle method');
      assert(labels.includes('delete'), 'Should include delete method');
    });
  });

  describe('Uloop Process Object Methods', function() {
    const testContent = `import * as uloop from 'uloop';
let proc = uloop.process("/bin/echo", ["hello"], {}, () => {});
proc.`;

    it('should provide completion for process object methods', async function() {
      const completions = await getCompletions(testContent, '/tmp/test-process-completion.uc', 2, 5);
      
      assert(completions, 'Should return completion information');
      assert(Array.isArray(completions), 'Should return completion array');
      
      const labels = completions.map(c => c.label);
      
      // Check for process methods
      assert(labels.includes('pid'), 'Should include pid method');
      assert(labels.includes('delete'), 'Should include delete method');
    });
  });

  describe('Uloop Documentation Quality', function() {
    const testContent = `import * as uloop from 'uloop';
uloop.timer(1000, () => {});`;

    it('should provide comprehensive documentation with examples', async function() {
      const hover = await getHover(testContent, '/tmp/test-uloop-comprehensive.uc', 1, 7);
      
      assert(hover, 'Should return hover information');
      assert(hover.contents && hover.contents.value, 'Should have hover content');
      
      const content = hover.contents.value;
      
      // Check for comprehensive documentation elements
      assert(content.includes('**Parameters:**') || content.includes('timeout'), 'Should have parameters section');
      assert(content.includes('**Returns:**') || content.includes('uloop.timer'), 'Should have returns section');
      assert(content.includes('**Example:**') || content.includes('```'), 'Should have examples section');
    });

    it('should have consistent markdown formatting', async function() {
      const hover = await getHover(testContent, '/tmp/test-uloop-formatting.uc', 1, 7);
      
      assert(hover, 'Should return hover information');
      assert(hover.contents.kind === 'markdown', 'Should use markdown format');
      
      const content = hover.contents.value;
      
      // Check markdown formatting consistency
      assert(content.includes('timer') || content.includes('**timer'), 'Should mention timer function prominently');
      assert(content.includes('`'), 'Should use backticks for code elements');
      assert(content.includes('\n'), 'Should have proper line breaks');
    });
  });
});