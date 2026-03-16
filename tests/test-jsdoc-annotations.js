const assert = require('assert');
const { createLSPTestServer } = require('./lsp-test-helpers');

describe('JSDoc Type Annotations', function() {
  this.timeout(15000);

  let lspServer;
  let getDiagnostics;
  let getHover;
  let getCompletions;

  before(async function() {
    lspServer = createLSPTestServer();
    await lspServer.initialize();
    getDiagnostics = lspServer.getDiagnostics;
    getHover = lspServer.getHover;
    getCompletions = lspServer.getCompletions;
  });

  after(function() {
    if (lspServer) {
      lspServer.shutdown();
    }
  });

  // === Parser Tests ===

  describe('Parser: JSDoc attachment', () => {
    it('should parse JSDoc before function declaration without errors', async () => {
      const diagnostics = await getDiagnostics(`
        /** @param {string} x */
        function foo(x) {
          return x;
        }
      `, '/tmp/jsdoc-test.uc');
      const errors = diagnostics.filter(d => d.severity === 1);
      assert.strictEqual(errors.length, 0, 'Should not have parse errors for JSDoc');
    });

    it('should not treat regular block comments as JSDoc', async () => {
      const diagnostics = await getDiagnostics(`
        /* @param {string} x */
        function foo(x) {
          return x;
        }
      `, '/tmp/jsdoc-test2.uc');
      // Regular comment should NOT apply JSDoc types
      const hover = await getHover(`
        /* @param {string} x */
        function foo(x) {
          return x;
        }
      `, 3, 22, '/tmp/jsdoc-test2b.uc'); // hover over 'x' in function body
      // x should still be unknown since it's not a JSDoc comment
      if (hover && hover.contents) {
        const content = typeof hover.contents === 'string' ? hover.contents : hover.contents.value || '';
        assert.ok(!content.includes('string') || content.includes('unknown'),
          'Regular comments should not apply JSDoc type annotations');
      }
    });

    it('should handle JSDoc on variable declaration with function expression', async () => {
      const diagnostics = await getDiagnostics(`
        /** @param {string} name */
        let greet = function(name) {
          return "Hello " + name;
        };
      `, '/tmp/jsdoc-varfn-test.uc');
      const errors = diagnostics.filter(d => d.severity === 1);
      assert.strictEqual(errors.length, 0, 'Should not have parse errors');
    });

    it('should handle JSDoc on variable declaration with arrow function', async () => {
      const diagnostics = await getDiagnostics(`
        /** @param {string} name */
        let greet = (name) => "Hello " + name;
      `, '/tmp/jsdoc-arrow-test.uc');
      const errors = diagnostics.filter(d => d.severity === 1);
      assert.strictEqual(errors.length, 0, 'Should not have parse errors');
    });
  });

  // === Type Resolution Tests ===

  describe('Type resolution via JSDoc', () => {
    it('should resolve primitive type string from @param', async () => {
      const hover = await getHover(`
        /** @param {string} x */
        function foo(x) {
          return x;
        }
      `, 3, 18, '/tmp/jsdoc-prim-test.uc'); // hover over 'x' param usage in return
      if (hover && hover.contents) {
        const content = typeof hover.contents === 'string' ? hover.contents : hover.contents.value || '';
        assert.ok(content.includes('string'), `Hover should show string type, got: ${content}`);
      }
    });

    it('should resolve module:fs type from @param', async () => {
      const hover = await getHover(`
        /** @param {module:fs} fs_mod */
        function helper(fs_mod) {
          return fs_mod;
        }
      `, 3, 18, '/tmp/jsdoc-module-test.uc'); // hover over 'fs_mod'
      if (hover && hover.contents) {
        const content = typeof hover.contents === 'string' ? hover.contents : hover.contents.value || '';
        assert.ok(content.includes('fs'), `Hover should show fs module type, got: ${content}`);
      }
    });

    it('should resolve uci.cursor object type from @param', async () => {
      const hover = await getHover(`
        /** @param {uci.cursor} cursor */
        function helper(cursor) {
          return cursor;
        }
      `, 3, 18, '/tmp/jsdoc-obj-test.uc'); // hover over 'cursor'
      if (hover && hover.contents) {
        const content = typeof hover.contents === 'string' ? hover.contents : hover.contents.value || '';
        assert.ok(content.includes('uci.cursor'), `Hover should show uci.cursor type, got: ${content}`);
      }
    });

    it('should resolve multiple @param tags', async () => {
      const code = `
        /**
         * @param {string} name
         * @param {integer} count
         */
        function repeat(name, count) {
          return name;
        }
      `;
      const hoverName = await getHover(code, 6, 18, '/tmp/jsdoc-multi-test.uc');
      if (hoverName && hoverName.contents) {
        const content = typeof hoverName.contents === 'string' ? hoverName.contents : hoverName.contents.value || '';
        assert.ok(content.includes('string'), `name should be string, got: ${content}`);
      }
    });

    it('should resolve optional type (type?) as union with null', async () => {
      const hover = await getHover(`
        /** @param {string?} x */
        function foo(x) {
          return x;
        }
      `, 3, 18, '/tmp/jsdoc-optional-test.uc');
      if (hover && hover.contents) {
        const content = typeof hover.contents === 'string' ? hover.contents : hover.contents.value || '';
        assert.ok(content.includes('string') && content.includes('null'),
          `Optional type should show string | null, got: ${content}`);
      }
    });

    it('should resolve union type string|number', async () => {
      const hover = await getHover(`
        /** @param {string|number} x */
        function foo(x) {
          return x;
        }
      `, 3, 18, '/tmp/jsdoc-union-test.uc');
      if (hover && hover.contents) {
        const content = typeof hover.contents === 'string' ? hover.contents : hover.contents.value || '';
        assert.ok(content.includes('string'), `Union should include string, got: ${content}`);
      }
    });
  });

  // === Diagnostic Tests ===

  describe('JSDoc diagnostics', () => {
    it('should warn on unknown type in @param (UC7001)', async () => {
      const diagnostics = await getDiagnostics(`
        /** @param {foobar} x */
        function foo(x) {
          return x;
        }
      `, '/tmp/jsdoc-diag-unknown.uc');
      const warnings = diagnostics.filter(d => d.severity === 2 && d.message.includes("Unknown type"));
      assert.ok(warnings.length >= 1, `Should have unknown type warning, got ${diagnostics.map(d => d.message).join('; ')}`);
    });

    it('should warn when @param name does not match any parameter (UC7002)', async () => {
      const diagnostics = await getDiagnostics(`
        /** @param {string} wrongName */
        function foo(x) {
          return x;
        }
      `, '/tmp/jsdoc-diag-mismatch.uc');
      const warnings = diagnostics.filter(d => d.severity === 2 && d.message.includes("does not match"));
      assert.ok(warnings.length >= 1, `Should have param mismatch warning, got ${diagnostics.map(d => d.message).join('; ')}`);
    });

    it('should not warn for valid JSDoc annotations', async () => {
      const diagnostics = await getDiagnostics(`
        /** @param {string} x */
        function foo(x) {
          return x;
        }
      `, '/tmp/jsdoc-diag-valid.uc');
      const jsdocWarnings = diagnostics.filter(d => d.message.includes('Unknown type') || d.message.includes('does not match'));
      assert.strictEqual(jsdocWarnings.length, 0, `Should have no JSDoc type/mismatch warnings, got: ${jsdocWarnings.map(d => d.message).join('; ')}`);
    });
  });

  // === Hover Tests ===

  describe('JSDoc description in hover', () => {
    it('should show JSDoc description text in hover', async () => {
      const hover = await getHover(`
        /** @param {string} name - The user's name */
        function greet(name) {
          return name;
        }
      `, 3, 18, '/tmp/jsdoc-hover-desc.uc');
      if (hover && hover.contents) {
        const content = typeof hover.contents === 'string' ? hover.contents : hover.contents.value || '';
        assert.ok(content.includes("user's name"), `Hover should include description, got: ${content}`);
      }
    });
  });

  // === UC7003: Missing JSDoc diagnostic ===

  describe('UC7003: Missing JSDoc annotation diagnostic', () => {
    it('should warn in strict mode when function has unknown-typed params', async () => {
      const diagnostics = await getDiagnostics(`'use strict';
        function create_pbr(fs_mod, uci_mod, ubus_mod) {
          return fs_mod;
        }
      `, '/tmp/jsdoc-uc7003-test.uc');
      const missingAnnotations = diagnostics.filter(d => d.message.includes('unknown type'));
      assert.ok(missingAnnotations.length >= 1, `Should have UC7003 warning in strict mode, got: ${diagnostics.map(d => d.message).join('; ')}`);
      assert.ok(missingAnnotations[0].message.includes('fs_mod'), 'Should mention param names');
    });

    it('should NOT warn without strict mode', async () => {
      const diagnostics = await getDiagnostics(`
        function create_pbr(fs_mod, uci_mod, ubus_mod) {
          return fs_mod;
        }
      `, '/tmp/jsdoc-uc7003-nostrict.uc');
      const missingAnnotations = diagnostics.filter(d => d.code === 'UC7003');
      assert.strictEqual(missingAnnotations.length, 0, 'Should not emit UC7003 without use strict');
    });

    it('should not warn when JSDoc is present (strict mode)', async () => {
      const diagnostics = await getDiagnostics(`'use strict';
        /** @param {fs} fs_mod */
        function helper(fs_mod) {
          return fs_mod;
        }
      `, '/tmp/jsdoc-uc7003-present.uc');
      const missingAnnotations = diagnostics.filter(d => d.message.includes('unknown type'));
      assert.strictEqual(missingAnnotations.length, 0, 'Should not warn when JSDoc is present');
    });

    it('should not warn for functions with zero params', async () => {
      const diagnostics = await getDiagnostics(`'use strict';
        function noop() {
          return null;
        }
      `, '/tmp/jsdoc-uc7003-noparam.uc');
      const missingAnnotations = diagnostics.filter(d => d.message.includes('unknown type'));
      assert.strictEqual(missingAnnotations.length, 0, 'Should not warn for parameterless functions');
    });
  });

  // === Bare module name tests ===

  describe('Bare module name resolution', () => {
    it('should resolve {fs} as fs module type (no module: prefix needed)', async () => {
      const hover = await getHover(`
        /** @param {fs} fs_mod */
        function helper(fs_mod) {
          return fs_mod;
        }
      `, 3, 18, '/tmp/jsdoc-bare-mod.uc');
      if (hover && hover.contents) {
        const content = typeof hover.contents === 'string' ? hover.contents : hover.contents.value || '';
        assert.ok(content.includes('fs'), `Bare 'fs' should resolve to fs module, got: ${content}`);
      }
    });

    it('should resolve {uci} as uci module type', async () => {
      const hover = await getHover(`
        /** @param {uci} uci_mod */
        function helper(uci_mod) {
          return uci_mod;
        }
      `, 3, 18, '/tmp/jsdoc-bare-uci.uc');
      if (hover && hover.contents) {
        const content = typeof hover.contents === 'string' ? hover.contents : hover.contents.value || '';
        assert.ok(content.includes('uci'), `Bare 'uci' should resolve to uci module, got: ${content}`);
      }
    });

    it('should not produce UC7001 for bare known module names', async () => {
      const diagnostics = await getDiagnostics(`
        /** @param {fs} fs_mod */
        function helper(fs_mod) {
          return fs_mod;
        }
      `, '/tmp/jsdoc-bare-noerr.uc');
      const unknownTypeWarnings = diagnostics.filter(d => d.message.includes('Unknown type'));
      assert.strictEqual(unknownTypeWarnings.length, 0, `Should not warn about known module 'fs', got: ${unknownTypeWarnings.map(d => d.message).join('; ')}`);
    });
  });

  // === require() fallback type inference ===

  describe('require() returns known module type', () => {
    it('should infer fs module type from param || require("fs")', async () => {
      const hover = await getHover(`
        /** @param {fs} fs_mod */
        function helper(fs_mod) {
          let _fs = fs_mod || require('fs');
          return _fs;
        }
      `, 4, 18, '/tmp/jsdoc-require-or.uc'); // hover over '_fs'
      if (hover && hover.contents) {
        const content = typeof hover.contents === 'string' ? hover.contents : hover.contents.value || '';
        assert.ok(content.includes('fs'), `_fs should have fs module type, got: ${content}`);
        assert.ok(!content.includes('unknown'), `_fs should NOT include unknown, got: ${content}`);
      }
    });

    it('should infer uci module type from param || require("uci")', async () => {
      const hover = await getHover(`
        /** @param {uci} uci_mod */
        function helper(uci_mod) {
          let _uci = uci_mod || require('uci');
          return _uci;
        }
      `, 4, 18, '/tmp/jsdoc-require-uci.uc'); // hover over '_uci'
      if (hover && hover.contents) {
        const content = typeof hover.contents === 'string' ? hover.contents : hover.contents.value || '';
        assert.ok(content.includes('uci'), `_uci should have uci module type, got: ${content}`);
        assert.ok(!content.includes('unknown'), `_uci should NOT include unknown, got: ${content}`);
      }
    });

    it('should infer module type from direct require() call', async () => {
      const hover = await getHover(`
        function helper() {
          let _fs = require('fs');
          return _fs;
        }
      `, 3, 18, '/tmp/jsdoc-require-direct.uc');
      if (hover && hover.contents) {
        const content = typeof hover.contents === 'string' ? hover.contents : hover.contents.value || '';
        assert.ok(content.includes('fs'), `_fs should have fs module type, got: ${content}`);
      }
    });
  });

  // === Backward Compatibility Tests ===

  describe('Backward compatibility', () => {
    it('should keep parameters as UNKNOWN when no JSDoc present', async () => {
      const hover = await getHover(`
        function foo(x) {
          return x;
        }
      `, 2, 18, '/tmp/jsdoc-compat-test.uc');
      if (hover && hover.contents) {
        const content = typeof hover.contents === 'string' ? hover.contents : hover.contents.value || '';
        assert.ok(content.includes('unknown'), `Without JSDoc, param should be unknown, got: ${content}`);
      }
      // UC7003 should NOT be present without 'use strict'
      const diagnostics = await getDiagnostics(`
        function foo(x) {
          return x;
        }
      `, '/tmp/jsdoc-compat-test2.uc');
      const uc7003 = diagnostics.filter(d => d.code === 'UC7003');
      assert.strictEqual(uc7003.length, 0, 'UC7003 should not appear without use strict');
    });

    it('should not crash on malformed JSDoc', async () => {
      const diagnostics = await getDiagnostics(`
        /** @param */
        function foo(x) {
          return x;
        }
      `, '/tmp/jsdoc-malformed.uc');
      // Should not throw, just possibly no types applied
      const errors = diagnostics.filter(d => d.severity === 1);
      assert.strictEqual(errors.length, 0, 'Should not have parse errors from malformed JSDoc');
    });

    it('should not crash on JSDoc with empty type', async () => {
      const diagnostics = await getDiagnostics(`
        /** @param {} x */
        function foo(x) {
          return x;
        }
      `, '/tmp/jsdoc-empty-type.uc');
      const errors = diagnostics.filter(d => d.severity === 1);
      assert.strictEqual(errors.length, 0, 'Should not crash on empty type');
    });
  });

  // === Bare syntax tests ===

  describe('Bare @param syntax', () => {
    it('should support @param name type syntax (no braces)', async () => {
      const hover = await getHover(`
        /** @param x string */
        function foo(x) {
          return x;
        }
      `, 3, 18, '/tmp/jsdoc-bare-test.uc');
      if (hover && hover.contents) {
        const content = typeof hover.contents === 'string' ? hover.contents : hover.contents.value || '';
        assert.ok(content.includes('string'), `Bare syntax should resolve type, got: ${content}`);
      }
    });

    it('should support @param name type - description syntax', async () => {
      const hover = await getHover(`
        /** @param x string - The value */
        function foo(x) {
          return x;
        }
      `, 3, 18, '/tmp/jsdoc-bare-desc-test.uc');
      if (hover && hover.contents) {
        const content = typeof hover.contents === 'string' ? hover.contents : hover.contents.value || '';
        assert.ok(content.includes('string'), `Bare syntax with desc should resolve type, got: ${content}`);
        assert.ok(content.includes('The value'), `Should include description, got: ${content}`);
      }
    });
  });

  // === import() type expression tests ===

  describe('import() type expressions', () => {
    const fs = require('fs');
    const path = require('path');
    const tmpDir = path.join(require('os').tmpdir(), 'jsdoc-import-test');
    const moduleFile = path.join(tmpDir, 'mymod.uc');
    const consumerFile = path.join(tmpDir, 'consumer.uc');

    before(function() {
      // Create temp module file for cross-file resolution
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(moduleFile, `
const pkg = {
  name: 'test-pkg',
  version: '1.0',
  enabled: true,
};

function helper(x) {
  return x + 1;
}

export default { pkg, helper };
`);
    });

    after(function() {
      try { fs.unlinkSync(moduleFile); } catch(e) {}
      try { fs.unlinkSync(consumerFile); } catch(e) {}
      try { fs.rmdirSync(tmpDir); } catch(e) {}
    });

    it('should resolve import() type for builtin module', async () => {
      const hover = await getHover(`
        /** @param {import('fs')} fs_mod */
        function foo(fs_mod) {
          return fs_mod;
        }
      `, 3, 18, '/tmp/jsdoc-import-builtin.uc');
      if (hover && hover.contents) {
        const content = typeof hover.contents === 'string' ? hover.contents : hover.contents.value || '';
        assert.ok(content.includes('fs module'), `import('fs') should resolve to fs module, got: ${content}`);
      }
    });

    it('should resolve import() with property for builtin object type', async () => {
      const hover = await getHover(`
        /** @param {import('fs').file} f */
        function foo(f) {
          return f;
        }
      `, 3, 18, '/tmp/jsdoc-import-builtin-obj.uc');
      if (hover && hover.contents) {
        const content = typeof hover.contents === 'string' ? hover.contents : hover.contents.value || '';
        assert.ok(content.includes('fs.file'), `import('fs').file should resolve to fs.file, got: ${content}`);
      }
    });

    it('should resolve import() for user module default export', async () => {
      const content = `/** @param {import('mymod')} mod */
function use_mod(mod) {
  return mod;
}`;
      const hover = await getHover(content, consumerFile, 2, 10);
      if (hover && hover.contents) {
        const text = typeof hover.contents === 'string' ? hover.contents : hover.contents.value || '';
        assert.ok(text.includes('object'), `import('mymod') should resolve to object type, got: ${text}`);
      }
    });

    it('should resolve import().property for user module and enable member completions', async () => {
      const content = `/** @param {import('mymod').pkg} p */
function use_pkg(p) {
  let n = p.name;
  return n;
}`;
      // Check hover on 'p' parameter (line 2: "  let n = p.name;", char 9 = 'p')
      const hover = await getHover(content, consumerFile, 2, 9);
      if (hover && hover.contents) {
        const text = typeof hover.contents === 'string' ? hover.contents : hover.contents.value || '';
        assert.ok(text.includes('object'), `import('mymod').pkg should be object, got: ${text}`);
      }
      // Check that no UC7001 diagnostic for the import() type
      const diagnostics = await getDiagnostics(content, consumerFile);
      const uc7001 = diagnostics.filter(d => d.code === 'UC7001');
      assert.strictEqual(uc7001.length, 0, 'import() type should not trigger UC7001');
    });

    it('should produce UC7001 for import() with unknown module', async () => {
      const diagnostics = await getDiagnostics(`
        /** @param {import('nonexistent').foo} x */
        function foo(x) {
          return x;
        }
      `, '/tmp/jsdoc-import-unknown.uc');
      const uc7001 = diagnostics.filter(d => d.code === 'UC7001');
      assert.ok(uc7001.length > 0, 'Should have UC7001 for unresolvable import()');
    });

    it('should parse import() type expression regex correctly', () => {
      // Test the regex pattern used by parseImportTypeExpression
      const regex = /^import\(\s*['"]([^'"]+)['"]\s*\)(?:\.(\w+))?$/;

      let m = regex.exec("import('fs')");
      assert.ok(m, 'Should match import("fs")');
      assert.strictEqual(m[1], 'fs');
      assert.strictEqual(m[2], undefined);

      m = regex.exec("import('pkg').pkg");
      assert.ok(m, 'Should match import("pkg").pkg');
      assert.strictEqual(m[1], 'pkg');
      assert.strictEqual(m[2], 'pkg');

      m = regex.exec("import('./relative/path').Type");
      assert.ok(m, 'Should match relative path');
      assert.strictEqual(m[1], './relative/path');
      assert.strictEqual(m[2], 'Type');

      m = regex.exec("string");
      assert.strictEqual(m, null, 'Should not match plain type');

      m = regex.exec('import("fs").file');
      assert.ok(m, 'Should match double quotes');
      assert.strictEqual(m[1], 'fs');
      assert.strictEqual(m[2], 'file');
    });
  });

  // === @typedef tests ===

  describe('@typedef support', () => {
    it('should resolve @typedef with @property types', async () => {
      const code = `
/**
 * @typedef {object} PkgInfo
 * @property {string} name
 * @property {string} version
 * @property {boolean} enabled
 */

/** @param {PkgInfo} pkg */
function use_pkg(pkg) {
  let n = pkg.name;
  return n;
}`;
      // Should not have UC7001 for PkgInfo
      const diagnostics = await getDiagnostics(code, '/tmp/jsdoc-typedef-test.uc');
      const uc7001 = diagnostics.filter(d => d.code === 'UC7001');
      assert.strictEqual(uc7001.length, 0, 'PkgInfo typedef should be recognized, not UC7001');

      // Hover on 'pkg' in "let n = pkg.name;" (line 10, char 10)
      const hover = await getHover(code, '/tmp/jsdoc-typedef-test.uc', 10, 10);
      if (hover && hover.contents) {
        const text = typeof hover.contents === 'string' ? hover.contents : hover.contents.value || '';
        assert.ok(text.includes('object'), `Typedef param should be object, got: ${text}`);
      }
    });

    it('should emit UC7001 for undefined typedef reference', async () => {
      const code = `
/** @param {NoSuchType} x */
function foo(x) {
  return x;
}`;
      const diagnostics = await getDiagnostics(code, '/tmp/jsdoc-typedef-unknown.uc');
      const uc7001 = diagnostics.filter(d => d.code === 'UC7001');
      assert.ok(uc7001.length > 0, 'Should have UC7001 for undefined typedef name');
    });

    it('should parse @typedef and @property tags', async () => {
      const code = `
/**
 * @typedef {object} Config
 * @property {string} host
 * @property {integer} port
 */

/** @param {Config} cfg */
function connect(cfg) {
  let h = cfg.host;
  return h;
}`;
      const diagnostics = await getDiagnostics(code, '/tmp/jsdoc-typedef-props.uc');
      const uc7001 = diagnostics.filter(d => d.code === 'UC7001');
      assert.strictEqual(uc7001.length, 0, 'Config typedef with properties should be recognized');
    });
  });
});
