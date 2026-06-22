// Phase 4b — include() render-scope: cross-file index, suppression, and host enforcement.
// Behavior is grounded in the ucode oracle (ucode/utpl): include(path, scope) injects the
// scope object's keys as the included file's globals (builtins stay available); a non-provided
// var is null in non-strict and a Reference error in strict; path resolves relative to the
// includer's directory. See test-include-scope-oracle.test.js for live oracle parity.

import { test, expect, describe } from 'bun:test';
import { UcodeLexer, detectTemplateMode, bridgeTemplateTokens } from '../../src/lexer/index.ts';
import { UcodeParser } from '../../src/parser/ucodeParser.ts';
import { SemanticAnalyzer } from '../../src/analysis/semanticAnalyzer.ts';
import {
  resolveIncludePath, computeFreeVariables, buildIncludeScopeIndex, checkIncludeScopes,
} from '../../src/analysis/includeScope.ts';

function parse(src) {
  const isT = detectTemplateMode(src);
  const toks = new UcodeLexer(src, { rawMode: !isT }).tokenize();
  return new UcodeParser(isT ? bridgeTemplateTokens(toks) : toks, src).parse().ast;
}
const free = (src) => [...computeFreeVariables(parse(src))].sort();
function analyzeErrors(src, injectedNames) {
  const doc = { getText: () => src, positionAt: (o) => ({ line: 0, character: o }), offsetAt: (p) => p.character, uri: 'file:///t.uc', languageId: 'ucode', version: 1 };
  const an = new SemanticAnalyzer(doc, { enableScopeAnalysis: true, enableTypeChecking: true });
  if (injectedNames) an.setInjectedScope(new Set(injectedNames));
  // Errors (1) AND warnings (2): an undefined-variable read is an Error under
  // 'use strict' but a Warning in non-strict (it reads as null at runtime). These
  // template fixtures are non-strict, so the suppression-logic checks below must
  // see the warning-severity diagnostics too.
  return an.analyze(parse(src)).diagnostics.filter((d) => d.severity <= 2).map((d) => d.message);
}
const undefinedVars = (msgs) => msgs.filter((m) => /Undefined variable|Undefined function/.test(m));

// ───────────────────────────── resolveIncludePath ─────────────────────────────
describe('resolveIncludePath (relative to includer dir, per oracle)', () => {
  test('bare name resolves in includer dir', () => {
    expect(resolveIncludePath('rule.uc', '/w/templates/ruleset.uc')).toBe('/w/templates/rule.uc');
  });
  test('subdir path', () => {
    expect(resolveIncludePath('sub/leaf.uc', '/w/p.uc')).toBe('/w/sub/leaf.uc');
  });
  test('path with a leading subdir from a top-level file', () => {
    expect(resolveIncludePath('templates/ruleset.uc', '/w/firewall4/main.uc')).toBe('/w/firewall4/templates/ruleset.uc');
  });
  test('parent traversal ..', () => {
    expect(resolveIncludePath('../shared/x.uc', '/w/a/b.uc')).toBe('/w/shared/x.uc');
  });
  test('absolute path normalized as-is', () => {
    expect(resolveIncludePath('/usr/lib/uvol/uci.uc', '/w/lvm.uc')).toBe('/usr/lib/uvol/uci.uc');
  });
  test('redundant ./ segments collapse', () => {
    expect(resolveIncludePath('./a/./b.uc', '/w/x.uc')).toBe('/w/a/b.uc');
  });
});

