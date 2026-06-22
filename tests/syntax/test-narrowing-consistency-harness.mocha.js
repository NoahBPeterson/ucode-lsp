const assert = require('assert');
const { createLSPTestServer } = require('../lsp-test-helpers');

// DIFFERENTIAL narrowing harness. Rather than enumerate every (guard × nesting ×
// consumer) combination — a combinatorial, unbounded space that produced the
// 0.6.121–0.6.126 whack-a-mole — assert ONE invariant every combination must
// satisfy, so divergences are caught without a test per shape:
//
//   The type a user SEES (hover) and the type the engine USES (diagnostics)
//   must AGREE. Probe `trim(x)` (requires a non-null string, tolerates neither
//   null nor unknown): hover reports `string` IFF the engine emits no warning.
//
// A violation in EITHER direction is a real bug:
//   - hover='string' but a warning fires  → false positive (the 0.6.121–126 class)
//   - hover wide but no warning            → hover under-narrows vs the engine
//                                            (the bug 0.6.127 fixed: a `!x`
//                                            early-exit guard used a non-position-
//                                            aware symbol lookup that missed a
//                                            function-local in a post-analysis
//                                            hover query).
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
  // Each guard places the `trim(x)` probe. `none`/`elseBranch` do NOT narrow x
  // (so hover stays wide AND a warning fires — also a consistent state).
  const GUARDS = {
    none:        `  let r = trim(x);`,
    ifTruthy:    `  if (x) { let r = trim(x); }`,
    ifTypeStr:   `  if (type(x) == "string") { let r = trim(x); }`,
    earlyNot:    `  if (!x) return false;\n  let r = trim(x);`,
    earlyTypeNe: `  if (type(x) != "string") return false;\n  let r = trim(x);`,
    earlyTryCat: `  if (!x) { try { return true; } catch (e) { return false; } }\n  let r = trim(x);`,
    ternary:     `  let r = x ? trim(x) : null;`,
    elseBranch:  `  if (x) {} else { let r = trim(x); }`,
    nestedIf:    `  if (p) { if (x) { let r = trim(x); } }`,
    andGuard:    `  if (x && length(x) > 0) { let r = trim(x); }`,
    earlyNotNested: `  if (p) { if (!x) return false; let r = trim(x); }`,
    doubleEarly: `  if (!p) return false;\n  if (!x) return false;\n  let r = trim(x);`,
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

  it('hover reports a clean string IFF the diagnostic engine emits no warning', async () => {
    const violations = [];
    for (const [sName, setup] of Object.entries(SETUPS)) {
      for (const [gName, body] of Object.entries(GUARDS)) {
        const code = `import * as fs from 'fs';\nfunction f(p) {\n  ${setup}\n${body}\n}`;
        const { line, character } = probePos(code);
        const fp = `/tmp/harness-${sName}-${gName}.uc`;
        const hoverClean = hoverType(await lspServer.getHover(code, fp, line, character)) === 'string';
        const engineClean = warnCount(await lspServer.getDiagnostics(code, fp)) === 0;
        if (hoverClean !== engineClean) {
          violations.push(`${sName}/${gName}: hoverClean=${hoverClean} engineClean=${engineClean}`);
        }
      }
    }
    assert.deepStrictEqual(violations, [], `hover/diagnostic disagreements:\n${violations.join('\n')}`);
  });
});
