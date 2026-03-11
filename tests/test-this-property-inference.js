// Test that `this` keyword resolves property types from the enclosing object literal.
// In ucode, `this` inside a function property of an object literal refers to that object.

const assert = require('assert');
const { createLSPTestServer } = require('./lsp-test-helpers');

function extractHoverText(hover) {
  if (!hover || !hover.contents) return '';
  const { contents } = hover;
  if (typeof contents === 'string') return contents;
  if (Array.isArray(contents)) return contents.map(e => (typeof e === 'string' ? e : e.value || '')).join('\n');
  return contents.value || '';
}

describe('This Property Type Inference', function() {
  this.timeout(15000);

  let lspServer, getHover, getDiagnostics;

  before(async function() {
    lspServer = createLSPTestServer();
    await lspServer.initialize();
    getHover = lspServer.getHover;
    getDiagnostics = lspServer.getDiagnostics;
  });

  after(function() {
    if (lspServer) lspServer.shutdown();
  });

  const testFile = '/tmp/test-this-inference.uc';

  // ── Example 1: Basic this.property with string literal ──────────
  it('should resolve this.name as string in object method', async function() {
    const code = `const obj = {
  name: 'hello',
  greet: function() {
    return this.name;
  },
};
let x = obj.greet();
print(x);
`;
    const lines = code.split('\n');
    // Hover on this.name inside the function (line 3, on "name" after "this.")
    const lineIdx = 3;
    const charIdx = lines[lineIdx].indexOf('this.name') + 5; // 'name' part
    const hover = await getHover(code, testFile, lineIdx, charIdx);
    const text = extractHoverText(hover);
    assert.ok(text.toLowerCase().includes('string'),
      `Expected 'string' for this.name, got: ${text}`);
  });

  // ── Example 2: this.property with integer ────────────────────────
  it('should resolve this.count as integer', async function() {
    const code = `const counter = {
  count: 0,
  increment: function() {
    this.count = this.count + 1;
    return this.count;
  },
};
print(counter.increment());
`;
    const lines = code.split('\n');
    const lineIdx = 4;
    const charIdx = lines[lineIdx].indexOf('this.count') + 5;
    const hover = await getHover(code, testFile, lineIdx, charIdx);
    const text = extractHoverText(hover);
    assert.ok(text.toLowerCase().includes('integer'),
      `Expected 'integer' for this.count, got: ${text}`);
  });

  // ── Example 3: this.property passed to builtin — no false warning ─
  it('should not warn when this.version (string) is passed to split()', async function() {
    const code = `const pkg = {
  version: 'dev-test',
  url: function(fragment) {
    return split(this.version, '-')[0];
  },
};
print(pkg.url('foo'));
`;
    const diags = await getDiagnostics(code, testFile);
    const splitWarnings = diags.filter(d =>
      d.message && d.message.includes('split') && d.message.includes('unknown')
    );
    assert.strictEqual(splitWarnings.length, 0,
      `split(this.version) should not warn about unknown arg, got: ${splitWarnings.map(d => d.message).join('; ')}`);
  });

  // ── Example 4: Multiple this.property accesses of different types ─
  it('should resolve multiple this properties with different types', async function() {
    const code = `const config = {
  host: 'localhost',
  port: 8080,
  enabled: true,
  describe: function() {
    let h = this.host;
    let p = this.port;
    let e = this.enabled;
    return h;
  },
};
print(config.describe());
`;
    const lines = code.split('\n');
    // Check this.host → string
    const hostLine = 5;
    const hostChar = lines[hostLine].indexOf('this.host') + 5;
    const hostHover = await getHover(code, testFile, hostLine, hostChar);
    assert.ok(extractHoverText(hostHover).toLowerCase().includes('string'),
      `Expected 'string' for this.host, got: ${extractHoverText(hostHover)}`);

    // Check this.port → integer
    const portLine = 6;
    const portChar = lines[portLine].indexOf('this.port') + 5;
    const portHover = await getHover(code, testFile, portLine, portChar);
    assert.ok(extractHoverText(portHover).toLowerCase().includes('integer'),
      `Expected 'integer' for this.port, got: ${extractHoverText(portHover)}`);
  });

  // ── Example 5: this.property where value is another object (nested) ─
  it('should resolve this.metadata as object', async function() {
    const code = `const app = {
  metadata: { author: 'test' },
  getMetadata: function() {
    return this.metadata;
  },
};
print(app.getMetadata());
`;
    const lines = code.split('\n');
    const lineIdx = 3;
    const charIdx = lines[lineIdx].indexOf('this.metadata') + 5;
    const hover = await getHover(code, testFile, lineIdx, charIdx);
    const text = extractHoverText(hover);
    assert.ok(text.toLowerCase().includes('object'),
      `Expected 'object' for this.metadata, got: ${text}`);
  });

  // ── Example 6: this.method — function property ──────────────────
  it('should resolve this.helper as function', async function() {
    const code = `const obj = {
  helper: function() { return 42; },
  run: function() {
    let fn = this.helper;
    return fn();
  },
};
print(obj.run());
`;
    const lines = code.split('\n');
    const lineIdx = 3;
    const charIdx = lines[lineIdx].indexOf('this.helper') + 5;
    const hover = await getHover(code, testFile, lineIdx, charIdx);
    const text = extractHoverText(hover);
    assert.ok(text.toLowerCase().includes('function'),
      `Expected 'function' for this.helper, got: ${text}`);
  });

  // ── Example 7: this in sprintf with multiple this accesses ──────
  it('should not warn when this.name and this.version are passed to sprintf()', async function() {
    const code = `const pkg = {
  name: 'pbr',
  version: '1.0',
  describe: function() {
    return sprintf("%s v%s", this.name, this.version);
  },
};
print(pkg.describe());
`;
    const diags = await getDiagnostics(code, testFile);
    const fmtWarnings = diags.filter(d =>
      d.message && d.message.includes('sprintf') && d.message.includes('unknown')
    );
    assert.strictEqual(fmtWarnings.length, 0,
      `sprintf with this.name/this.version should not warn, got: ${fmtWarnings.map(d => d.message).join('; ')}`);
  });

  // ── Example 8: this.property in conditional expression ───────────
  it('should resolve this.prefix in ternary expression', async function() {
    const code = `const nft = {
  prefix: 'pbr',
  table: 'fw4',
  getRule: function(usePrefix) {
    let p = usePrefix ? this.prefix : this.table;
    return p;
  },
};
print(nft.getRule(true));
`;
    const lines = code.split('\n');
    const lineIdx = 4;
    const charIdx = lines[lineIdx].indexOf('this.prefix') + 5;
    const hover = await getHover(code, testFile, lineIdx, charIdx);
    const text = extractHoverText(hover);
    assert.ok(text.toLowerCase().includes('string'),
      `Expected 'string' for this.prefix, got: ${text}`);
  });

  // ── Example 9: this.property used with string concatenation ──────
  it('should resolve this.name for string concat', async function() {
    const code = `const svc = {
  name: 'myservice',
  version: '2.0',
  fullName: function() {
    return this.name + ' ' + this.version;
  },
};
print(svc.fullName());
`;
    const lines = code.split('\n');
    const lineIdx = 4;
    const charIdx = lines[lineIdx].indexOf('this.name') + 5;
    const hover = await getHover(code, testFile, lineIdx, charIdx);
    const text = extractHoverText(hover);
    assert.ok(text.toLowerCase().includes('string'),
      `Expected 'string' for this.name, got: ${text}`);
  });

  // ── Example 10: this.property passed to length() ─────────────────
  it('should not warn when this.items (array) is passed to length()', async function() {
    const code = `const list = {
  items: [1, 2, 3],
  size: function() {
    return length(this.items);
  },
};
print(list.size());
`;
    const diags = await getDiagnostics(code, testFile);
    const lengthWarnings = diags.filter(d =>
      d.message && d.message.includes('length') && d.message.includes('unknown')
    );
    assert.strictEqual(lengthWarnings.length, 0,
      `length(this.items) should not warn about unknown arg, got: ${lengthWarnings.map(d => d.message).join('; ')}`);
  });

  // ── Example 11: this.config_file in method (real-world from pkg.uc) ─
  it('should resolve this properties in real-world pkg.uc pattern', async function() {
    const code = `const pkg = {
  name: 'pbr',
  version: 'dev-test',
  config_file: '/etc/config/pbr',
  chains_list: 'forward output prerouting',
  url: function(fragment) {
    return sprintf("https://docs.openwrt.melmac.ca/%s/%s/%s", this.name, split(this.version, '-')[0], fragment || '');
  },
};
pkg.service_name = pkg.name + ' ' + pkg.version;
print(pkg.url('test'));
`;
    const diags = await getDiagnostics(code, testFile);
    // No warnings about unknown args to split() or sprintf()
    const unknownWarnings = diags.filter(d =>
      d.message && d.message.includes('unknown')
    );
    assert.strictEqual(unknownWarnings.length, 0,
      `Real-world pkg pattern should not produce unknown warnings, got: ${unknownWarnings.map(d => d.message).join('; ')}`);
  });

  // ── Example 12: this in arrow function should NOT resolve (null in ucode) ─
  it('should not resolve this.name in arrow function (this is null)', async function() {
    const code = `const obj = {
  name: 'hello',
  greet: () => {
    return this;
  },
};
print(obj.greet());
`;
    const lines = code.split('\n');
    // Hover on `this` inside arrow — should NOT get object type
    const lineIdx = 3;
    const charIdx = lines[lineIdx].indexOf('this');
    const hover = await getHover(code, testFile, lineIdx, charIdx);
    const text = extractHoverText(hover);
    // this in arrow function should be unknown/null, not the object's type
    assert.ok(!text.toLowerCase().includes('object') || text === '',
      `this in arrow function should not resolve to object, got: ${text}`);
  });

  // ── Example 13: nested object this refers to inner, not outer ─
  it('should resolve this to inner object in nested object methods', async function() {
    const code = `const outer = {
  value: 'outer_val',
  inner: {
    value: 'inner_val',
    get: function() { return this.value; },
  },
};
print(outer.inner.get());
`;
    const lines = code.split('\n');
    const lineIdx = 4;
    const charIdx = lines[lineIdx].indexOf('this.value') + 5;
    const hover = await getHover(code, testFile, lineIdx, charIdx);
    const text = extractHoverText(hover);
    assert.ok(text.toLowerCase().includes('string'),
      `Expected 'string' for this.value in inner object, got: ${text}`);
  });
});