// ───────────────────────────── computeFreeVariables ─────────────────────────────
describe('computeFreeVariables', () => {
  test('a bare read is free', () => expect(free('foo;')).toEqual(['foo']));
  test('a let-declared name is not free', () => expect(free('let x = 1; x;')).toEqual([]));
  test('const-declared name is not free', () => expect(free('const y = 1; y + 1;')).toEqual([]));
  test('reads minus declarations', () => expect(free('let a = b; a;')).toEqual(['b']));
  test('function params are bound', () => expect(free('function f(a) { return a + b; }')).toEqual(['b']));
  test('function name is bound (callable later)', () => expect(free('function f() {} f();')).toEqual([]));
  test('arrow params are bound', () => expect(free('let g = (x) => x + y;')).toEqual(['y']));
  test('member property is not a free var', () => expect(free('obj.foo.bar;')).toEqual(['obj']));
  test('computed member key IS read', () => expect(free('obj[key];')).toEqual(['key', 'obj']));
  test('object literal value is read, key is not', () => expect(free('let o = { name: val };')).toEqual(['val']));
  test('shorthand object property reads the variable', () => expect(free('let o = { val };')).toEqual(['val']));
  test('for-in declared var (let) is bound', () => expect(free('for (let k in items) k;')).toEqual(['items']));
  test('bare for-in var is bound (implicit global)', () => expect(free('for (k in items) k;')).toEqual(['items']));
  test('classic for loop induction var', () => expect(free('for (let i = 0; i < n; i++) i;')).toEqual(['n']));
  test('nested-function free var bubbles up', () => expect(free('function a() { function b() { return z; } }')).toEqual(['z']));
  test('multiple frees deduped + sorted', () => expect(free('p; q; p; r;')).toEqual(['p', 'q', 'r']));
  test('template interpolations contribute frees', () => expect(free('x={{ foo }} y={{ bar }}')).toEqual(['bar', 'foo']));
});

// ───────────────────────────── buildIncludeScopeIndex ─────────────────────────────
describe('buildIncludeScopeIndex', () => {
  const idxOf = (files) => buildIncludeScopeIndex(files.map((f) => ({ path: f.path, ast: parse(f.src) })));

  test('single include site maps target → keys', () => {
    const idx = idxOf([{ path: '/w/p.uc', src: '{% include("c.uc", { a, b }); %}' }]);
    expect([...idx.get('/w/c.uc').injectedNames].sort()).toEqual(['a', 'b']);
  });
  test('two sites to same target union their keys', () => {
    const idx = idxOf([
      { path: '/w/p1.uc', src: '{% include("c.uc", { a }); %}' },
      { path: '/w/p2.uc', src: '{% include("c.uc", { b, c }); %}' },
    ]);
    expect([...idx.get('/w/c.uc').injectedNames].sort()).toEqual(['a', 'b', 'c']);
    expect(idx.get('/w/c.uc').sites.length).toBe(2);
  });
  test('a dynamic scope marks the entry incomplete', () => {
    const idx = idxOf([{ path: '/w/p.uc', src: '{% include("c.uc", { a, ...rest }); %}' }]);
    expect(idx.get('/w/c.uc').complete).toBe(false);
    expect([...idx.get('/w/c.uc').injectedNames]).toEqual(['a']);
  });
  test('transitive: injected scope leaks down nested includes (oracle-verified)', () => {
    const idx = idxOf([
      { path: '/w/grand.uc', src: '{% include("parent.uc", { fw4 }); %}' },
      { path: '/w/parent.uc', src: '{% include("child.uc", { other }); %}' },
    ]);
    // child receives `other` (its site) AND `fw4` (leaked from parent's scope)
    expect([...idx.get('/w/child.uc').injectedNames].sort()).toEqual(['fw4', 'other']);
    expect(idx.get('/w/child.uc').complete).toBe(true);
  });
  test('a recursive (self) include reaches a fixpoint', () => {
    const idx = idxOf([
      { path: '/w/r.uc', src: '{% include("zv.uc", { fw4, zone }); %}' },
      { path: '/w/zv.uc', src: '{% include("zv.uc", { fw4, zone, extra }); %}' },
    ]);
    expect([...idx.get('/w/zv.uc').injectedNames].sort()).toEqual(['extra', 'fw4', 'zone']);
  });
  test('bare include (no scope) creates no entry', () => {
    const idx = idxOf([{ path: '/w/p.uc', src: '{% include("c.uc"); %}' }]);
    expect(idx.get('/w/c.uc')).toBeUndefined();
  });
  test('non-literal path is not indexed', () => {
    const idx = idxOf([{ path: '/w/p.uc', src: '{% include(dyn, { a }); %}' }]);
    expect(idx.size).toBe(0);
  });
  test('paths resolve relative to each includer', () => {
    const idx = idxOf([{ path: '/w/templates/ruleset.uc', src: '{% include("rule.uc", { fw4 }); %}' }]);
    expect(idx.has('/w/templates/rule.uc')).toBe(true);
  });
  test('self-include (recursive template) is indexed', () => {
    const idx = idxOf([{ path: '/w/zv.uc', src: '{% include("zv.uc", { fw4, zone }); %}' }]);
    expect([...idx.get('/w/zv.uc').injectedNames].sort()).toEqual(['fw4', 'zone']);
  });
});

