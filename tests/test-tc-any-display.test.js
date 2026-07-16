// ANY display sentinel (docs/tc-json-any-return-display.md): json() (and call())
// genuinely return *any* value by C contract — ucode/lib.c:3619 uc_json →
// ucv_from_json; ucode/lib.c:5738 uc_callfunc → returns whatever the invoked
// function returns. Previously both were typed UNKNOWN, so every hover/coverage
// probe on a parsed-JSON value read as a typing MISS, indistinguishable from
// "the analyzer gave up". UcodeType.ANY is a new sentinel that:
//   - behaves EXACTLY like UNKNOWN in every check (top type, no new diagnostics
//     — dataTypeToBase/singleTypeToBase collapse it to UNKNOWN, so compatibility/
//     narrowing/argument-checking code is unaffected);
//   - DISPLAYS as `any` in hover (typeToString), distinct from `unknown`;
//   - is counted as TYPED (not a coverage gap) by --type-coverage, since the
//     regex there (`/\bunknown\b/`) simply doesn't match the string `any`.
//
// Driven through the real LSP server (handleHover / getDiagnostics) for the
// in-process assertions, matching the convention in test-tc-operator-typing.test.js;
// the --type-coverage assertions spawn the BUILT CLI (bin/ucode-lsp.js), matching
// tests/cli/test-cli-type-coverage.test.js — run `bun run compile` first.
const { test, expect, describe, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('./lsp-test-helpers');
const path = require('path');
const os = require('os');
const fs = require('fs');
const cp = require('child_process');

setDefaultTimeout(20000);
let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

async function hoverAt(code, needle) {
  const idx = code.lastIndexOf(needle);
  if (idx < 0) throw new Error(`needle not found: ${needle}`);
  const pre = code.slice(0, idx);
  const line = (pre.match(/\n/g) || []).length;
  const col = idx - (pre.lastIndexOf('\n') + 1);
  const uri = `/tmp/tc-any-${n++}.uc`;
  await server.getDiagnostics(code, uri); // settle full analysis before hovering
  const h = await server.getHover(code, uri, line, col);
  const v = h && h.contents && (h.contents.value || h.contents);
  return (typeof v === 'string' ? v : JSON.stringify(v || '')).replace(/\n/g, ' ');
}
function exactType(hoverText) {
  const m = hoverText.match(/`([^`]+)`/);
  return m ? m[1].trim() : hoverText.trim();
}
async function typeOf(code, needle) {
  return exactType(await hoverAt(code, needle));
}
async function diagCodes(code) {
  const uri = `/tmp/tc-any-${n++}.uc`;
  const ds = await server.getDiagnostics(code, uri);
  return (ds || []).map((d) => d.code);
}
async function diagMessages(code) {
  const uri = `/tmp/tc-any-${n++}.uc`;
  const ds = await server.getDiagnostics(code, uri);
  return (ds || []).map((d) => d.message);
}

describe('ANY display sentinel — json()/call() return type', () => {
  test('01 json() hovers as `any`, not `unknown`', async () => {
    const code = 'function f(y) {\n  let x = json(y);\n  return x;\n}\n';
    expect(await typeOf(code, 'x = json')).toBe('any');
  });

  test('02 call() hovers as `any`', async () => {
    const code = 'function f(fn) {\n  let x = call(fn);\n  return x;\n}\n';
    expect(await typeOf(code, 'x = call')).toBe('any');
  });

  test('03 a genuine unknown (unannotated param read) still hovers `unknown`, not `any`', async () => {
    const code = 'function f(p) {\n  let z = p;\n  return z;\n}\n';
    expect(await typeOf(code, 'z = p')).toBe('unknown');
  });

  test('04 `any | null` union renders with the `any` token (wrapper propagation, e.g. load_json())', async () => {
    const code = [
      'function load_json(data) {',
      '  if (data == null) return null;',
      '  return json(data);',
      '}',
      'function f(input) {',
      '  let out = load_json(input);',
      '  return out;',
      '}',
      ''
    ].join('\n');
    const t = await typeOf(code, 'out = load_json');
    expect(t).toContain('any');
    expect(t).toContain('null');
  });

  test('05 narrowing `type(x)==\"object\"` still works on an any-typed x (ANY behaves like UNKNOWN under guards)', async () => {
    const code = [
      'function f(y) {',
      '  let x = json(y);',
      '  if (type(x) == "object") {',
      '    let z = x;',
      '    return z;',
      '  }',
      '  return null;',
      '}',
      ''
    ].join('\n');
    expect(await typeOf(code, 'z = x')).toBe('object');
  });

  // ucode DOES warn when an unknown-typed value reaches a builtin with a strict
  // single-type contract ("Argument N of F() is unknown. Use a type guard...",
  // builtinValidation.ts's `argType === UcodeType.UNKNOWN` branch) — that's
  // pre-existing, intentional behavior, not something ANY should suppress. The
  // contract under test is PARITY: an any-typed argument must produce the exact
  // same diagnostic as a genuinely-unknown one, byte-for-byte (proving
  // getTypeDescription's ANY→'unknown' collapse works), not silence.
  test('06 an any-typed argument (via call()) produces the SAME b64enc() warning as a genuinely-unknown one', async () => {
    const anyCode = 'function f(fn) {\n  let x = call(fn);\n  return b64enc(x);\n}\n';
    const unknownCode = 'function g(x) {\n  return b64enc(x);\n}\n';
    const anyMsgs = (await diagMessages(anyCode)).filter((m) => m.includes('b64enc'));
    const unknownMsgs = (await diagMessages(unknownCode)).filter((m) => m.includes('b64enc'));
    expect(anyMsgs).toEqual(unknownMsgs);
    expect(anyMsgs).toEqual(["Argument 1 of b64enc() is unknown. Use a type guard to narrow to string."]);
  });

  test('07 member access on an any-typed value is exactly as permissive as on a genuinely-unknown one', async () => {
    const anyCode = 'function f(fn) {\n  let x = call(fn);\n  return x.Version;\n}\n';
    const unknownCode = 'function g(x) {\n  return x.Version;\n}\n';
    // Neither produces a member-access diagnostic (only the unrelated, pre-existing
    // "call()'s own first argument is unknown" note appears in the `any` case).
    const anyCodes = (await diagCodes(anyCode)).filter((c) => c !== 'incompatible-function-argument' && c !== 'UC1006');
    const unknownCodes = (await diagCodes(unknownCode)).filter((c) => c !== 'UC1006');
    expect(anyCodes).toEqual([]);
    expect(unknownCodes).toEqual([]);
  });
});

