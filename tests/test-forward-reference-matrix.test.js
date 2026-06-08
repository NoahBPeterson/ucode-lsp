// Exhaustive matrix (50 cases) for ucode's no-hoisting semantics: a reference to a
// function declared LATER in scope is a runtime error ("access to undeclared
// variable" / "not a function" — verified against the interpreter). Calls AND value
// references (callback args, assignments) are caught; backward refs, recursion, and
// explicit `function f;` forward declarations are clean.
const { test, expect, beforeAll, afterAll } = require('bun:test');
const { createLSPTestServer } = require('./lsp-test-helpers');

let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

async function ds(content) { return (await server.getDiagnostics(content, `/tmp/frm-${n++}.uc`)) || []; }
const usedBefore = (d, name) => d.filter(x => x.message.includes(`Function '${name}' is used before its declaration`));
const undefFn = (d, name) => d.filter(x => x.message.includes(`Undefined function: ${name}`));
const errsFor = (d, name) => d.filter(x => x.severity === 1 && x.message.includes(name));

// ── A. Calls: forward vs backward ────────────────────────────────────────────
test('01 plain forward call is flagged', async () => {
  expect(usedBefore(await ds('function a(){ return b(); }\nfunction b(){ return 1; }\n'), 'b').length).toBeGreaterThan(0);
});
test('02 plain backward call is clean', async () => {
  expect(usedBefore(await ds('function b(){ return 1; }\nfunction a(){ return b(); }\n'), 'b').length).toBe(0);
});
test('03 export forward call is flagged', async () => {
  expect(usedBefore(await ds('export function a(){ return b(); }\nexport function b(){ return 1; }\n'), 'b').length).toBeGreaterThan(0);
});
test('04 export backward call is clean', async () => {
  expect(usedBefore(await ds('export function b(){ return 1; }\nexport function a(){ return b(); }\n'), 'b').length).toBe(0);
});
test('05 top-level forward call is flagged', async () => {
  expect(usedBefore(await ds('foo();\nfunction foo(){ return 1; }\n'), 'foo').length).toBeGreaterThan(0);
});
test('06 top-level backward call is clean', async () => {
  expect(usedBefore(await ds('function foo(){ return 1; }\nfoo();\n'), 'foo').length).toBe(0);
});
test('07 recursion (self-call) is clean', async () => {
  expect(usedBefore(await ds('function fac(n){ return n<=1 ? 1 : n*fac(n-1); }\nfac(5);\n'), 'fac').length).toBe(0);
});
test('08 genuinely undefined call is "Undefined function", not "used before"', async () => {
  const d = await ds('function f(){ return nope(); }\n');
  expect(undefFn(d, 'nope').length).toBeGreaterThan(0);
  expect(usedBefore(d, 'nope').length).toBe(0);
});

// ── B. Mutual recursion ──────────────────────────────────────────────────────
test('09 mutual recursion: the forward half is flagged', async () => {
  expect(usedBefore(await ds('function isEven(n){ return n==0 || isOdd(n-1); }\nfunction isOdd(n){ return n!=0 && isEven(n-1); }\n'), 'isOdd').length).toBeGreaterThan(0);
});
test('10 mutual recursion: the backward half is clean', async () => {
  expect(usedBefore(await ds('function isEven(n){ return n==0 || isOdd(n-1); }\nfunction isOdd(n){ return n!=0 && isEven(n-1); }\n'), 'isEven').length).toBe(0);
});
test('11 mutual recursion with both forward-declared is clean', async () => {
  const d = await ds('function isEven;\nfunction isOdd;\nfunction isEven(n){ return n==0 || isOdd(n-1); }\nfunction isOdd(n){ return n!=0 && isEven(n-1); }\n');
  expect(usedBefore(d, 'isOdd').length).toBe(0);
  expect(usedBefore(d, 'isEven').length).toBe(0);
});