// ───────────────────────────── analyzer suppression ─────────────────────────────
describe('analyzer suppression via setInjectedScope', () => {
  test('without scope, frees are UC1001', () => {
    expect(undefinedVars(analyzeErrors('{{ foo }} {{ bar }}')).length).toBe(2);
  });
  test('injected names are not flagged', () => {
    expect(undefinedVars(analyzeErrors('{{ foo }} {{ bar }}', ['foo', 'bar']))).toEqual([]);
  });
  test('a non-injected free (typo) is still flagged', () => {
    const errs = undefinedVars(analyzeErrors('{{ foo }} {{ zoen }}', ['foo', 'zone']));
    expect(errs.length).toBe(1);
    expect(errs[0]).toContain('zoen');
  });
  test('calling an injected name is not "Undefined function"', () => {
    expect(undefinedVars(analyzeErrors('{% gauge("x"); %}', ['gauge']))).toEqual([]);
  });
  test('member access on an injected name does not error', () => {
    expect(undefinedVars(analyzeErrors('{% fw4.set(x); %}', ['fw4', 'x']))).toEqual([]);
  });
  test('injected scope works under "use strict" (oracle: provided var is valid in strict)', () => {
    const errs = undefinedVars(analyzeErrors("{% 'use strict'; print(foo); %}", ['foo']));
    expect(errs).toEqual([]);
  });
  test('strict: a non-injected var is still flagged', () => {
    const errs = undefinedVars(analyzeErrors("{% 'use strict'; print(nope); %}", ['foo']));
    expect(errs.length).toBeGreaterThan(0);
  });
  test('builtins are always available regardless of scope (oracle T1)', () => {
    expect(undefinedVars(analyzeErrors('{{ length("x") }}', []))).toEqual([]);
  });
  test('a locally-declared name needs no injection', () => {
    expect(undefinedVars(analyzeErrors('{% let x = 1; %}{{ x }}', []))).toEqual([]);
  });
  test('empty injected scope changes nothing for a real typo', () => {
    expect(undefinedVars(analyzeErrors('{{ typo }}', [])).length).toBe(1);
  });
});

