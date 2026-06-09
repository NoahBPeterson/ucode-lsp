// Non-strict ucode auto-creates an implicit GLOBAL on a bare assignment (`x = …`,
// no let/const), and reading any undeclared name returns null with no error (verified
// vs the interpreter). So UC1001 "Undefined variable" must NOT fire for a name that is
// bare-assigned somewhere in a non-strict module — it provably resolves to a real
// global. Genuine typos (read-only, never assigned), declared-elsewhere scoping bugs,
// host-injected member globals, and everything under 'use strict' stay flagged.
const { test, expect, beforeAll, afterAll } = require('bun:test');
const { createLSPTestServer } = require('./lsp-test-helpers');

let server, n = 0;
beforeAll(async () => { server = createLSPTestServer(); await server.initialize(); });
afterAll(() => { try { server.shutdown(); } catch {} });

// names that got a UC1001 "Undefined variable"
async function undef(code) {
  const d = await server.getDiagnostics(code, `/tmp/impg-${n++}.uc`);
  return (d || []).filter((x) => x.code === 'UC1001').map((x) => (x.message || '').replace('Undefined variable: ', ''));
}

// ── A. Suppressed: provable implicit globals (non-strict) ────────────────────
test('01 bare assign + read in same function', async () => expect(await undef('function f(){ g = 1; return g; }\n')).toEqual([]));
test('02 bare assign in one function, read in another', async () => expect(await undef('function set(){ ubidev = null; }\nfunction get(){ return ubidev; }\n')).toEqual([]));
test('03 the bare-assignment target itself is not flagged', async () => expect(await undef('function f(){ cursor = 5; }\n')).toEqual([]));
test('04 read BEFORE the assignment (null-safe) is not flagged', async () => expect(await undef('function f(){ print(x); x = 1; }\n')).toEqual([]));
test('05 `math = require("math")` global is not flagged as undefined variable', async () => expect(await undef('function f(){ math = require("math"); return math; }\n')).toEqual([]));
test('06 a function-valued global (assignment) is not flagged', async () => expect(await undef('function s(){ cb = require("x"); }\nfunction u(){ return cb; }\n')).toEqual([]));
test('07 ret: let in one fn, bare in another → neither flagged', async () => expect(await undef('function a(){ let ret = 1; return ret; }\nfunction b(){ ret = 2; return ret; }\n')).toEqual([]));
test('08 compound assignment (+=) creates an implicit global', async () => expect(await undef('function f(){ acc += 1; return acc; }\n')).toEqual([]));
test('09 update expression (x++) creates an implicit global', async () => expect(await undef('function f(){ counter++; return counter; }\n')).toEqual([]));
test('10 several implicit globals all clear', async () => expect(await undef('function init(){ a=1; b=2; c=3; }\nfunction use(){ return a + b + c; }\n')).toEqual([]));
test('11 bare assign inside an if/for block still creates the global', async () => expect(await undef('function f(x){ if (x) { flag = 1; } for (let i=0;i<1;i++) { ctr = i; } return flag + ctr; }\n')).toEqual([]));
test('12 implicit global used as a call callee — no undefined VARIABLE', async () => {
  // (an "Undefined function" may still appear; we only assert UC1001 is gone)
  expect(await undef('function s(){ doit = require("x"); }\nfunction u(){ return doit(); }\n')).toEqual([]);
});

// ── B. Preserved flagging — the value we keep ────────────────────────────────
test('13 a typo (read-only, never assigned) is STILL flagged', async () => expect(await undef('function f(){ return totallyMissing; }\n')).toEqual(['totallyMissing']));
test('14 read of a name that is only a let-local in another function is STILL flagged', async () => expect(await undef('function a(){ let local = 1; return local; }\nfunction b(){ return local; }\n')).toEqual(['local']));
test('15 a host-injected member-base global (backend.x =) is STILL flagged', async () => expect(await undef('backend.x = 1;\n')).toEqual(['backend']));
test('16 member assignment `o.p =` does NOT make `o` an implicit global', async () => expect(await undef('function f(){ return o.p; }\n')).toContain('o'));
test('17 computed assignment `a[i] =` does NOT make `a` an implicit global', async () => expect(await undef('function f(){ a[0] = 1; }\n')).toContain('a'));
test('18 mixed: one real implicit global + one typo → only the typo flagged', async () => expect(await undef('function f(){ good = 1; return good + bad; }\n')).toEqual(['bad']));

