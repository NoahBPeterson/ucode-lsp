// `cond ? a = 1 : b = 2` — the ternary ALTERNATE is an assignment expression, unparenthesized.
// Verified against the interpreter: valid ucode, both branches assign, the ternary yields the
// assignment's value (the C compiler inherits assignability from the enclosing statement via
// its exprstack parent walk). The LSP parser used to parse the alternate at CONDITIONAL
// precedence, excluding the `=`, and the outer Pratt loop then handed the whole ternary to
// parseAssignment → spurious UC6001 "Invalid assignment target".
import { test, expect } from "bun:test";
import { UcodeLexer } from "../../src/lexer/ucodeLexer";
import { UcodeParser } from "../../src/parser/ucodeParser";

const parse = (code) => new UcodeParser(new UcodeLexer(code, { rawMode: true }).tokenize(), code).parse();
const errs = (code) => parse(code).errors.map(e => e.message);

test("unparenthesized assignment in the ternary alternate parses (was UC6001)", () => {
  expect(errs('let x; (true) ? x = "lol" : x = "lolza";')).toEqual([]);
  expect(errs('let l = () => ((true) ? global.S = "a" : global.S = "b");')).toEqual([]);
});

test("the ternary's value is the assignment's value (matches interpreter)", () => {
  expect(errs("let x, y; y = true ? x = 1 : x = 2;")).toEqual([]);
});

test("chained ternaries stay right-associative", () => {
  const ast = parse("x = a ? b : c ? d : e;").ast;
  const tern = ast.body[0].expression.right;
  expect(tern.test.name).toBe("a");
  expect(tern.alternate.type).toBe("ConditionalExpression"); // a ? b : (c ? d : e)
});

test("ordinary alternates unaffected", () => {
  expect(errs("let z = c ? 1 : 2 + 3;")).toEqual([]);
  const alt = parse("let z = c ? 1 : 2 + 3;").ast.body[0].declarations[0].init.alternate;
  expect(alt.type).toBe("BinaryExpression");
});