// ───────────────────────────── host enforcement (checkIncludeScopes) ─────────────────────────────
describe('checkIncludeScopes (host-side enforcement)', () => {
  const isAmbient = (n) => ['length', 'printf', 'print', 'type', 'exists', 'include', 'require'].includes(n);
  const run = (includerSrc, targets, includerScope) => {
    const includerAst = parse(includerSrc);
    const getFree = (resolved) => {
      const t = targets[resolved];
      return t === undefined ? null : computeFreeVariables(parse(t));
    };
    return checkIncludeScopes(includerAst, '/w/p.uc', getFree, isAmbient, includerScope);
  };

  test('a missing scope key is flagged at the include site', () => {
    const d = run('{% include("c.uc", { foo }); %}', { '/w/c.uc': '{{ foo }} {{ bar }}' });
    expect(d.length).toBe(1);
    expect(d[0].missing).toEqual(['bar']);
    expect(d[0].message).toContain("'bar'");
  });
  test('a fully-satisfied scope produces no finding', () => {
    expect(run('{% include("c.uc", { foo, bar }); %}', { '/w/c.uc': '{{ foo }} {{ bar }}' })).toEqual([]);
  });
  test('builtins used by the target are not "missing"', () => {
    expect(run('{% include("c.uc", { foo }); %}', { '/w/c.uc': '{{ foo }} {{ length("x") }}' })).toEqual([]);
  });
  test('a dynamic scope is not enforced (key set not exhaustive)', () => {
    expect(run('{% include("c.uc", { foo, ...rest }); %}', { '/w/c.uc': '{{ foo }} {{ bar }}' })).toEqual([]);
  });
  test('a bare include (no scope) is not enforced', () => {
    expect(run('{% include("c.uc"); %}', { '/w/c.uc': '{{ bar }}' })).toEqual([]);
  });
  test('an unresolvable/unparsed target is skipped', () => {
    expect(run('{% include("missing.uc", { foo }); %}', {})).toEqual([]);
  });
  test('multiple missing keys are listed sorted', () => {
    const d = run('{% include("c.uc", { a }); %}', { '/w/c.uc': '{{ a }} {{ z }} {{ m }}' });
    expect(d[0].missing).toEqual(['m', 'z']);
  });
  test('target locals are not flagged as missing', () => {
    expect(run('{% include("c.uc", { foo }); %}', { '/w/c.uc': '{% let local = 1; %}{{ foo }} {{ local }}' })).toEqual([]);
  });
  test('two include sites are checked independently', () => {
    const d = run('{% include("a.uc", { x }); include("b.uc", { y }); %}', {
      '/w/a.uc': '{{ x }}', '/w/b.uc': '{{ y }} {{ missing }}',
    });
    expect(d.length).toBe(1);
    expect(d[0].missing).toEqual(['missing']);
  });
  test('a var leaked from the includer’s own scope is NOT flagged (transitive, oracle-verified)', () => {
    // includer has fw4 in its transitive scope; the site omits it, but it leaks into the child.
    const d = run('{% include("c.uc", { zone }); %}', { '/w/c.uc': '{{ fw4.set(zone) }}' },
      { names: new Set(['fw4', 'rule', 'egress']), complete: true });
    expect(d).toEqual([]);
  });
  test('an incomplete includer scope disables enforcement (cannot prove missing)', () => {
    const d = run('{% include("c.uc", { zone }); %}', { '/w/c.uc': '{{ anything }}' },
      { names: new Set(['zone']), complete: false });
    expect(d).toEqual([]);
  });
  test('still flags a var provided by neither the site nor the leaked scope', () => {
    const d = run('{% include("c.uc", { zone }); %}', { '/w/c.uc': '{{ zone }} {{ fw4 }} {{ typo }}' },
      { names: new Set(['fw4']), complete: true });
    expect(d[0].missing).toEqual(['typo']);
  });
});

// ───────────────────────────── end-to-end (index → suppress) ─────────────────────────────
describe('end-to-end: index a parent, suppress in the child', () => {
  const childErrors = (parentSrc, childPath, childSrc) => {
    const idx = buildIncludeScopeIndex([{ path: '/w/parent.uc', ast: parse(parentSrc) }]);
    const entry = idx.get(childPath);
    return undefinedVars(analyzeErrors(childSrc, entry ? [...entry.injectedNames] : []));
  };

  test('parent provides → child clean', () => {
    expect(childErrors('{% include("child.uc", { fw4, zone, rule }); %}', '/w/child.uc',
      '{{ fw4.x }} {{ zone }} {{ rule }}')).toEqual([]);
  });
  test('parent omits one → child flags exactly that one', () => {
    const errs = childErrors('{% include("child.uc", { fw4, zone }); %}', '/w/child.uc',
      '{{ fw4 }} {{ zone }} {{ rule }}');
    expect(errs.length).toBe(1);
    expect(errs[0]).toContain('rule');
  });
  test('child not included anywhere → all frees flagged (no scope)', () => {
    expect(childErrors('{% include("other.uc", { a }); %}', '/w/child.uc', '{{ p }} {{ q }}').length).toBe(2);
  });
});
