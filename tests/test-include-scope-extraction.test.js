// Phase 4b foundation: extract include() scope-injection sites (path + scope keys).
// These feed the cross-file pass that suppresses/types a template's render-scope free
// variables and flags scope keys the host fails to provide.

import { test, expect, describe } from 'bun:test';
import { UcodeLexer, detectTemplateMode, bridgeTemplateTokens } from '../src/lexer/index.ts';
import { UcodeParser } from '../src/parser/ucodeParser.ts';
import { extractIncludeSites } from '../src/analysis/includeScope.ts';
import { readFileSync } from 'fs';

// Template files carry their include() calls inside {% %} tags, so they must be parsed
// through the template pipeline (detect + bridge framing) before extraction.
const sites = (src) => {
  const isT = detectTemplateMode(src);
  const toks = new UcodeLexer(src, { rawMode: !isT }).tokenize();
  const ast = new UcodeParser(isT ? bridgeTemplateTokens(toks) : toks, src).parse().ast;
  return extractIncludeSites(ast);
};

describe('extractIncludeSites', () => {
  test('include(path, { shorthand keys })', () => {
    const [s] = sites('include("rule.uc", { fw4, zone, rule });');
    expect(s.path).toBe('rule.uc');
    expect(s.scopeKeys).toEqual(['fw4', 'zone', 'rule']);
    expect(s.hasScope).toBe(true);
    expect(s.hasDynamicScope).toBe(false);
  });

  test('keyed values (computed scope values) still yield static keys', () => {
    const [s] = sites('include("rule.uc", { fw4, zone: null, rule: { ...rule } });');
    expect(s.scopeKeys).toEqual(['fw4', 'zone', 'rule']);
    expect(s.hasDynamicScope).toBe(false);
  });

  test('a spread in the scope marks the key set non-exhaustive', () => {
    const [s] = sites('include("x.uc", { fw4, ...extra });');
    expect(s.scopeKeys).toEqual(['fw4']);
    expect(s.hasDynamicScope).toBe(true);
  });

  test('computed key marks the key set non-exhaustive', () => {
    const [s] = sites('include("x.uc", { fw4, [dyn]: 1 });');
    expect(s.scopeKeys).toEqual(['fw4']);
    expect(s.hasDynamicScope).toBe(true);
  });

  test('a non-literal scope argument is dynamic', () => {
    const [s] = sites('include("x.uc", someScope);');
    expect(s.hasScope).toBe(true);
    expect(s.hasDynamicScope).toBe(true);
    expect(s.scopeKeys).toEqual([]);
  });

  test('bare include(path) injects no scope', () => {
    const [s] = sites('include("x.uc");');
    expect(s.hasScope).toBe(false);
    expect(s.scopeKeys).toEqual([]);
  });

  test('a non-literal path is not reported (cannot be resolved)', () => {
    expect(sites('include(lib + "/x.uc", { a });')).toEqual([]);
  });

  test('finds every include site in the real firewall4 ruleset.uc', () => {
    const src = readFileSync('firewall4/root/usr/share/firewall4/templates/ruleset.uc', 'utf8');
    const found = sites(src);
    expect(found.length).toBeGreaterThan(10);
    // every site has fw4 in scope, and known sub-templates appear
    const paths = new Set(found.map((s) => s.path));
    expect(paths.has('rule.uc')).toBe(true);
    expect(paths.has('zone-verdict.uc')).toBe(true);
    const ruleSite = found.find((s) => s.path === 'rule.uc');
    expect(ruleSite.scopeKeys).toContain('fw4');
    expect(ruleSite.scopeKeys).toContain('rule');
  });
});
