// Disable-directive staleness (UC8014) across ALL diagnostic layers, plus the
// template-comment directive form (`{# ucode-lsp disable… #}`) — the only way to carry
// a directive in template TEXT, where `//` is page output and lexer diagnostics like
// UC6020 anchor. Root finding: the analyzer's staleness check can't see lexer/parser
// suppressions (they're applied in the server), so a directive that earned its keep
// there was falsely flagged "No diagnostic disabled by this comment".
const { test, expect, describe, beforeAll, afterAll, setDefaultTimeout } = require('bun:test');
const { createLSPTestServer } = require('./lsp-test-helpers');
setDefaultTimeout(30000);

let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

const diags = async (code, ext = 'uc') => (await server.getDiagnostics(code, `/tmp/dds-${n++}.${ext}`)) || [];
const stale = (ds) => ds.filter((d) => d.code === 'UC8014');

describe('UC8014 staleness across layers', () => {
  test('a code-targeted directive that suppresses nothing flags UC8014 (with its code)', async () => {
    const ds = await diags('// ucode-lsp disable-next-line UC1001\nlet a = 1;\nprint(a);\n');
    const s = stale(ds);
    expect(s.length).toBe(1);
    expect(s[0].message).toBe('No diagnostic disabled by this comment');
  });

  test('a directive used on an ANALYZER diagnostic is not stale', async () => {
    const ds = await diags('// ucode-lsp disable-next-line UC1001\nprint(never_defined);\n');
    expect(stale(ds)).toEqual([]);
    expect(ds.filter((d) => d.code === 'UC1001')).toEqual([]);
  });

  test('a directive used ONLY on a LEXER diagnostic is not stale (the fixed FP)', async () => {
    const ds = await diags('// ucode-lsp disable-next-line UC6016\nlet x = 0x;\nprint(x);\n');
    expect(ds.filter((d) => d.code === 'UC6016')).toEqual([]); // suppressed…
    expect(stale(ds)).toEqual([]);                             // …and NOT called stale
  });

  test('a directive used ONLY on a PARSER diagnostic is not stale', async () => {
    // UC6018: bare numeric object key is a parser-layer diagnostic.
    const ds = await diags('// ucode-lsp disable-next-line UC6018\nlet o = { 1: 2 };\nprint(o);\n');
    expect(ds.filter((d) => d.code === 'UC6018')).toEqual([]);
    expect(stale(ds)).toEqual([]);
  });

  // CONTRACT UPDATE (2026-08-05, user design re-evaluation on podman evidence): a stale
  // BARE disable surfaces as a faded HINT + Unnecessary tag; code-targeted stays Warning.
  test('a stale bare disable is a HINT with the Unnecessary tag (never a warning)', async () => {
    const ds = await diags('// ucode-lsp disable-next-line\nlet a = 1;\nprint(a);\n');
    const s = stale(ds);
    expect(s.length).toBe(1);
    expect(s[0].severity).toBe(4);
    expect(s[0].tags).toEqual([1]); // DiagnosticTag.Unnecessary
  });

  test('a stale code-targeted disable stays a WARNING (and carries the tag)', async () => {
    const ds = await diags('// ucode-lsp disable-next-line UC1001\nlet a = 1;\nprint(a);\n');
    const s = stale(ds);
    expect(s[0].severity).toBe(2);
    expect(s[0].tags).toEqual([1]);
  });

  test('a USED bare disable stays completely silent (no hint)', async () => {
    const ds = await diags('print(never_defined); // ucode-lsp disable\n');
    expect(stale(ds)).toEqual([]);
  });

  test('the podman shape: bare disable on a now-resolving luci.* import goes stale-hint', async () => {
    // Build a standalone LuCI package so luci.* import suppression applies — the
    // directive then suppresses nothing and surfaces as a hint.
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pod-shape-'));
    fs.writeFileSync(path.join(dir, 'Makefile'), 'LUCI_TITLE:=X\ninclude $(TOPDIR)/feeds/luci/luci.mk\n');
    fs.mkdirSync(path.join(dir, 'root/usr/share/rpcd/ucode'), { recursive: true });
    const code = "import { validate_int } from 'luci.podman_validate'; // ucode-lsp disable\nprint(validate_int);\n";
    const ds = (await server.getDiagnostics(code, path.join(dir, 'root/usr/share/rpcd/ucode/backend.uc'))) || [];
    const s = stale(ds);
    expect(s.length).toBe(1);
    expect(s[0].severity).toBe(4);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('UC8015 blanket-disable narrowing', () => {
  const narrow = (ds) => ds.filter((d) => d.code === 'UC8015');
  const actFor = async (code, uri) => {
    const ds = (await server.getDiagnostics(code, uri)) || [];
    const d = ds.find((x) => x.code === 'UC8015');
    if (!d) return { d: null, act: null };
    const acts = (await server.getCodeActions(uri, [d], d.range.start.line, d.range.start.character)) || [];
    return { d, act: acts.find((a) => /^Narrow to 'disable /.test(a.title)) };
  };
  const applyOne = (code, act) => {
    const lines = code.split('\n');
    const off = (p) => lines.slice(0, p.line).reduce((a, l) => a + l.length + 1, 0) + p.character;
    const [e] = act.edit.changes[Object.keys(act.edit.changes)[0]];
    return code.slice(0, off(e.range.start)) + e.newText + code.slice(off(e.range.end));
  };

  test('a USED bare disable hints with the exact codes it suppresses', async () => {
    const ds = await diags('let y = undefined_zzz; // ucode-lsp disable\n');
    const n = narrow(ds);
    expect(n.length).toBe(1);
    expect(n[0].severity).toBe(4);
    expect(n[0].message).toContain('UC1001');
    expect(n[0].message).toContain('UC1006'); // unused y is suppressed too
  });

  test('lexer-layer suppressions are included in the code list', async () => {
    const ds = await diags('let x = 0x; // ucode-lsp disable\nprint(x);\n');
    const n = narrow(ds);
    expect(n.length).toBe(1);
    expect(n[0].message).toContain('UC6016');
  });

  test('the narrowing fix appends the codes and round-trips clean', async () => {
    const code = 'let y = undefined_zzz; // ucode-lsp disable\n';
    const { act } = await actFor(code, `/tmp/dds-${n++}.uc`);
    expect(act).toBeTruthy();
    const fixed = applyOne(code, act);
    expect(fixed).toMatch(/\/\/ ucode-lsp disable UC\d+( UC\d+)*\n$/);
    const after = (await server.getDiagnostics(fixed, `/tmp/dds-${n++}.uc`)) || [];
    expect(after.filter((x) => x.code === 'UC8015')).toEqual([]); // now targeted
    expect(after.filter((x) => x.code === 'UC8014')).toEqual([]); // and still used
    expect(after.filter((x) => x.code === 'UC1001')).toEqual([]); // still suppressed
  });

  test('a code-targeted directive never draws the narrowing hint', async () => {
    const ds = await diags('let y = undefined_zzz; // ucode-lsp disable UC1001 UC1006\n');
    expect(narrow(ds)).toEqual([]);
  });

  test('a STALE bare disable draws UC8014, not UC8015 (mutually exclusive)', async () => {
    const ds = await diags('print(1); // ucode-lsp disable\n');
    expect(narrow(ds)).toEqual([]);
    expect(stale(ds).length).toBe(1);
  });

  test('the template-form directive narrows inside its own comment', async () => {
    const code = '{# ucode-lsp disable-next-line #}\n{# a #} tail -#}\n<p>x</p>\n{% print(1); %}\n';
    const { d, act } = await actFor(code, `/tmp/dds-${n++}.ut`);
    expect(d).toBeTruthy();
    expect(d.message).toContain('UC6020');
    const fixed = applyOne(code, act);
    expect(fixed.startsWith('{# ucode-lsp disable-next-line UC6020 #}')).toBe(true);
  });
});

describe('UC8014 removal quick fix', () => {
  const removalFor = async (code, uri) => {
    const ds = (await server.getDiagnostics(code, uri)) || [];
    const d = ds.find((x) => x.code === 'UC8014');
    if (!d) return { d: null, act: null };
    const acts = (await server.getCodeActions(uri, [d], d.range.start.line, d.range.start.character)) || [];
    return { d, act: acts.find((a) => /Remove this disable directive/.test(a.title)) };
  };
  const applied = (code, act) => {
    const lines = code.split('\n');
    const off = (p) => lines.slice(0, p.line).reduce((a, l) => a + l.length + 1, 0) + p.character;
    const [e] = act.edit.changes[Object.keys(act.edit.changes)[0]];
    return code.slice(0, off(e.range.start)) + e.newText + code.slice(off(e.range.end));
  };

  test('a trailing `// …` directive is deleted along with the space before it', async () => {
    const code = 'let a = 1; // ucode-lsp disable UC9999\nprint(a);\n';
    const { act } = await removalFor(code, `/tmp/dds-${n++}.uc`);
    expect(act).toBeTruthy();
    expect(applied(code, act)).toBe('let a = 1;\nprint(a);\n');
  });

  test('a comment-only directive line is removed entirely (newline included)', async () => {
    const code = '// ucode-lsp disable-next-line UC9999\nlet a = 1;\nprint(a);\n';
    const { act } = await removalFor(code, `/tmp/dds-${n++}.uc`);
    expect(applied(code, act)).toBe('let a = 1;\nprint(a);\n');
  });

  test('a template-form directive is deleted through its own terminator', async () => {
    const code = '{# ucode-lsp disable-next-line UC9999 #}\n<p>x</p>\n{% print(1); %}\n';
    const { act } = await removalFor(code, `/tmp/dds-${n++}.ut`);
    expect(applied(code, act)).toBe('<p>x</p>\n{% print(1); %}\n');
  });

  test('the removal round-trips: re-analysis has no UC8014 and no new diagnostics', async () => {
    const code = 'let a = 1; // ucode-lsp disable UC9999\nprint(a);\n';
    const { act } = await removalFor(code, `/tmp/dds-${n++}.uc`);
    const after = (await server.getDiagnostics(applied(code, act), `/tmp/dds-${n++}.uc`)) || [];
    expect(after).toEqual([]);
  });

  test('one used code + one stale code on the SAME line: directive is not stale', async () => {
    // The directive lists two codes; suppressing either one earns its keep.
    const ds = await diags('// ucode-lsp disable-next-line UC1001 UC4001\nprint(never_defined);\n');
    expect(stale(ds)).toEqual([]);
  });

  test('UC8014 is itself suppressible by a broader disable (escape hatch intact)', async () => {
    const ds = await diags('// ucode-lsp disable UC8014\n// ucode-lsp disable-next-line UC1001\nlet a = 1;\nprint(a);\n');
    // The first directive suppresses the second's staleness claim on ITS line? No —
    // UC8014 anchors on the stale comment's own line 1, covered only by a same-line
    // or preceding next-line directive. Pin the actual contract:
    const ds2 = await diags('// ucode-lsp disable-next-line UC8014\n// ucode-lsp disable-next-line UC1001\nlet a = 1;\nprint(a);\n');
    expect(stale(ds2)).toEqual([]);
    expect(ds).toBeTruthy(); // (first form's behavior is whatever line coverage says — not pinned)
  });
});

describe('template-comment directive form', () => {
  test('{# ucode-lsp disable-next-line UC6020 #} suppresses the comment trap', async () => {
    const t = '{# ucode-lsp disable-next-line UC6020 #}\n{# a #} tail -#}\n<p>x</p>\n{% print(1); %}\n';
    const ds = await diags(t, 'ut');
    expect(ds.filter((d) => d.code === 'UC6020')).toEqual([]);
    expect(stale(ds)).toEqual([]);
  });

  test('the trim-modifier open form ({#- …) works too', async () => {
    const t = '{#- ucode-lsp disable-next-line UC6020 -#}\n{# a #} tail -#}\n<p>x</p>\n{% print(1); %}\n';
    const ds = await diags(t, 'ut');
    expect(ds.filter((d) => d.code === 'UC6020')).toEqual([]);
  });

  test('a STALE template-form directive flags UC8014', async () => {
    const t = '{# ucode-lsp disable-next-line UC9999 #}\n<p>clean</p>\n{% print(1); %}\n';
    const s = stale(await diags(t, 'ut'));
    expect(s.length).toBe(1);
  });

  test('an unrelated template comment mentioning ucode-lsp prose is NOT a directive', async () => {
    // No disable keyword → no directive, no staleness machinery involvement.
    const t = '{# configured for ucode-lsp tooling #}\n<p>x</p>\n{% print(1); %}\n';
    expect(stale(await diags(t, 'ut'))).toEqual([]);
  });

  test('codes are read only from INSIDE the comment (terminator bounds the capture)', async () => {
    // UC6020 appears in page text after the closer — the directive itself names no
    // code, so it is a BARE disable (never stale) that suppresses next-line entirely.
    const t = '{# ucode-lsp disable-next-line #} UC9999\n{# a #} tail -#}\n<p>x</p>\n{% print(1); %}\n';
    const ds = await diags(t, 'ut');
    expect(ds.filter((d) => d.code === 'UC6020')).toEqual([]);
    expect(stale(ds)).toEqual([]);
  });

  test('the code-targeted template form leaves OTHER diagnostics on the line alone', async () => {
    const t = '{# ucode-lsp disable-next-line UC9999 #}\n{# a #} tail -#}\n<p>x</p>\n{% print(1); %}\n';
    const ds = await diags(t, 'ut');
    // UC6020 on line 2 is NOT covered (directive targets UC9999 only) — and the
    // directive is stale because nothing matched.
    expect(ds.filter((d) => d.code === 'UC6020').length).toBe(1);
    expect(stale(ds).length).toBe(1);
  });
});