// ── C. Strict mode keeps everything (strict really does error) ───────────────
test('19 strict: a bare assignment is STILL flagged', async () => {
  expect((await undef("'use strict';\nfunction f(){ y = 5; return y; }\n")).length).toBeGreaterThan(0);
});
test('20 strict: a cross-function implicit-global pattern is STILL flagged', async () => {
  expect((await undef("'use strict';\nfunction set(){ z = 1; }\nfunction get(){ return z; }\n")).length).toBeGreaterThan(0);
});
test('21 strict: a properly let-declared local is clean', async () => expect(await undef("'use strict';\nfunction f(){ let ok = 1; return ok; }\n")).toEqual([]));

// ── D. Normal scope resolution is unaffected ─────────────────────────────────
test('22 a let-declared local is clean', async () => expect(await undef('function f(){ let v = 1; return v; }\n')).toEqual([]));
test('23 a parameter is clean', async () => expect(await undef('function f(p){ return p; }\n')).toEqual([]));
test('24 an import is clean', async () => expect(await undef('import * as fs from "fs";\nfunction f(){ return fs.open("x"); }\n')).toEqual([]));
test('25 a builtin is clean', async () => expect(await undef('function f(){ return length([1]); }\n')).toEqual([]));
test('26 a nested-function bare assign read in the outer function', async () => expect(await undef('function outer(){ function inner(){ shared = 1; } inner(); return shared; }\n')).toEqual([]));

// ── E. Interaction / precision ───────────────────────────────────────────────
test('27 the RHS of an implicit-global assignment is still checked (undefined RHS flagged)', async () => {
  // `g = bad` — g becomes an implicit global (clean), but `bad` is read-only → flagged
  expect(await undef('function f(){ g = bad; return g; }\n')).toEqual(['bad']);
});
test('28 implicit global does not leak to suppress a different undefined name', async () => expect(await undef('function f(){ defined = 1; return defined + missing; }\n')).toEqual(['missing']));

// ── F. Real-world (the uvol UBI backend pattern) ─────────────────────────────
test('29 uvol-style: cross-function implicit globals clear, only the host `backend` remains', async () => {
  const code = [
    'import * as fs from "fs";',
    'function read_file(file){ let fp = fs.open(file); return fp ? fp.read("all") : null; }',
    'function ubi_init(ctx){ cursor = ctx.cursor; ubidev = null; ebsize = read_file("x"); uvol_uci_add = ctx.uci_add; uvol_uci_commit = ctx.uci_commit; return true; }',
    'function ubi_get_dev(name){ for (vol_dir in fs.glob("/x")) { let n = read_file(vol_dir); } return ubidev; }',
    'function mkdtemp(){ math = require("math"); return math.rand(); }',
    'function ubi_up(name){ uvol_uci_commit(name); return 0; }',
    'function ubi_detect(){ ret = system("x"); if (ret) return ret; uvol_uci_add("a","b","c"); return 0; }',
    'backend.init = ubi_init;',
    'backend.detect = ubi_detect;',
    '',
  ].join('\n');
  const flagged = await undef(code);
  // every implicit global is clean; only the host-injected `backend` remains
  for (const g of ['cursor', 'ubidev', 'ebsize', 'uvol_uci_add', 'uvol_uci_commit', 'math', 'ret']) {
    expect(flagged).not.toContain(g);
  }
  expect(flagged.every((nm) => nm === 'backend')).toBe(true);
});
test('30 uvol-style: `math = require("math")` produces no UC1001', async () => {
  expect(await undef('function mkdtemp(){ math = require("math"); return math.rand(); }\n')).toEqual([]);
});