// ── C. Forward declarations (`function f;`) ─────────────────────────────────
test('12 forward decl + later def + backward call is clean', async () => {
  expect((await ds('function f;\nfunction f(){ return 1; }\nf();\n')).filter(x => x.severity === 1).length).toBe(0);
});
test('13 a forward decl makes a forward call clean', async () => {
  expect(usedBefore(await ds('function f;\nfunction a(){ return f(); }\nfunction f(){ return 1; }\n'), 'f').length).toBe(0);
});
test('14 forward decl never defined is "forward-declaration-never-defined", not "used before"', async () => {
  const d = await ds('function ghost;\nghost();\n');
  expect(d.some(x => x.code === 'forward-declaration-never-defined')).toBe(true);
  expect(usedBefore(d, 'ghost').length).toBe(0);
});
test('15 an exported forward decl is not flagged as never-defined', async () => {
  expect((await ds('function ghost;\nexport { ghost };\n')).some(x => x.code === 'forward-declaration-never-defined')).toBe(false);
});
test('16 a forward declaration AFTER the use does not rescue it', async () => {
  expect(usedBefore(await ds('a();\nfunction f;\nfunction f(){ return 1; }\nfunction a(){ return 1; }\n'), 'a').length).toBeGreaterThan(0);
});

// ── D. Value references (assignment / callback arg) ──────────────────────────
test('17 forward value reference (assignment) is flagged', async () => {
  expect(usedBefore(await ds('let cb = later;\nfunction later(){ return 1; }\n'), 'later').length).toBeGreaterThan(0);
});
test('18 backward value reference is clean', async () => {
  expect(usedBefore(await ds('function later(){ return 1; }\nlet cb = later;\n'), 'later').length).toBe(0);
});
test('19 forward callback-argument reference is flagged (it crashes at runtime)', async () => {
  expect(usedBefore(await ds('let r = map([1], later);\nfunction later(x){ return x; }\n'), 'later').length).toBeGreaterThan(0);
});
test('20 backward callback-argument reference is clean', async () => {
  expect(usedBefore(await ds('function later(x){ return x; }\nlet r = map([1], later);\n'), 'later').length).toBe(0);
});
test('21 recursive value reference (function refers to itself) is clean', async () => {
  expect(usedBefore(await ds('function f(){ let self = f; return self; }\n'), 'f').length).toBe(0);
});
test('22 forward value reference inside an array literal is flagged', async () => {
  expect(usedBefore(await ds('let a = [later];\nfunction later(){ return 1; }\n'), 'later').length).toBeGreaterThan(0);
});

// ── E. Nested functions ──────────────────────────────────────────────────────
test('23 a nested forward call is flagged', async () => {
  expect(errsFor(await ds('function o(){ a(); function a(){ return 1; } }\n'), 'a').length).toBeGreaterThan(0);
});
test('24 a nested backward call is clean', async () => {
  expect((await ds('function o(){ function a(){ return 1; } return a(); }\n')).filter(x => x.severity === 1).length).toBe(0);
});
test('25 an inner function calling its enclosing function is clean', async () => {
  expect((await ds('function outer(){ function inner(){ return outer(); } return inner(); }\n')).filter(x => x.severity === 1).length).toBe(0);
});
test('26 a sibling nested forward call is flagged', async () => {
  expect(errsFor(await ds('function o(){ function a(){ return b(); } function b(){ return 1; } return a(); }\n'), 'b').length).toBeGreaterThan(0);
});
test('27 nested recursion is clean', async () => {
  expect((await ds('function o(){ function fac(n){ return n<=1?1:n*fac(n-1); } return fac(3); }\n')).filter(x => x.severity === 1).length).toBe(0);
});

// ── F. Forward calls inside control-flow bodies ──────────────────────────────
test('28 forward call inside an if body is flagged', async () => {
  expect(usedBefore(await ds('if (1) { foo(); }\nfunction foo(){ return 1; }\n'), 'foo').length).toBeGreaterThan(0);
});
test('29 forward call inside a for loop is flagged', async () => {
  expect(usedBefore(await ds('for (let i=0;i<1;i++) { foo(); }\nfunction foo(){ return 1; }\n'), 'foo').length).toBeGreaterThan(0);
});
test('30 forward call inside a while loop is flagged', async () => {
  expect(usedBefore(await ds('while (0) { foo(); }\nfunction foo(){ return 1; }\n'), 'foo').length).toBeGreaterThan(0);
});
test('31 forward call inside a try block is flagged', async () => {
  expect(usedBefore(await ds('try { foo(); } catch (e) {}\nfunction foo(){ return 1; }\n'), 'foo').length).toBeGreaterThan(0);
});

// ── G. Function-expression / arrow variables ─────────────────────────────────
test('32 forward call to a function-expression variable is flagged', async () => {
  expect(errsFor(await ds('foo();\nlet foo = function(){ return 1; };\n'), 'foo').length).toBeGreaterThan(0);
});
test('33 forward call to an arrow variable is flagged', async () => {
  expect(errsFor(await ds('foo();\nlet foo = () => 1;\n'), 'foo').length).toBeGreaterThan(0);
});
test('34 backward call to a function-expression variable is clean', async () => {
  expect((await ds('let foo = function(){ return 1; };\nfoo();\n')).filter(x => x.severity === 1).length).toBe(0);
});
test('35 backward call to an arrow variable is clean', async () => {
  expect((await ds('let foo = () => 1;\nfoo();\n')).filter(x => x.severity === 1).length).toBe(0);
});

