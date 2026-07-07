// Batch D — builtin-call validation fixes. Each block cites its auto-docs ticket.
// Runtime-semantics claims verified against the vendored ucode C source:
//   - uc_json / uc_json_from_object (lib.c): accepts a string OR an object/resource
//     with a callable read() method.
//   - uc_push / uc_unshift (lib.c): a value-less call returns NULL.
//   - uc_sort (lib.c): returns the sorted object itself for an object arg.
//   - uc_vm_value_bitop / uc_vm_value_arith (vm.c): both operands run through
//     ucv_to_number(); doubles truncate to int, numeric strings coerce, `n % 0` = NaN.
//   - uc_vm_insn_in (vm.c): the UC_OBJECT case only matches a UC_STRING key.
const { test, expect, beforeAll, afterAll } = require('bun:test');
const { createLSPTestServer } = require('../lsp-test-helpers');

let s;
beforeAll(async () => { s = createLSPTestServer(); await s.initialize(); });
afterAll(() => { try { s.shutdown(); } catch {} });

const diags = async (code, uri) => (await s.getDiagnostics(code, uri)) || [];
const hoverText = async (code, uri, line, ch) => {
  const h = await s.getHover(code, uri, line, ch);
  const c = h && h.contents;
  if (!c) return '';
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(x => (typeof x === 'string' ? x : x.value)).join('\n');
  return c.value || '';
};

// ── #13: json nullable-argument keeps the null-aware default message ──
test('#13 json(string|null arg) reports a null-aware message, not the generic custom one', async () => {
  const code = `function d(b) { return json(b64dec(b)); }\n`;
  const ds = await diags(code, '/tmp/bd-13.uc');
  const d = ds.find(x => x.code === 'nullable-argument' && /json\(\)/.test(x.message));
  expect(d).toBeTruthy();
  expect(d.message).toMatch(/may be null/);
  expect(d.message).not.toMatch(/expects string or object as argument/);
});

// ── #77: bitwise on a double operand is not flagged ──
test('#77 double | integer does not warn (double coerces to int for bitwise)', async () => {
  const ds = await diags(`let a = 1.5; let b = a | 0;\n`, '/tmp/bd-77.uc');
  expect(ds.some(d => /Bitwise operation on unexpected types/.test(d.message))).toBe(false);
});

// ── #79: modulo by a literal zero is always NaN ──
test('#79 n % 0 is flagged as always-NaN (UC2008)', async () => {
  const ds = await diags(`print(10 % 0);\nlet x = 5; print(x % 0);\n`, '/tmp/bd-79.uc');
  const nan = ds.filter(d => d.code === 'UC2008' && /modulo by zero/.test(d.message));
  expect(nan.length).toBe(2);
});
test('#79 division by zero is NOT flagged (Infinity, not NaN)', async () => {
  const ds = await diags(`print(10 / 0);\n`, '/tmp/bd-79b.uc');
  expect(ds.some(d => d.code === 'UC2008')).toBe(false);
});

// ── #89: `in` on an object with a non-string key is always false ──
test('#89 non-string key against an object is flagged always-false', async () => {
  const ds = await diags(`let o = {}; o.a = 1; print(5 in o);\n`, '/tmp/bd-89.uc');
  expect(ds.some(d => /matches only string keys/.test(d.message))).toBe(true);
});
test('#89 a string key against an object is clean', async () => {
  const ds = await diags(`let o = {}; o.a = 1; print("a" in o);\n`, '/tmp/bd-89b.uc');
  expect(ds.some(d => /matches only string keys/.test(d.message))).toBe(false);
});

// ── #133: non-numeric string literal in arithmetic produces NaN ──
test('#133 "abc" - 1 and "5px" * 1 are flagged NaN; "42" - 1 is not', async () => {
  const ds = await diags(`let x = "abc" - 1;\nlet y = "5px" * 1;\nlet z = -"abc";\nlet ok = "42" - 1;\n`, '/tmp/bd-133.uc');
  const nan = ds.filter(d => d.code === 'UC2008' && /produces NaN/.test(d.message));
  expect(nan.length).toBe(3);
});

// ── #134: numeric string literal in a bitwise op is not flagged ──
test('#134 "5" | 2 / "3" << "2" / "5" & 0xFF do not warn', async () => {
  const ds = await diags(`let a = "5" | 2;\nlet b = "3" << "2";\nlet c = "5" & 0xFF;\n`, '/tmp/bd-134.uc');
  expect(ds.some(d => /Bitwise operation on unexpected types/.test(d.message))).toBe(false);
});
test('#134 a non-numeric string in a bitwise op still warns', async () => {
  const ds = await diags(`let a = "abc" | 2;\n`, '/tmp/bd-134b.uc');
  expect(ds.some(d => /Bitwise operation on unexpected types/.test(d.message))).toBe(true);
});

// ── #135: a regexp literal on the LEFT of == / != is flagged too ──
test('#135 /re/ == 1 (regex on the left) is flagged UC2009, symmetrically', async () => {
  const ds = await diags(`let a = /re/ == 1;\nlet b = 1 == /re/;\n`, '/tmp/bd-135.uc');
  const uc2009 = ds.filter(d => d.code === 'UC2009' && /regexp/.test(d.message));
  expect(uc2009.length).toBe(2);
});

// ── #141: json() accepts a readable fs handle ──
test('#141 json(open(...)) is not a false positive', async () => {
  const code = `import { open } from 'fs';\nlet d = json(open('/etc/x.json', 'r'));\nprint(d);\n`;
  const ds = await diags(code, '/tmp/bd-141.uc');
  // The argument-type FP (UC2004 "expects string or object / readable handle") must be gone.
  // (An unrelated UC8001 "wrap json() in try/catch" lint may still fire — that's valid.)
  expect(ds.some(d => /json.*expects/.test(d.message))).toBe(false);
});

// ── #142: too-many-args stays a warning even under 'use strict' ──
test('#142 extra args do not escalate to an error under use strict', async () => {
  const code = `'use strict';\nfunction f(a,b,c){return a+b+c;}\nf(1,2,3,4,5);\n`;
  const ds = await diags(code, '/tmp/bd-142.uc');
  const d = ds.find(x => x.code === 'UC2003' && /extra arguments are ignored/.test(x.message));
  expect(d).toBeTruthy();
  expect(d.severity).toBe(2); // warning, not error (1)
});

// ── #121 / #122 / #123: hover return types ──
test('#121 push(arr) / unshift(arr) with no value hover as null', async () => {
  const code = `let a = ['x','y'];\nlet r = push(a);\nprint(r);\n`;
  const t = await hoverText(code, '/tmp/bd-121.uc', 1, 4); // `r`
  expect(t).toMatch(/`null`/);
});
test('#122 sort(object) hovers as object (no phantom null)', async () => {
  const code = `let r = sort({a:1,b:2});\nprint(r);\n`;
  const t = await hoverText(code, '/tmp/bd-122.uc', 0, 4); // `r`
  expect(t).toMatch(/`object`/);
});
test('#123 values(object) carries the element type', async () => {
  const code = `let a = values({x:1,y:2});\nprint(a);\n`;
  const t = await hoverText(code, '/tmp/bd-123.uc', 0, 4); // `a`
  expect(t).toMatch(/array<integer>/);
});
