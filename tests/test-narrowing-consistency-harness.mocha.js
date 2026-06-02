const assert = require('assert');
const { createLSPTestServer } = require('./lsp-test-helpers');

// DIFFERENTIAL narrowing harness. Rather than enumerate every (guard × nesting ×
// consumer) combination, this asserts an INVARIANT that any combination must
// satisfy, so new false positives are caught without writing a test per shape:
//
//   The diagnostic engine must never be STRICTER than what hover shows.
//   If hover reports a value as a clean `string` (the type trim()/uc() require),
//   then trim(x)/uc(x) must NOT emit a nullable/unknown/incompatible diagnostic.
//
// This is exactly the false-positive class the narrowing fixes 0.6.121–0.6.126
// each closed one real-file-at-a-time. The probe is `trim(x)` — trim requires a
// non-null string and tolerates neither null nor unknown, so the engine's view
// is observable: a clean string → 0 warnings; string|null/unknown → a warning.
//
// (Known, separate gap NOT asserted here: hover currently UNDER-narrows a bare
// `if (!x) return;` early-exit — shows string|null while the engine correctly
// narrows to string. That is hover imprecision, not a false positive, and is
// tracked for the hover/engine type-source unification.)
describe('Narrowing consistency harness (hover vs diagnostics)', function () {
  this.timeout(30000);
  let lspServer;
  before(async function () { lspServer = createLSPTestServer(); await lspServer.initialize(); });
  after(function () { if (lspServer) lspServer.shutdown(); });

  // x is string|null (fs.readfile). Three ways to introduce it.
  const SETUPS = {
    init:   `let x = fs.readfile(p);`,
    assign: `let x; x = fs.readfile(p);`,
    inTry:  `let x; try { x = fs.readfile(p); } catch (e) { return false; }`,
  };
  // Each guard places the `trim(x)` probe where x should be a non-null string.
  const GUARDS = {
    ifTruthy:    (probe) => `  if (x) { ${probe} }`,
    ifTypeStr:   (probe) => `  if (type(x) == "string") { ${probe} }`,
    earlyNot:    (probe) => `  if (!x) return false;\n  ${probe}`,
    earlyTypeNe: (probe) => `  if (type(x) != "string") return false;\n  ${probe}`,
    earlyTryCat: (probe) => `  if (!x) { try { return true; } catch (e) { return false; } }\n  ${probe}`,
    ternary:     ()      => `  let r = x ? trim(x) : null;`,
    andChain:    ()      => `  let r = x && trim(x);`,
  };

  const probePos = (code) => {
    const i = code.indexOf('trim(x)') + 'trim('.length;
    const pre = code.slice(0, i);
    return { line: (pre.match(/\n/g) || []).length, character: i - (pre.lastIndexOf('\n') + 1) };
  };
  const hoverType = (h) => {
    const v = h && (h.contents?.value ?? h.contents) || '';
    const m = String(v).match(/`([^`]+)`\s*$/);
    return m ? m[1] : String(v);
  };
  const warnCount = (ds) => ds.filter(d =>
    /may be null|is unknown|nullable|possibly|argument 1/i.test(d.message || '')).length;

  it('the engine never warns on a value hover reports as a clean string', async () => {
    const violations = [];
    for (const [sName, setup] of Object.entries(SETUPS)) {
      for (const [gName, mk] of Object.entries(GUARDS)) {
        const probe = `let r = trim(x);`;
        const code = `import * as fs from 'fs';\nfunction f(p) {\n  ${setup}\n${mk(probe)}\n}`;
        const { line, character } = probePos(code);
        const fp = `/tmp/harness-${sName}-${gName}.uc`;
        const ht = hoverType(await lspServer.getHover(code, fp, line, character));
        const warns = warnCount(await lspServer.getDiagnostics(code, fp));
        // The invariant: a clean `string` per hover ⇒ no diagnostic.
        if (ht === 'string' && warns > 0) {
          violations.push(`${sName}/${gName}: hover='string' but ${warns} warning(s) (false positive)`);
        }
      }
    }
    assert.deepStrictEqual(violations, [], `hover/diagnostic disagreements:\n${violations.join('\n')}`);
  });
});