// ── H. Export forms ──────────────────────────────────────────────────────────
test('36 forward call to an `export default function` is flagged', async () => {
  expect(usedBefore(await ds('caller();\nexport default function caller(){ return 1; }\n'), 'caller').length).toBeGreaterThan(0);
});
test('37 backward call to an `export default function` is clean', async () => {
  expect(usedBefore(await ds('export default function caller(){ return 1; }\ncaller();\n'), 'caller').length).toBe(0);
});
test('38 export-specifier-before-decl is not reported as "used before" (degenerate)', async () => {
  expect(usedBefore(await ds('function foo(){ return 1; }\nexport { foo };\n'), 'foo').length).toBe(0);
});

// ── I. Non-references (comments / strings) ───────────────────────────────────
test('39 a forward "reference" in a comment is not flagged', async () => {
  expect((await ds('// foo();\nfunction foo(){ return 1; }\nfoo();\n')).filter(x => x.severity === 1).length).toBe(0);
});
test('40 a forward "reference" in a string is not flagged', async () => {
  expect((await ds('let s = "foo()";\nfunction foo(){ return 1; }\nfoo();\n')).filter(x => x.severity === 1).length).toBe(0);
});
test('41 a comment mentioning the name does not affect a real backward call', async () => {
  expect((await ds('function foo(){ return 1; }\n// call foo here\nfoo();\n')).filter(x => x.severity === 1).length).toBe(0);
});

// ── J. Chains / mixed ────────────────────────────────────────────────────────
test('42 a forward chain flags each forward link', async () => {
  const d = await ds('function a(){ return b(); }\nfunction b(){ return c(); }\nfunction c(){ return 1; }\n');
  expect(usedBefore(d, 'b').length).toBeGreaterThan(0); // a→b forward
  expect(usedBefore(d, 'c').length).toBeGreaterThan(0); // b→c forward
});
test('43 a backward chain is entirely clean', async () => {
  const d = await ds('function c(){ return 1; }\nfunction b(){ return c(); }\nfunction a(){ return b(); }\n');
  expect(d.filter(x => x.severity === 1).length).toBe(0);
});
test('44 mixed file: only the forward reference is flagged', async () => {
  const d = await ds('function helper(){ return 1; }\nfunction usesHelper(){ return helper(); }\nfunction usesLater(){ return later(); }\nfunction later(){ return 2; }\n');
  expect(usedBefore(d, 'helper').length).toBe(0);  // backward
  expect(usedBefore(d, 'later').length).toBeGreaterThan(0); // forward
});

// ── K. Diagnostic shape ──────────────────────────────────────────────────────
test('45 a forward-call diagnostic has Error severity', async () => {
  const d = usedBefore(await ds('function a(){ return b(); }\nfunction b(){ return 1; }\n'), 'b');
  expect(d[0].severity).toBe(1);
});
test('46 the message includes the `function f;` forward-declaration hint', async () => {
  const d = usedBefore(await ds('function a(){ return b(); }\nfunction b(){ return 1; }\n'), 'b');
  expect(d[0].message).toContain('forward declaration `function b;`');
});
test('47 a forward CALL carries code UC1009', async () => {
  const d = usedBefore(await ds('function a(){ return b(); }\nfunction b(){ return 1; }\n'), 'b');
  expect(d[0].code).toBe('UC1009');
});
test('48 a forward VALUE reference carries code UC1009', async () => {
  const d = usedBefore(await ds('let cb = later;\nfunction later(){ return 1; }\n'), 'later');
  expect(d[0].code).toBe('UC1009');
});

// ── L. Precision ─────────────────────────────────────────────────────────────
test('49 a call immediately after the declaration is clean', async () => {
  expect(usedBefore(await ds('function f(){ return 1; }\nf();\n'), 'f').length).toBe(0);
});
test('50 two forward references to the same function are both flagged', async () => {
  const d = usedBefore(await ds('function a(){ return b(); }\nfunction c(){ return b(); }\nfunction b(){ return 1; }\n'), 'b');
  expect(d.length).toBe(2);
});
