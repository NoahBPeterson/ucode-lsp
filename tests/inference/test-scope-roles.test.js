// The shared, compiler-enforced scope classifier (src/ast/scopeRoles.ts). `SCOPE_ROLE` is a TOTAL
// Record<AstNodeKind, ScopeRole> — a new node kind won't compile until classified — and all the
// function-scope collectors read their bindings through it, so none can silently forget a binding
// construct again (the drift that left computeFreeVariables blind to catch/rest params).
const { test, expect } = require('bun:test');
const { collectScopeBindings, enclosingBindings, functionOwnBindings, SCOPE_ROLE } = require('../../src/ast/scopeRoles.ts');
const { computeFreeVariables } = require('../../src/analysis/includeScope.ts');
const { UcodeLexer } = require('../../src/lexer/ucodeLexer.ts');
const { UcodeParser } = require('../../src/parser/ucodeParser.ts');

const parse = (code) => { const lx = new UcodeLexer(code, { rawMode: true }); const ps = new UcodeParser(lx.tokenize(), code); ps.setComments(lx.comments); return ps.parse().ast; };
const firstFn = (code) => parse(code).body[0];
const bindings = (code) => [...collectScopeBindings(firstFn(code))].sort();
const free = (code) => [...computeFreeVariables(parse(code))].sort();

test('collectScopeBindings covers params, rest, catch, switch-case let, and nested `let`', () => {
  const b = bindings("function f(a, ...rest) { try {} catch (err) {} switch (x) { case 1: let e = 2; } let z; }");
  expect(b).toEqual(['a', 'e', 'err', 'rest', 'z']);
});

test('collectScopeBindings does NOT descend into nested functions (their bindings are their own)', () => {
  const b = bindings("function outer(p) { let a; function inner(q) { let b; } }");
  expect(b.includes('p')).toBe(true);
  expect(b.includes('a')).toBe(true);
  expect(b.includes('inner')).toBe(true);   // the nested function NAME is bound in outer
  expect(b.includes('q')).toBe(false);       // ...but its param/locals are not
  expect(b.includes('b')).toBe(false);
});

test('enclosingBindings / functionOwnBindings split id/param vs own params', () => {
  const fn = firstFn("function g(x, ...ys) {}");
  expect(functionOwnBindings(fn).sort()).toEqual(['x', 'ys']);
  expect(enclosingBindings(fn)).toEqual(['g']);   // the fn NAME binds into the enclosing scope
});

// ── regression: computeFreeVariables no longer blind to catch/rest ────────────
test('computeFreeVariables: a catch param is NOT a free variable', () => {
  expect(free("try { die('x'); } catch (err) { print(err); }").includes('err')).toBe(false);
});

test('computeFreeVariables: a rest param is NOT a free variable', () => {
  expect(free("function f(...args) { print(args); }").includes('args')).toBe(false);
});

// ── totality: every kind the parser can emit is classified (compile-time is the real guard) ──
test('SCOPE_ROLE classifies the binding/scope-opening kinds correctly', () => {
  expect(SCOPE_ROLE['CatchClause'].binds).toBe('param');
  expect(SCOPE_ROLE['VariableDeclarator'].binds).toBe('id');
  expect(SCOPE_ROLE['FunctionDeclaration'].opensFunctionScope).toBe(true);
  expect(SCOPE_ROLE['ArrowFunctionExpression'].opensFunctionScope).toBe(true);
  expect(SCOPE_ROLE['SwitchStatement'].opensBlockScope).toBe(true);
  expect(SCOPE_ROLE['ImportSpecifier'].binds).toBe('import-local');
  expect(SCOPE_ROLE['ExpressionStatement'].binds).toBe('none');
});
