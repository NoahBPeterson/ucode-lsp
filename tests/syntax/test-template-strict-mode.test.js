// Phase 4b — `'use strict'` in ucode templates.
//
// Oracle-verified semantics (ucode/utpl): a template honors `'use strict'` ONLY when the
// `{% 'use strict'; … %}` block leads the file — any preceding text or `{{ }}` compiles to a
// print() statement, making the directive non-first and inert (mirrors raw ucode's
// directive-must-be-first rule). Under strict, an undeclared (non-injected) read is a hard
// Reference error; non-strict it is null. Injected render-scope names are valid in strict too.
//
// Our `detectStrictMode` is template-aware: because the bridge drops leading text, it requires
// the source to start (after shebang/whitespace) with the `{%` block before honoring the directive.

import { test, expect, describe } from 'bun:test';
import { execFileSync } from 'child_process';
import { writeFileSync, mkdtempSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { UcodeLexer, detectTemplateMode, bridgeTemplateTokens } from '../../src/lexer/index.ts';
import { UcodeParser } from '../../src/parser/ucodeParser.ts';
import { SemanticAnalyzer } from '../../src/analysis/semanticAnalyzer.ts';

const UTPL = resolve('ucode/utpl');
const LIBDIR = resolve('ucode');
const od = existsSync(UTPL) ? describe : describe.skip;

function runOracle(src) {
  const dir = mkdtempSync(join(tmpdir(), 'ucstrict-'));
  writeFileSync(join(dir, 't.uc'), src);
  try {
    const out = execFileSync(UTPL, [join(dir, 't.uc')], { env: { ...process.env, DYLD_LIBRARY_PATH: LIBDIR, LD_LIBRARY_PATH: LIBDIR }, encoding: 'utf8' });
    return { ok: true, out };
  } catch (e) { return { ok: false, out: `${e.stdout || ''}${e.stderr || ''}` }; }
}
function analyze(src, injected) {
  const isT = detectTemplateMode(src);
  const ast = new UcodeParser(isT ? bridgeTemplateTokens(new UcodeLexer(src, { rawMode: !isT }).tokenize()) : new UcodeLexer(src, { rawMode: !isT }).tokenize(), src).parse().ast;
  const doc = { getText: () => src, positionAt: (o) => ({ line: 0, character: o }), offsetAt: (p) => p.character, uri: 'file:///t.uc', languageId: 'ucode', version: 1 };
  const an = new SemanticAnalyzer(doc, { enableScopeAnalysis: true, enableTypeChecking: true });
  if (injected) an.setInjectedScope(new Set(injected));
  const ar = an.analyze(ast);
  return { strict: an.strictMode, errors: ar.diagnostics.filter((d) => d.severity === 1).map((d) => d.message) };
}

describe('detectStrictMode for templates (matches oracle directive placement)', () => {
  test('leading {% use strict %} block → strict', () => {
    expect(analyze("{% 'use strict'; %}{{ x }}").strict).toBe(true);
  });
  test('leading TEXT before the directive → not strict (directive inert)', () => {
    expect(analyze("hello{% 'use strict'; %}{{ x }}").strict).toBe(false);
  });
  test('leading {{ }} output before the directive → not strict', () => {
    expect(analyze("{{ 1 }}{% 'use strict'; %}").strict).toBe(false);
  });
  test('leading whitespace before the {% block → NOT strict (whitespace is print()ed text)', () => {
    expect(analyze("\n  {% 'use strict'; %}{{ x }}").strict).toBe(false);
  });
  test('leading {# comment #} block before the directive → strict (comment emits no statement)', () => {
    expect(analyze("{# header #}{% 'use strict'; %}{{ x }}").strict).toBe(true);
  });
  test('raw script directive still detected (unaffected by template guard)', () => {
    expect(analyze("'use strict';\nlet x = 1;").strict).toBe(true);
  });
  test('raw script with a leading comment is still strict', () => {
    expect(analyze("/* hdr */ 'use strict';\nlet a = 1;").strict).toBe(true);
  });
});

od('oracle parity: strict effect in templates', () => {
  test('strict template: undeclared read is a hard error (oracle) and we are strict', () => {
    const src = "{% 'use strict'; %}v={{ undeclared_v }}";
    const r = runOracle(src);
    expect(r.ok).toBe(false);
    expect(r.out).toContain('undeclared variable undeclared_v');
    expect(analyze(src).strict).toBe(true);
  });

  test('leading text makes the directive inert (oracle renders, no error) and we are non-strict', () => {
    const src = "lead {% 'use strict'; print(undeclared_w); %}";
    const r = runOracle(src);
    expect(r.ok).toBe(true);           // not strict → undeclared read is null, no throw
    expect(r.out).toContain('lead');
    expect(analyze(src).strict).toBe(false);
  });

  test('strict template + injected scope: a provided var is valid (oracle), not flagged', () => {
    // parent supplies `foo`; the strict child reads it fine.
    const dir = mkdtempSync(join(tmpdir(), 'ucstrict2-'));
    writeFileSync(join(dir, 'p.uc'), '{% include("c.uc", { foo: 1 }); %}');
    writeFileSync(join(dir, 'c.uc'), "{% 'use strict'; printf('%d', foo); %}");
    let ok = true, out = '';
    try { out = execFileSync(UTPL, [join(dir, 'p.uc')], { env: { ...process.env, DYLD_LIBRARY_PATH: LIBDIR, LD_LIBRARY_PATH: LIBDIR }, encoding: 'utf8' }); }
    catch (e) { ok = false; out = `${e.stdout || ''}${e.stderr || ''}`; }
    expect(ok).toBe(true);
    expect(out).toBe('1');
    // our analysis of the strict child with foo injected: strict + no undefined-var error
    const res = analyze("{% 'use strict'; printf('%d', foo); %}", ['foo']);
    expect(res.strict).toBe(true);
    expect(res.errors.filter((m) => /Undefined/.test(m))).toEqual([]);
  });

  test('strict template + injected scope: a non-provided var errors (oracle) and we flag it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ucstrict3-'));
    writeFileSync(join(dir, 'p.uc'), '{% include("c.uc", { foo: 1 }); %}');
    writeFileSync(join(dir, 'c.uc'), "{% 'use strict'; print(foo); print(nope); %}");
    let ok = true, out = '';
    try { out = execFileSync(UTPL, [join(dir, 'p.uc')], { env: { ...process.env, DYLD_LIBRARY_PATH: LIBDIR, LD_LIBRARY_PATH: LIBDIR }, encoding: 'utf8' }); }
    catch (e) { ok = false; out = `${e.stdout || ''}${e.stderr || ''}`; }
    expect(ok).toBe(false);
    expect(out).toContain('undeclared variable nope');
    const res = analyze("{% 'use strict'; print(foo); print(nope); %}", ['foo']);
    expect(res.errors.some((m) => /nope/.test(m))).toBe(true);
  });
});
