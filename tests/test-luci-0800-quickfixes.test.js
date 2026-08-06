// 0.8.0 quick-fix behaviors, end-to-end through the spawned server (the only layer
// where code actions exist): mark-@param-optional corners, template-aware @global and
// seed-global insertion, and the UC6020 comment-repair edit set.
// Companion unit suite: tests/diagnostics/test-luci-0800-corners.test.js.
const { test, expect, describe, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('./lsp-test-helpers');
setDefaultTimeout(30000);

let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

async function actionsFor(code, uri, pick) {
  const ds = (await server.getDiagnostics(code, uri)) || [];
  const d = ds.find(pick);
  if (!d) return { d: null, acts: [] };
  const acts = (await server.getCodeActions(uri, [d], d.range.start.line, d.range.start.character)) || [];
  return { d, acts, ds };
}
const editsOf = (act) => act.edit.changes[Object.keys(act.edit.changes)[0]];
const applyEdits = (code, edits) => {
  // Offsets from LSP positions; apply bottom-up.
  const lines = code.split('\n');
  const off = (p) => lines.slice(0, p.line).reduce((a, l) => a + l.length + 1, 0) + p.character;
  const sorted = [...edits].sort((a, b) => off(b.range.start) - off(a.range.start));
  let out = code;
  for (const e of sorted) out = out.slice(0, off(e.range.start)) + e.newText + out.slice(off(e.range.end));
  return out;
};

// ═══ mark-@param-optional ═══════════════════════════════════════════════════════════

describe('mark-@param-optional corners', () => {
  const isMissing = (name) => (x) => x.code === 'UC2003' && x.message.includes(`'${name}'`) && /declare it optional/.test(x.message);

  test('Q1 two missing params on one call → two distinct fixes, one per param', async () => {
    const code = '/**\n * @param {string} a\n * @param {string} b\n * @param {boolean} c\n */\nfunction f(a, b, c) { return [a, b, c]; }\nf("x");\n';
    const uri = `/tmp/q08-${n++}.uc`;
    const ds = (await server.getDiagnostics(code, uri)) || [];
    const missing = ds.filter((x) => x.code === 'UC2003' && /declare it optional/.test(x.message));
    expect(missing.length).toBe(2);
    const acts = (await server.getCodeActions(uri, missing, missing[0].range.start.line, missing[0].range.start.character)) || [];
    expect(acts.filter((a) => /Mark 'b' optional/.test(a.title)).length).toBe(1);
    expect(acts.filter((a) => /Mark 'c' optional/.test(a.title)).length).toBe(1);
  });

  test('Q2 applying BOTH fixes yields a fully-clean re-analysis', async () => {
    const code = '/**\n * @param {string} a\n * @param {string} b\n * @param {boolean} c\n */\nfunction f(a, b, c) { return [a, b, c]; }\nf("x");\nf("y");\n';
    const uri = `/tmp/q08-${n++}.uc`;
    const ds = (await server.getDiagnostics(code, uri)) || [];
    const missing = ds.filter((x) => x.code === 'UC2003');
    const acts = (await server.getCodeActions(uri, missing, missing[0].range.start.line, missing[0].range.start.character)) || [];
    const edits = acts.filter((a) => /Mark '(b|c)' optional/.test(a.title)).flatMap(editsOf);
    const fixed = applyEdits(code, edits);
    expect(fixed).toContain('@param {string} [b]');
    expect(fixed).toContain('@param {boolean} [c]');
    const after = (await server.getDiagnostics(fixed, `/tmp/q08-${n++}.uc`)) || [];
    expect(after.filter((x) => x.code === 'UC2003')).toEqual([]);
  });

  test('Q3 irregular JSDoc whitespace still targets exactly the name', async () => {
    const code = '/**\n *   @param    {string}      body\n */\nfunction f(body) { return body; }\nf();\n';
    const { acts } = await actionsFor(code, `/tmp/q08-${n++}.uc`, isMissing('body'));
    const act = acts.find((a) => /Mark 'body' optional/.test(a.title));
    expect(act).toBeTruthy();
    const [e] = editsOf(act);
    expect(e.newText).toBe('[body]');
    expect(applyEdits(code, [e])).toContain('{string}      [body]');
  });

  test('Q4 a single-line JSDoc form works too', async () => {
    const code = '/** @param {integer} count */\nfunction f(count) { return count; }\nf();\n';
    const { acts } = await actionsFor(code, `/tmp/q08-${n++}.uc`, isMissing('count'));
    expect(acts.some((a) => /Mark 'count' optional/.test(a.title))).toBe(true);
  });

  test('Q5 an EXPORTED function (export gap between JSDoc and id) still gets the fix', async () => {
    const code = '/** @param {string} a */\nexport function f(a) { return a; }\nf();\n';
    const { acts } = await actionsFor(code, `/tmp/q08-${n++}.uc`, isMissing('a'));
    expect(acts.some((a) => /Mark 'a' optional/.test(a.title))).toBe(true);
  });

  test('Q6 a let-bound function EXPRESSION gets no fix (comment governs the let, not an id we edit)', async () => {
    const code = '/** @param {string} a */\nlet f = function(a) { return a; };\nf();\n';
    const { d, acts } = await actionsFor(code, `/tmp/q08-${n++}.uc`, isMissing('a'));
    if (d) expect(acts.some((a) => /Mark 'a' optional/.test(a.title))).toBe(false);
  });

  test('Q7 a param name that prefixes another (@param {string} raw / rawer) brackets the right one', async () => {
    const code = '/**\n * @param {string} rawer\n * @param {string} raw\n */\nfunction f(rawer, raw) { return [rawer, raw]; }\nf("x");\n';
    const { acts } = await actionsFor(code, `/tmp/q08-${n++}.uc`, isMissing('raw'));
    const act = acts.find((a) => /Mark 'raw' optional/.test(a.title));
    expect(act).toBeTruthy();
    const fixed = applyEdits(code, editsOf(act));
    expect(fixed).toContain('@param {string} [raw]\n');
    expect(fixed).toContain('@param {string} rawer'); // untouched
  });

  test('Q8 intervening NON-JSDoc comment between JSDoc and fn does not confuse the target', async () => {
    const code = '/** @param {string} a */\n// implementation note\nfunction f(a) { return a; }\nf();\n';
    const { d, acts } = await actionsFor(code, `/tmp/q08-${n++}.uc`, isMissing('a'));
    // The governing-comment gap check refuses to edit across the stray comment —
    // no fix rather than a wrong edit (the diagnostic itself still stands).
    if (d) {
      const act = acts.find((a) => /Mark 'a' optional/.test(a.title));
      if (act) {
        // If offered, it must still bracket the right token inside the JSDOC block.
        expect(applyEdits(code, editsOf(act))).toContain('/** @param {string} [a] */');
      }
    }
  });

  test('Q9 the fix range covers exactly the bare name (replacement, not insertion)', async () => {
    const code = '/** @param {string} body */\nfunction f(body) { return body; }\nf();\n';
    const { acts } = await actionsFor(code, `/tmp/q08-${n++}.uc`, isMissing('body'));
    const [e] = editsOf(acts.find((a) => /Mark 'body' optional/.test(a.title)));
    expect(e.range.start.line).toBe(0);
    expect(e.range.end.character - e.range.start.character).toBe('body'.length);
  });

  test('Q10 no fix crosses files: imported callee diagnostic carries no edit', async () => {
    const fs = require('fs');
    fs.writeFileSync('/tmp/q08-dep.uc', '/** @param {string} a */\nexport function one(a) { return a; };\n');
    const code = "import { one } from './q08-dep.uc';\none();\n";
    const { d, acts } = await actionsFor(code, `/tmp/q08-${n++}.uc`, isMissing('a'));
    expect(d).toBeTruthy();
    expect(acts.some((a) => /Mark 'a' optional/.test(a.title))).toBe(false);
  });

  test('Q11 builtin arity problems never offer the JSDoc fix', async () => {
    const code = 'let s = split();\nprint(s);\n';
    const uri = `/tmp/q08-${n++}.uc`;
    const ds = (await server.getDiagnostics(code, uri)) || [];
    for (const d of ds) {
      const acts = (await server.getCodeActions(uri, [d], d.range.start.line, d.range.start.character)) || [];
      expect(acts.some((a) => /optional in its @param/.test(a.title))).toBe(false);
    }
  });
});

// ═══ template-aware top-of-file insertions ══════════════════════════════════════════

describe('template-aware @global / seed-global', () => {
  test('Q12 in a TEMPLATE, the @global fix inserts the {% … %}-wrapped form', async () => {
    const code = '<p>{{ mystery_env_name }}</p>\n';
    const uri = `/tmp/q08-${n++}.ut`;
    const { d, acts } = await actionsFor(code, uri, (x) => /Undefined variable: mystery_env_name/.test(x.message));
    expect(d).toBeTruthy();
    const act = acts.find((a) => /injected global/.test(a.title));
    expect(act).toBeTruthy();
    const [e] = editsOf(act);
    expect(e.newText).toBe('{% /** @global mystery_env_name */ %}\n');
  });

  test('Q13 the wrapped form actually silences the diagnostic on re-analysis', async () => {
    const before = '<p>{{ mystery_env_name }}</p>\n';
    const after = '{% /** @global mystery_env_name */ %}\n' + before;
    const ds = (await server.getDiagnostics(after, `/tmp/q08-${n++}.ut`)) || [];
    expect(ds.filter((x) => /Undefined variable: mystery_env_name/.test(x.message))).toEqual([]);
  });

  test('Q14 in a RAW script, the @global fix stays unwrapped', async () => {
    const code = 'print(mystery_env_name);\n';
    const { acts } = await actionsFor(code, `/tmp/q08-${n++}.uc`, (x) => /Undefined variable: mystery_env_name/.test(x.message));
    const act = acts.find((a) => /injected global/.test(a.title));
    expect(act).toBeTruthy();
    expect(editsOf(act)[0].newText).toBe('/** @global mystery_env_name */\n');
  });

  test('Q15 a template detected by CONTENT (a .uc with tags) also gets the wrapped form', async () => {
    const code = '{% print(mystery_env_name); %}\n';
    const { acts } = await actionsFor(code, `/tmp/q08-${n++}.uc`, (x) => /Undefined variable: mystery_env_name/.test(x.message));
    const act = acts.find((a) => /injected global/.test(a.title));
    expect(act).toBeTruthy();
    expect(editsOf(act)[0].newText.startsWith('{%')).toBe(true);
  });
});

// ═══ luci.* did-you-mean rewrite ════════════════════════════════════════════════════

describe('luci.* typo rewrite quick fix', () => {
  const fs2 = require('fs');
  const os2 = require('os');
  const path2 = require('path');

  test('Q21 the suggestion diagnostic carries a Change-to fix that resolves on apply', async () => {
    const dir = fs2.mkdtempSync(path2.join(os2.tmpdir(), 'qf-typo-'));
    fs2.writeFileSync(path2.join(dir, 'Makefile'), 'LUCI_TITLE:=X\ninclude $(TOPDIR)/feeds/luci/luci.mk\n');
    fs2.mkdirSync(path2.join(dir, 'ucode/controller'), { recursive: true });
    fs2.writeFileSync(path2.join(dir, 'ucode/podman_validate.uc'), 'export function validate_id(s) { return s; };\n');
    const uri = path2.join(dir, 'ucode/controller/c.uc');
    const code = "import { validate_id } from 'luci.podman_validated';\nprint(validate_id);\n";
    const { d, acts } = await actionsFor(code, uri, (x) => /did you mean/.test(x.message));
    expect(d).toBeTruthy();
    const act = acts.find((a) => a.title === "Change to 'luci.podman_validate'");
    expect(act).toBeTruthy();
    expect(act.isPreferred).toBe(true);
    const fixed = applyEdits(code, editsOf(act));
    expect(fixed).toContain("from 'luci.podman_validate';"); // quotes preserved
    const after = (await server.getDiagnostics(fixed, path2.join(dir, 'ucode/controller/c2.uc'))) || [];
    expect(after.filter((x) => /Cannot find|did you mean/.test(x.message))).toEqual([]);
    fs2.rmSync(dir, { recursive: true, force: true });
  });

  test('Q22 double-quoted imports keep their quote style', async () => {
    const dir = fs2.mkdtempSync(path2.join(os2.tmpdir(), 'qf-typo-'));
    fs2.writeFileSync(path2.join(dir, 'Makefile'), 'LUCI_TITLE:=X\ninclude $(TOPDIR)/feeds/luci/luci.mk\n');
    fs2.mkdirSync(path2.join(dir, 'ucode/controller'), { recursive: true });
    fs2.writeFileSync(path2.join(dir, 'ucode/helper.uc'), 'export function h() {};\n');
    const uri = path2.join(dir, 'ucode/controller/c.uc');
    const code = 'import { h } from "luci.helpre";\nprint(h);\n';
    const { acts } = await actionsFor(code, uri, (x) => /did you mean/.test(x.message));
    const act = acts.find((a) => /Change to/.test(a.title));
    expect(act).toBeTruthy();
    expect(applyEdits(code, editsOf(act))).toContain('from "luci.helper";');
    fs2.rmSync(dir, { recursive: true, force: true });
  });
});

// ═══ UC6020 repair edits e2e ════════════════════════════════════════════════════════

describe('UC6020 comment repair through the server', () => {
  test('Q16 the fix carries one insertion per inner terminator', async () => {
    const code = '{# a #} b #} c -#}\n<p>x</p>\n{% let a = 1; %}\n';
    const { d, acts } = await actionsFor(code, `/tmp/q08-${n++}.ut`, (x) => x.code === 'UC6020');
    expect(d).toBeTruthy();
    const act = acts.find((a) => /Extend the comment/.test(a.title));
    expect(act).toBeTruthy();
    expect(editsOf(act).length).toBe(2); // early close + mid stray; final -#} kept
  });

  test('Q17 applying the fix round-trips to a clean template', async () => {
    const code = '{# mentions #} and keeps going\n-#}\n<p>x</p>\n{% let a = 1; %}\n';
    const { acts } = await actionsFor(code, `/tmp/q08-${n++}.ut`, (x) => x.code === 'UC6020');
    const act = acts.find((a) => /Extend the comment/.test(a.title));
    const fixed = applyEdits(code, editsOf(act));
    expect(fixed).toContain('mentions # } and');
    const after = (await server.getDiagnostics(fixed, `/tmp/q08-${n++}.ut`)) || [];
    expect(after.filter((x) => x.code === 'UC6020')).toEqual([]);
  });

  test('Q18 each insertion is a single space at a pair boundary', async () => {
    const code = '{# a #} tail -#}\n{% let a = 1; %}\n';
    const { acts } = await actionsFor(code, `/tmp/q08-${n++}.ut`, (x) => x.code === 'UC6020');
    const [e] = editsOf(acts.find((a) => /Extend the comment/.test(a.title)));
    expect(e.newText).toBe(' ');
    expect(e.range.start).toEqual(e.range.end); // pure insertion
  });

  test('Q19 UC6020 diagnostics flow with warning severity through the server', async () => {
    const code = '{# a #} tail -#}\n{% let a = 1; %}\n';
    const ds = (await server.getDiagnostics(code, `/tmp/q08-${n++}.ut`)) || [];
    const d = ds.find((x) => x.code === 'UC6020');
    expect(d.severity).toBe(2);
  });

  test('Q20 a clean template offers no comment-repair action anywhere', async () => {
    const code = '{# clean -#}\n<p>x</p>\n{% let a = 1; %}\n';
    const ds = (await server.getDiagnostics(code, `/tmp/q08-${n++}.ut`)) || [];
    expect(ds.filter((x) => x.code === 'UC6020')).toEqual([]);
  });
});
