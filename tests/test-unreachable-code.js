const assert = require('assert');
const { createLSPTestServer } = require('./lsp-test-helpers');

describe('Unreachable Code Detection (UC4001)', function() {
  this.timeout(15000);

  let lspServer;
  let getDiagnostics;

  before(async function() {
    lspServer = createLSPTestServer();
    await lspServer.initialize();
    getDiagnostics = lspServer.getDiagnostics;
  });

  after(function() {
    if (lspServer) {
      lspServer.shutdown();
    }
  });

  async function getUnreachable(code, filename = '/tmp/unreachable-test.uc') {
    const diagnostics = await getDiagnostics(code, filename);
    return diagnostics.filter(d => d.code === 'UC4001');
  }

  describe('After return', () => {
    it('should flag code after return statement', async () => {
      const diags = await getUnreachable(`
        function foo() {
          return 1;
          let x = 2;
        }
      `);
      assert.strictEqual(diags.length, 1, 'Should flag unreachable code after return');
      assert.match(diags[0].message, /[Uu]nreachable/);
    });

    it('should not flag code in separate branch after return', async () => {
      const diags = await getUnreachable(`
        function foo(x) {
          if (x) {
            return 1;
          }
          let y = 2;
          return y;
        }
      `);
      // y = 2 is reachable via the else path
      const afterReturnDiags = diags.filter(d =>
        d.range.start.line >= 4 && d.range.start.line <= 5
      );
      assert.strictEqual(afterReturnDiags.length, 0, 'Code after conditional return should be reachable');
    });
  });

  describe('After break/continue', () => {
    it('should flag code after break in loop', async () => {
      const diags = await getUnreachable(`
        while (true) {
          break;
          let x = 1;
        }
      `);
      assert.strictEqual(diags.length >= 1, true, 'Should flag unreachable code after break');
    });

    it('should flag code after continue in loop', async () => {
      const diags = await getUnreachable(`
        while (true) {
          continue;
          let x = 1;
        }
      `);
      assert.strictEqual(diags.length >= 1, true, 'Should flag unreachable code after continue');
    });
  });

  describe('After die()/exit()', () => {
    it('should flag code after die()', async () => {
      const diags = await getUnreachable(`
        die("fatal error");
        let x = 1;
      `);
      assert.strictEqual(diags.length >= 1, true, 'Should flag unreachable code after die()');
    });

    it('should flag code after exit()', async () => {
      const diags = await getUnreachable(`
        exit(1);
        let x = 1;
      `);
      assert.strictEqual(diags.length >= 1, true, 'Should flag unreachable code after exit()');
    });
  });

  describe('No false positives', () => {
    it('should not flag reachable code in if/else', async () => {
      const diags = await getUnreachable(`
        let x = 1;
        if (x > 0) {
          x = 2;
        } else {
          x = 3;
        }
        let y = x;
      `);
      assert.strictEqual(diags.length, 0, 'No unreachable code in normal if/else');
    });

    it('should not flag code after conditional return', async () => {
      const diags = await getUnreachable(`
        function bar(x) {
          if (x) return 1;
          return 2;
        }
      `);
      // 'return 2' is reachable when x is falsy
      assert.strictEqual(diags.length, 0, 'return 2 is reachable via else path');
    });

    it('should not flag normal sequential code', async () => {
      const diags = await getUnreachable(`
        let a = 1;
        let b = 2;
        let c = a + b;
        printf("%d\\n", c);
      `);
      assert.strictEqual(diags.length, 0, 'Sequential code is always reachable');
    });
  });

  describe('Diagnostic properties', () => {
    it('should use Hint severity (faded text)', async () => {
      const diags = await getUnreachable(`
        function foo() {
          return 1;
          let x = 2;
        }
      `);
      assert.strictEqual(diags.length, 1);
      // DiagnosticSeverity.Hint = 4
      assert.strictEqual(diags[0].severity, 4, 'Severity should be Hint (4)');
    });

    it('should have Unnecessary tag', async () => {
      const diags = await getUnreachable(`
        function foo() {
          return 1;
          let x = 2;
        }
      `);
      assert.strictEqual(diags.length, 1);
      // DiagnosticTag.Unnecessary = 1
      assert.ok(diags[0].tags, 'Diagnostic should have tags');
      assert.ok(diags[0].tags.includes(1), 'Should include Unnecessary tag (1)');
    });
  });

  describe('Return type narrowing', () => {
    it('should not include unreachable return types in hover', async () => {
      const getHover = lspServer.getHover;
      const code = `
        function foo() {
          return 1;
          return "never";
        }
      `;
      // Hover over the function name to see its return type
      const hover = await getHover(code, '/tmp/unreachable-return.uc', 1, 17);
      assert.ok(hover, 'Should have hover info');
      const hoverText = hover.contents.value || hover.contents;
      // Return type should be int (from reachable return), not int | string
      assert.ok(!hoverText.includes('string'), `Return type should not include unreachable "string" type, got: ${hoverText}`);
    });
  });
});