describe('--type-coverage: `any` counts as typed, `unknown` still flags', () => {
  const BIN = path.resolve(__dirname, '..', 'bin', 'ucode-lsp.js');
  let dir, jsonFile, unknownFile;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-tc-any-'));
    jsonFile = path.join(dir, 'any.uc');
    fs.writeFileSync(jsonFile, [
      '/**',
      ' * @param {string} y',
      ' */',
      'function f(y) {',
      '  let status_data = json(y);', // any — must NOT be flagged
      '  return status_data;',
      '}',
      'print(f("{}"));',
      ''
    ].join('\n'));
    unknownFile = path.join(dir, 'unk.uc');
    fs.writeFileSync(unknownFile, [
      'function mangle(item) {', // unannotated param — genuinely unknown
      '  return item;',
      '}',
      'let outcome = mangle(1);',
      'print(outcome);',
      ''
    ].join('\n'));
  });
  afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  function runCli(args) {
    const r = cp.spawnSync('node', [BIN, ...args], { encoding: 'utf8' });
    return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
  }

  test('09 a json()-derived variable is NOT reported as unknown-type', () => {
    const { stdout } = runCli(['--type-coverage', jsonFile]);
    expect(stdout).not.toContain("'status_data'");
  });

  test('10 the same file reports 100% coverage (any counts as typed)', () => {
    const { stderr } = runCli(['--type-coverage', jsonFile]);
    expect(stderr).toContain('Type coverage: 100.0%');
  });

  test('11 a genuinely-unknown variable (unannotated param propagation) is STILL flagged', () => {
    const { stdout } = runCli(['--type-coverage', unknownFile]);
    expect(stdout).toMatch(/unknown-type: 'outcome' shows as `unknown`/);
  });
});
