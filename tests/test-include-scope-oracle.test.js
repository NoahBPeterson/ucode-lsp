// Phase 4b — LIVE oracle parity. Runs the real ucode template engine (ucode/utpl) on
// generated include() trees to establish ground truth, then asserts our include-scope
// logic matches it. Skips automatically if the locally-built oracle isn't present.

import { test, expect, describe } from 'bun:test';
import { execFileSync } from 'child_process';
import { writeFileSync, mkdtempSync, mkdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname, resolve } from 'path';
import { UcodeLexer, detectTemplateMode, bridgeTemplateTokens } from '../src/lexer/index.ts';
import { UcodeParser } from '../src/parser/ucodeParser.ts';
import {
  resolveIncludePath, computeFreeVariables, buildIncludeScopeIndex, checkIncludeScopes,
} from '../src/analysis/includeScope.ts';

const UTPL = resolve('ucode/utpl');
const LIBDIR = resolve('ucode');
const oracleAvailable = existsSync(UTPL);
const d = oracleAvailable ? describe : describe.skip;

function runOracle(files, entry) {
  const dir = mkdtempSync(join(tmpdir(), 'uc4b-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  try {
    const out = execFileSync(UTPL, [join(dir, entry)], {
      env: { ...process.env, DYLD_LIBRARY_PATH: LIBDIR, LD_LIBRARY_PATH: LIBDIR },
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, out, dir };
  } catch (e) {
    return { ok: false, out: `${e.stdout || ''}${e.stderr || ''}`, dir };
  }
}

const parse = (src) => {
  const isT = detectTemplateMode(src);
  const toks = new UcodeLexer(src, { rawMode: !isT }).tokenize();
  return new UcodeParser(isT ? bridgeTemplateTokens(toks) : toks, src).parse().ast;
};
const isAmbient = (n) => ['length', 'printf', 'print', 'type', 'exists', 'include', 'require', 'sprintf'].includes(n);
function ourMissing(includerSrc, includerPath, targets) {
  const getFree = (resolved) => (targets[resolved] === undefined ? null : computeFreeVariables(parse(targets[resolved])));
  return checkIncludeScopes(parse(includerSrc), includerPath, getFree, isAmbient).flatMap((x) => x.missing);
}

d('oracle parity: include() scope semantics', () => {
  test('provided vars + builtins → oracle runs clean AND we report no missing', () => {
    const r = runOracle({
      'parent.uc': '{% include("child.uc", { foo: 1, bar: 2 }); %}',
      'child.uc': "{% 'use strict'; printf('%d %d %d', foo, bar, length('x')); %}",
    }, 'parent.uc');
    expect(r.ok).toBe(true);
    expect(r.out).toBe('1 2 1');
    const missing = ourMissing('{% include("child.uc", { foo: 1, bar: 2 }); %}', `${r.dir}/parent.uc`,
      { [`${r.dir}/child.uc`]: "{% 'use strict'; printf('%d %d %d', foo, bar, length('x')); %}" });
    expect(missing).toEqual([]);
  });

  test('a non-provided var → oracle (strict) errors AND we flag exactly it', () => {
    const child = "{% 'use strict'; print(foo); print(baz); %}";
    const r = runOracle({ 'parent.uc': '{% include("child.uc", { foo: 1 }); %}', 'child.uc': child }, 'parent.uc');
    expect(r.ok).toBe(false);
    expect(r.out).toContain('undeclared variable baz');
    const missing = ourMissing('{% include("child.uc", { foo: 1 }); %}', `${r.dir}/parent.uc`, { [`${r.dir}/child.uc`]: child });
    expect(missing).toEqual(['baz']);
  });

  test('builtins are ambient without injection (oracle clean, not flagged)', () => {
    const child = "{% 'use strict'; printf('%d', length('abc')); %}";
    const r = runOracle({ 'parent.uc': '{% include("child.uc", {}); %}', 'child.uc': child }, 'parent.uc');
    expect(r.ok).toBe(true);
    expect(r.out).toBe('3');
    expect(ourMissing('{% include("child.uc", {}); %}', `${r.dir}/parent.uc`, { [`${r.dir}/child.uc`]: child })).toEqual([]);
  });

  test('path resolution: subdir target (oracle clean) matches resolveIncludePath', () => {
    const r = runOracle({
      'parent.uc': '{% include("sub/leaf.uc", { v: 7 }); %}',
      'sub/leaf.uc': "{% 'use strict'; printf('%d', v); %}",
    }, 'parent.uc');
    expect(r.ok).toBe(true);
    expect(r.out).toBe('7');
    expect(resolveIncludePath('sub/leaf.uc', `${r.dir}/parent.uc`)).toBe(`${r.dir}/sub/leaf.uc`);
  });

  test('non-scope parent local is NOT visible to child (oracle) — enforcement is sound', () => {
    // secret is a parent local, NOT passed; child reading it is undefined → strict error.
    const child = "{% 'use strict'; print(secret); %}";
    const r = runOracle({ 'parent.uc': '{% let secret = 9; include("child.uc", { foo: 1 }); %}', 'child.uc': child }, 'parent.uc');
    expect(r.ok).toBe(false);
    expect(r.out).toContain('undeclared variable secret');
    expect(ourMissing('{% include("child.uc", { foo: 1 }); %}', `${r.dir}/parent.uc`, { [`${r.dir}/child.uc`]: child })).toEqual(['secret']);
  });

  test('fully-satisfied multi-key scope runs clean and reports nothing', () => {
    const child = "{% 'use strict'; printf('%s-%s-%s', a, b, c); %}";
    const r = runOracle({ 'parent.uc': '{% include("child.uc", { a: "x", b: "y", c: "z" }); %}', 'child.uc': child }, 'parent.uc');
    expect(r.ok).toBe(true);
    expect(r.out).toBe('x-y-z');
    expect(ourMissing('{% include("child.uc", { a:1, b:2, c:3 }); %}', `${r.dir}/parent.uc`, { [`${r.dir}/child.uc`]: child })).toEqual([]);
  });

  test('real firewall4 zone-verdict scope satisfies the template (no missing)', () => {
    const idx = buildIncludeScopeIndex([{
      path: '/w/templates/ruleset.uc',
      ast: parse('{% include("zone-verdict.uc", { fw4, zone, rule, egress: true, verdict }); %}'),
    }]);
    const provided = idx.get('/w/templates/zone-verdict.uc').injectedNames;
    // every free var of the real zone-verdict.uc is provided (or a builtin)
    const zvSrc = require('fs').readFileSync('firewall4/root/usr/share/firewall4/templates/zone-verdict.uc', 'utf8');
    const frees = [...computeFreeVariables(parse(zvSrc))].filter((n) => !isAmbient(n));
    const missing = frees.filter((n) => !provided.has(n));
    expect(missing).toEqual([]);
  });
});
