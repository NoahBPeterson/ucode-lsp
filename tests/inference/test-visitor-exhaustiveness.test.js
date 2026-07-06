// BaseVisitor (src/analysis/visitor.ts) dispatch is now exhaustive over AstNodeKind (a `never`
// guard in the default), and the previously-missing container cases traverse their children.
// LogicalExpression was an oversight — structurally identical to BinaryExpression (which was
// handled), so identifiers inside `&&`/`||`/`??` were skipped by the base symbol pass.
const { test, expect } = require('bun:test');
const { BaseVisitor } = require('../../src/analysis/visitor.ts');
const { UcodeLexer } = require('../../src/lexer/ucodeLexer.ts');
const { UcodeParser } = require('../../src/parser/ucodeParser.ts');

class IdCollector extends BaseVisitor {
  constructor() { super(); this.names = []; }
  visitIdentifier(n) { this.names.push(n.name); }
}
const visitedNames = (code) => {
  const lx = new UcodeLexer(code, { rawMode: true });
  const ps = new UcodeParser(lx.tokenize(), code);
  ps.setComments(lx.comments);
  const c = new IdCollector();
  c.visit(ps.parse().ast);
  return c.names;
};

test('BaseVisitor traverses LogicalExpression operands (&& / || / ??)', () => {
  const a = visitedNames("let r = aaa && bbb;");
  expect(a.includes('aaa') && a.includes('bbb')).toBe(true);
  const b = visitedNames("let r = ccc || ddd;");
  expect(b.includes('ccc') && b.includes('ddd')).toBe(true);
});

test('BaseVisitor traverses a ThrowStatement argument', () => {
  expect(visitedNames("function f() { throw boom; }").includes('boom')).toBe(true);
});
