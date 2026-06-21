// ============================================================================
// SAME-FILE incremental-analysis SOUNDNESS suite (pure runIncremental path).
//
// The cardinal invariant of the incremental cache: for ANY edit sequence, the
// diagnostics produced incrementally (reusing the prior step's cache) must be
// byte-identical to a fresh full analysis of the same text. If they ever
// diverge, the cache is serving a stale/false result — a hard failure.
//
// This file is a broad matrix over BODY SHAPES (top-level fn, object method,
// this.x= method, global-writing method, arrow lambda, fn-expression, factory,
// nested objects, return-{} module shape, IIFE, recursion) crossed with EDIT
// KINDS (whitespace, comment, logic, error-in/out, return-type change, returned-
// shape change, this-write-type change, signature change, add/remove/reorder
// unit) and CROSS-BODY semantic dependencies (a skipped reader must never go
// stale when a sibling's derived type changes — the semantic-fingerprint
// fallback). It complements the cross-file suite (real server) and the original
// harness in test-incremental-analysis.test.js.
//
// Where skipping is EXPECTED to engage we also assert it actually did, so a
// passing test reflects real incrementality rather than an accidental no-op.
// ============================================================================

import { test, expect, describe } from 'bun:test';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { UcodeLexer, detectTemplateMode, bridgeTemplateTokens } from '../src/lexer/index.ts';
import { UcodeParser } from '../src/parser/ucodeParser.ts';
import { SemanticAnalyzer } from '../src/analysis/semanticAnalyzer.ts';
import { runIncremental } from '../src/analysis/incrementalAnalysis.ts';

const OPTS = { enableScopeAnalysis: true, enableTypeChecking: true, enableControlFlowAnalysis: true, enableUnusedVariableDetection: true, enableShadowingWarnings: true };

function parse(text) {
  const isT = detectTemplateMode(text);
  const lx = new UcodeLexer(text, { rawMode: !isT });
  const toks = isT ? bridgeTemplateTokens(lx.tokenize()) : lx.tokenize();
  return new UcodeParser(toks, text).parse().ast;
}

function step(text, prevCache) {
  const doc = TextDocument.create('file:///t.uc', 'ucode', 1, text);
  const ast = parse(text);
  const run = (cleanBodies) => {
    const an = new SemanticAnalyzer(doc, OPTS);
    an.setCleanBodies(cleanBodies);
    const res = an.analyze(ast);
    return { diagnostics: res.diagnostics, symbolTable: res.symbolTable };
  };
  const r = runIncremental(doc, ast, prevCache, run);
  return { diagnostics: r.result.diagnostics, cache: r.cache, skipped: r.skipped, redidFull: r.redidFull };
}

const norm = (diags) => diags
  .map((d) => `${d.range.start.line}:${d.range.start.character}-${d.range.end.line}:${d.range.end.character} sev${d.severity} ${d.code || ''} ${d.message}`)
  .sort();

// Run an edit sequence; at EVERY version assert incremental ≡ full. Returns
// aggregate stats so individual tests can assert skip-engagement / full-fallback.
function runSeq(versions) {
  let cache;
  let totalSkipped = 0, redidFullCount = 0;
  const perStep = [];
  for (let i = 0; i < versions.length; i++) {
    const text = versions[i];
    const full = step(text, undefined);
    const inc = step(text, cache);
    expect(norm(inc.diagnostics)).toEqual(norm(full.diagnostics)); // <<< SOUNDNESS
    cache = inc.cache;
    totalSkipped += inc.skipped;
    if (inc.redidFull) redidFullCount++;
    perStep.push({ skipped: inc.skipped, redidFull: inc.redidFull });
  }
  return { totalSkipped, redidFullCount, perStep };
}

// Convenience: assert sound AND that skipping engaged at least once.
function soundAndSkips(versions) {
  const s = runSeq(versions);
  expect(s.totalSkipped).toBeGreaterThan(0);
  return s;
}

// ───────────────────────── builders for body shapes ─────────────────────────
// Each builder takes the interior text of ONE editable body and embeds it in a
// distinct surrounding structure with at least one stable sibling unit.

const topFn = (b) => `function helper(x) {\n${b}\n}\nfunction other(y) {\n\treturn y + 1;\n}\nlet r = helper(1) + other(2);\n`;
const objMethod = (b) => `let o = {\n\thelper: function(x) {\n${b}\n\t},\n\tother: function(y) { return y * 2; }\n};\nlet r = o.helper(1);\n`;
const arrowLet = (b) => `let helper = (x) => {\n${b}\n};\nlet other = (y) => y + 1;\nlet r = helper(1) + other(2);\n`;
const fnExprConst = (b) => `const helper = function(x) {\n${b}\n};\nconst other = function(y) { return y - 1; };\nlet r = helper(1) + other(2);\n`;
const returnShape = (b) => `function build() {\n\treturn {\n\t\thelper: function(x) {\n${b}\n\t\t},\n\t\tother: function(y) { return y; }\n\t};\n}\nlet api = build();\n`;
const nestedObj = (b) => `let cfg = {\n\tinner: {\n\t\thelper: function(x) {\n${b}\n\t\t}\n\t},\n\tother: function(y) { return y; }\n};\nlet r = cfg.inner.helper(1);\n`;

describe('soundness · body shapes × trivial edits (whitespace / comment)', () => {
  test('top-level function — whitespace then comment', () => {
    soundAndSkips([topFn('\treturn x + 1;'), topFn('\treturn x + 1;  '), topFn('\treturn x + 1; // note')]);
  });
  test('object-literal method — whitespace then comment', () => {
    soundAndSkips([objMethod('\t\treturn x + 1;'), objMethod('\t\treturn x + 1; // c'), objMethod('\t\treturn x + 1;')]);
  });
  // Arrow-let / fn-expr-const / nested-object / factory-method-in-a-function are NOT
  // extracted as skippable units (only top-level fn declarations and direct object-
  // literal methods are). They stay SOUND — editing a non-extracted body changes the
  // structural fingerprint, which disables skipping that pass and falls to a full
  // (correct) analysis. These tests assert that soundness, not skip-engagement.
  test('arrow lambda assigned to let — comment edit (sound, not skipped)', () => {
    runSeq([arrowLet('\treturn x + 1;'), arrowLet('\treturn x + 1; // a'), arrowLet('\treturn x + 1; // b')]);
  });
  test('function-expression assigned to const — whitespace edit (sound, not skipped)', () => {
    runSeq([fnExprConst('\treturn x + 1;'), fnExprConst('\treturn x + 1;   '), fnExprConst('\treturn x + 1;')]);
  });
  test('factory return-{} method nested in a function — comment edit (sound)', () => {
    runSeq([returnShape('\t\t\treturn x + 1;'), returnShape('\t\t\treturn x + 1; // m'), returnShape('\t\t\treturn x + 1;')]);
  });
  test('nested-object method — comment edit (sound, not skipped)', () => {
    runSeq([nestedObj('\t\t\treturn x + 1;'), nestedObj('\t\t\treturn x + 1; // n'), nestedObj('\t\t\treturn x + 1;')]);
  });
  test('blank-line insertion inside a body', () => {
    soundAndSkips([topFn('\tlet a = x;\n\treturn a;'), topFn('\tlet a = x;\n\n\treturn a;')]);
  });
  test('trailing-whitespace churn over many steps', () => {
    soundAndSkips([objMethod('\t\treturn x;'), objMethod('\t\treturn x; '), objMethod('\t\treturn x;  '), objMethod('\t\treturn x;'), objMethod('\t\treturn x; ')]);
  });
  test('comment-only body content changes', () => {
    soundAndSkips([topFn('\t// first\n\treturn x;'), topFn('\t// second\n\treturn x;'), topFn('\t// third\n\treturn x;')]);
  });
  test('multi-line comment grows inside a body', () => {
    soundAndSkips([topFn('\t/* a */\n\treturn x;'), topFn('\t/* a b */\n\treturn x;'), topFn('\t/* a b c */\n\treturn x;')]);
  });
});

describe('soundness · logic edits inside one body (no signature change)', () => {
  test('rename a local variable', () => {
    soundAndSkips([topFn('\tlet a = x + 1;\n\treturn a;'), topFn('\tlet b = x + 1;\n\treturn b;')]);
  });
  test('add a statement', () => {
    soundAndSkips([topFn('\treturn x;'), topFn('\tlet t = x * 2;\n\treturn t;')]);
  });
  test('remove a statement', () => {
    soundAndSkips([topFn('\tlet t = x * 2;\n\treturn t;'), topFn('\treturn x;')]);
  });
  test('reorder independent statements', () => {
    soundAndSkips([topFn('\tlet a = 1;\n\tlet b = 2;\n\treturn a + b;'), topFn('\tlet b = 2;\n\tlet a = 1;\n\treturn a + b;')]);
  });
  test('change an arithmetic operator', () => {
    soundAndSkips([objMethod('\t\treturn x + 1;'), objMethod('\t\treturn x - 1;'), objMethod('\t\treturn x * 1;')]);
  });
  test('introduce a local loop (return type may shift → sound full-fallback)', () => {
    runSeq([topFn('\treturn x;'), topFn('\tlet s = 0;\n\tfor (let i = 0; i < x; i++) s += i;\n\treturn s;')]);
  });
  test('introduce a nested inner function (still pure)', () => {
    runSeq([topFn('\treturn x;'), topFn('\tfunction inner(z) { return z + 1; }\n\treturn inner(x);')]);
  });
  test('change a string literal in an object method (skippable sibling)', () => {
    soundAndSkips([objMethod('\t\treturn "a" + x;'), objMethod('\t\treturn "b" + x;')]);
  });
  test('add a local conditional (return type may shift → sound full-fallback)', () => {
    runSeq([topFn('\treturn x;'), topFn('\tif (x > 0) return x;\n\treturn 0;')]);
  });
  test('swap if/else branches', () => {
    soundAndSkips([topFn('\tif (x > 0) return 1;\n\treturn 2;'), topFn('\tif (x <= 0) return 2;\n\treturn 1;')]);
  });
});

describe('soundness · errors introduced and fixed inside a body', () => {
  const clean = '\treturn x;';
  test('undefined variable introduced then fixed', () => {
    runSeq([topFn(clean), topFn('\treturn nope;'), topFn(clean)]);
  });
  test('syntax-ish error introduced then fixed', () => {
    runSeq([objMethod('\t\treturn x;'), objMethod('\t\treturn x.;'), objMethod('\t\treturn x;')]);
  });
  test('two distinct undefined vars across steps', () => {
    runSeq([topFn(clean), topFn('\treturn aaa;'), topFn('\treturn bbb;'), topFn(clean)]);
  });
  test('error in helper while other body is edited (helper unchanged → skipped)', () => {
    const f = (h, o) => `function helper(x) {\n${h}\n}\nfunction other(y) {\n${o}\n}\nlet r = helper(1)+other(2);\n`;
    soundAndSkips([f('\treturn nope;', '\treturn y;'), f('\treturn nope;', '\treturn y + 1;')]);
  });
  test('undefined var in object method introduced then fixed', () => {
    runSeq([objMethod('\t\treturn x;'), objMethod('\t\treturn missing;'), objMethod('\t\treturn x;')]);
  });
  test('call to undefined function introduced then fixed', () => {
    runSeq([topFn('\treturn x;'), topFn('\treturn nope_fn(x);'), topFn('\treturn x;')]);
  });
  test('error in arrow lambda then fixed', () => {
    runSeq([arrowLet('\treturn x;'), arrowLet('\treturn zzz;'), arrowLet('\treturn x;')]);
  });
  test('multiple errors in one body then all fixed', () => {
    runSeq([topFn('\treturn x;'), topFn('\tlet a = p;\n\treturn q;'), topFn('\treturn x;')]);
  });
});

describe('soundness · signature changes force a correct full re-analysis', () => {
  test('add a parameter (top-level fn)', () => {
    const s = runSeq([topFn('\treturn x;'), `function helper(x, z) {\n\treturn x + z;\n}\nfunction other(y){return y;}\nlet r=helper(1,2)+other(3);\n`, topFn('\treturn x;')]);
    expect(s).toBeTruthy();
  });
  test('remove a parameter (object method)', () => {
    runSeq([
      `let o={ helper:function(x,z){ return x+z; }, other:function(y){return y;} };\nlet r=o.helper(1,2);\n`,
      `let o={ helper:function(x){ return x; }, other:function(y){return y;} };\nlet r=o.helper(1);\n`,
    ]);
  });
  test('rename the function itself', () => {
    runSeq([topFn('\treturn x;'), `function renamed(x){ return x; }\nfunction other(y){return y;}\nlet r=renamed(1)+other(2);\n`]);
  });
  test('change arrow param name', () => {
    runSeq([arrowLet('\treturn x;'), `let helper=(q)=>{ return q; };\nlet other=(y)=>y;\nlet r=helper(1)+other(2);\n`]);
  });
  test('let → const on the binding (out-of-body change)', () => {
    runSeq([fnExprConst('\treturn x;'), `let helper=function(x){ return x; };\nconst other=function(y){return y;};\nlet r=helper(1)+other(2);\n`]);
  });
  test('add rest parameter', () => {
    runSeq([topFn('\treturn x;'), `function helper(x, ...rest){ return x; }\nfunction other(y){return y;}\nlet r=helper(1)+other(2);\n`]);
  });
  test('convert function expression to arrow (value-shape change)', () => {
    runSeq([
      `let o={ helper:function(x){ return x; }, other:function(y){return y;} };\nlet r=o.helper(1);\n`,
      `let o={ helper:(x)=>{ return x; }, other:function(y){return y;} };\nlet r=o.helper(1);\n`,
    ]);
  });
  test('add use-strict directive (top-level structure change)', () => {
    runSeq([topFn('\treturn x;'), `'use strict';\n` + topFn('\treturn x;')]);
  });
});

describe('soundness · structural changes (add / remove / reorder units)', () => {
  test('add a new top-level function', () => {
    runSeq([topFn('\treturn x;'), topFn('\treturn x;') + `function extra(z){ return z+1; }\n`]);
  });
  test('remove a top-level function', () => {
    runSeq([topFn('\treturn x;') + `function extra(z){ return z+1; }\n`, topFn('\treturn x;')]);
  });
  test('add a method to an object', () => {
    runSeq([
      `let o={ helper:function(x){return x;} };\nlet r=o.helper(1);\n`,
      `let o={ helper:function(x){return x;}, extra:function(z){return z+1;} };\nlet r=o.helper(1);\n`,
    ]);
  });
  test('remove a method from an object', () => {
    runSeq([
      `let o={ helper:function(x){return x;}, extra:function(z){return z+1;} };\nlet r=o.helper(1);\n`,
      `let o={ helper:function(x){return x;} };\nlet r=o.helper(1);\n`,
    ]);
  });
  test('reorder two methods', () => {
    runSeq([
      `let o={ a:function(x){return x;}, b:function(y){return y;} };\nlet r=o.a(1)+o.b(2);\n`,
      `let o={ b:function(y){return y;}, a:function(x){return x;} };\nlet r=o.a(1)+o.b(2);\n`,
    ]);
  });
  test('reorder two top-level functions', () => {
    runSeq([
      `function a(x){return x;}\nfunction b(y){return y;}\nlet r=a(1)+b(2);\n`,
      `function b(y){return y;}\nfunction a(x){return x;}\nlet r=a(1)+b(2);\n`,
    ]);
  });
  test('add top-level statement between functions', () => {
    runSeq([
      `function a(x){return x;}\nfunction b(y){return y;}\n`,
      `function a(x){return x;}\nlet mid = 7;\nfunction b(y){return y;}\n`,
    ]);
  });
  test('wrap two functions into an object literal', () => {
    runSeq([
      `function a(x){return x;}\nfunction b(y){return y;}\nlet r=a(1)+b(2);\n`,
      `let o={ a:function(x){return x;}, b:function(y){return y;} };\nlet r=o.a(1)+o.b(2);\n`,
    ]);
  });
});

describe('soundness · this.x= (thisSafe) bodies', () => {
  const obj = (setBody, getBody) => `let o = {\n\tset: function(v) {\n${setBody}\n\t},\n\tget: function() {\n${getBody}\n\t}\n};\nlet r = o.get();\n`;
  test('thisSafe setter — comment edit is skippable', () => {
    soundAndSkips([obj('\t\tthis.val = v;\n\t\treturn v;', '\t\treturn this.val;'), obj('\t\tthis.val = v; // c\n\t\treturn v;', '\t\treturn this.val;')]);
  });
  test('edit the getter while setter unchanged', () => {
    soundAndSkips([obj('\t\tthis.val = v;\n\t\treturn v;', '\t\treturn this.val;'), obj('\t\tthis.val = v;\n\t\treturn v;', '\t\treturn this.val; // g')]);
  });
  test('this-property assigned TYPE changes (integer → object) — reader updates', () => {
    const mk = (rhs) => `let o={ set:function(){ this.val=${rhs}; return 1; }, get:function(){ return this.val.x; } };\nlet r=o.get();`;
    runSeq([mk('5'), mk('{ x: 9 }'), mk('5')]);
  });
  test('this-property assigned TYPE changes (string → array)', () => {
    const mk = (rhs) => `let o={ set:function(){ this.val=${rhs}; return 1; }, get:function(){ return this.val; } };\nlet r=o.get();`;
    runSeq([mk('"hi"'), mk('[1,2,3]'), mk('"hi"')]);
  });
  test('two this-properties, edit one', () => {
    const mk = (a, b) => `let o={ init:function(){ this.a=${a}; this.b=${b}; }, read:function(){ return this.a; } };\nlet r=o.read();`;
    runSeq([mk('1', '2'), mk('1', '99'), mk('7', '2')]);
  });
  test('this-write inside a conditional', () => {
    const mk = (rhs) => `let o={ set:function(f){ if(f) this.val=${rhs}; return 1; }, get:function(){ return this.val; } };\nlet r=o.get();`;
    runSeq([mk('5'), mk('"s"')]);
  });
  test('method updates this then a sibling reads a member of it', () => {
    const mk = (rhs) => `let o={ build:function(){ this.cfg=${rhs}; }, host:function(){ return this.cfg.host; } };\nlet r=o.host();`;
    runSeq([mk('{ host: "a" }'), mk('{ port: 1 }'), mk('{ host: "a" }')]);
  });
  test('thisSafe setter edited many times (comments) stays skippable', () => {
    soundAndSkips([
      obj('\t\tthis.val = v;\n\t\treturn v;', '\t\treturn this.val;'),
      obj('\t\tthis.val = v; // 1\n\t\treturn v;', '\t\treturn this.val;'),
      obj('\t\tthis.val = v; // 2\n\t\treturn v;', '\t\treturn this.val;'),
    ]);
  });
  test('promote a pure method to thisSafe (adds this.x=)', () => {
    runSeq([
      `let o={ set:function(v){ return v; }, get:function(){ return this.val; } };\nlet r=o.get();`,
      `let o={ set:function(v){ this.val=v; return v; }, get:function(){ return this.val; } };\nlet r=o.get();`,
    ]);
  });
  test('demote thisSafe back to pure (removes this.x=)', () => {
    runSeq([
      `let o={ set:function(v){ this.val=v; return v; }, get:function(){ return this.val; } };\nlet r=o.get();`,
      `let o={ set:function(v){ return v; }, get:function(){ return this.val; } };\nlet r=o.get();`,
    ]);
  });
});

describe('soundness · global writes (impure) bodies', () => {
  test('impure (global.X=) body is never skipped but stays correct', () => {
    const mk = (rhs) => `let o={ set:function(){ global.G=${rhs}; return 1; }, get:function(){ return global.G; } };\nlet r=o.get();`;
    runSeq([mk('5'), mk('"s"'), mk('5')]);
  });
  test('global write inside a top-level function', () => {
    const mk = (rhs) => `function setit(){ global.COUNT=${rhs}; }\nfunction other(y){return y;}\nsetit();\n`;
    runSeq([mk('0'), mk('1'), mk('0')]);
  });
  test('global.X = 0xF (hex literal) edited', () => {
    const mk = (rhs) => `function setit(){ global.MASK=${rhs}; return global.MASK; }\nlet r=setit();\n`;
    runSeq([mk('0xF'), mk('0xFF'), mk('0xF')]);
  });
  test('mixed pure + impure in same file — untouched pure sibling still skips', () => {
    // Edit `dirty` (impure, never skipped anyway); `keep` is an untouched pure unit
    // that must be skipped on the edit step, proving skipping survives an impure file.
    const mk = (dirtyBody) => `function keep(x){ return x + 1; }\nfunction dirty(){\n${dirtyBody}\n}\nlet r=keep(1);\ndirty();\n`;
    soundAndSkips([mk('\tglobal.Z=1;\n\treturn global.Z;'), mk('\tglobal.Z=1; // c\n\treturn global.Z;'), mk('\tglobal.Z=1;\n\treturn global.Z;')]);
  });
  test('assignment to an outer (module-level) variable is impure', () => {
    const mk = (rhs) => `let acc = 0;\nfunction add(){ acc = ${rhs}; return acc; }\nlet r = add();\n`;
    runSeq([mk('1'), mk('2'), mk('1')]);
  });
  test('member-write to an outer object is impure', () => {
    const mk = (rhs) => `let store = {};\nfunction put(){ store.k = ${rhs}; return store.k; }\nlet r = put();\n`;
    runSeq([mk('5'), mk('"x"'), mk('5')]);
  });
});

describe('soundness · cross-body semantic dependency (fingerprint fallback)', () => {
  test('method RETURN type change updates a caller method', () => {
    const mk = (rhs) => `let o={ make:function(){ return ${rhs}; }, use:function(){ let v=this.make(); return v.y; } };\nlet r=o.use();`;
    runSeq([mk('7'), mk('{ y: 1 }'), mk('7')]);
  });
  test('top-level function RETURN type change updates a caller body', () => {
    const mk = (rhs) => `function make(){ return ${rhs}; }\nlet o={ use:function(){ let v=make(); return v.z; } };\nlet r=o.use();`;
    runSeq([mk('3'), mk('{ z: 1 }'), mk('3')]);
  });
  test('returned-object SHAPE change (add property) updates reader', () => {
    const mk = (props) => `function make(){ return { ${props} }; }\nfunction use(){ let v=make(); return v.b; }\nlet r=use();`;
    runSeq([mk('a: 1'), mk('a: 1, b: 2'), mk('a: 1')]);
  });
  test('returned-object SHAPE change (remove property) updates reader', () => {
    const mk = (props) => `function make(){ return { ${props} }; }\nfunction use(){ let v=make(); return v.b.c; }\nlet r=use();`;
    runSeq([mk('b: { c: 1 }'), mk('b: 2'), mk('b: { c: 1 }')]);
  });
  test('arrow lambda return type change updates its caller', () => {
    const mk = (rhs) => `let make=()=>${rhs};\nfunction use(){ let v=make(); return v.k; }\nlet r=use();`;
    runSeq([mk('5'), mk('({ k: 1 })'), mk('5')]);
  });
  test('factory-returned method type change updates a consumer', () => {
    const mk = (rhs) => `function build(){ return { val:function(){ return ${rhs}; } }; }\nlet api=build();\nlet r=api.val();\n`;
    runSeq([mk('1'), mk('{ n: 1 }'), mk('1')]);
  });
  test('this-property type change updates a DIFFERENT sibling than the writer', () => {
    const mk = (rhs) => `let o={ init:function(){ this.data=${rhs}; }, a:function(){ return this.data.x; }, b:function(){ return this.data; } };\nlet r=o.a();`;
    runSeq([mk('{ x: 1 }'), mk('5'), mk('{ x: 1 }')]);
  });
  test('chained dependency: A return → B uses → edit A, B is skipped-candidate', () => {
    const mk = (rhs) => `function a(){ return ${rhs}; }\nfunction b(){ let v=a(); return v.m; }\nfunction c(){ return b(); }\nlet r=c();`;
    runSeq([mk('{ m: 1 }'), mk('9'), mk('{ m: 1 }')]);
  });
  test('return type flips integer ↔ string used in numeric context', () => {
    const mk = (rhs) => `function n(){ return ${rhs}; }\nfunction use(){ let v=n(); return v * 2; }\nlet r=use();`;
    runSeq([mk('5'), mk('"x"'), mk('5')]);
  });
  test('nullable return introduced (integer → integer|null) drives a guard diagnostic', () => {
    const mk = (rhs) => `function maybe(){ ${rhs} }\nfunction use(){ let v=maybe(); return index(v, 1); }\nlet r=use();`;
    runSeq([mk('return [1,2];'), mk('if (1) return [1,2]; return null;'), mk('return [1,2];')]);
  });
  test('changing a CALLED sibling from pure to error-bearing', () => {
    const mk = (body) => `function dep(){ ${body} }\nfunction use(){ return dep(); }\nlet r=use();`;
    runSeq([mk('return 1;'), mk('return undefined_thing;'), mk('return 1;')]);
  });
  test('two readers of one producer both stay correct after producer edit', () => {
    const mk = (rhs) => `function p(){ return ${rhs}; }\nfunction r1(){ let v=p(); return v.a; }\nfunction r2(){ let v=p(); return v.b; }\nlet r=r1()+r2();`;
    runSeq([mk('{ a: 1, b: 2 }'), mk('{ a: 1 }'), mk('{ a: 1, b: 2 }')]);
  });
  test('producer edited to identical type → readers unaffected (no spurious change)', () => {
    const mk = (rhs) => `function p(){ return ${rhs}; }\nfunction use(){ let v=p(); return v.a; }\nlet r=use();`;
    runSeq([mk('{ a: 1 }'), mk('{ a: 2 }'), mk('{ a: 3 }')]);
  });
});

describe('soundness · multi-unit files & repeated convergence', () => {
  test('three objects, edit the middle one repeatedly', () => {
    const mk = (mid) => `let A={ f:function(x){return x;} };\nlet B={ g:function(y){\n${mid}\n} };\nlet C={ h:function(z){return z;} };\nlet r=A.f(1)+B.g(2)+C.h(3);\n`;
    soundAndSkips([mk('\t\treturn y;'), mk('\t\treturn y; // 1'), mk('\t\treturn y + 1;'), mk('\t\treturn y; // 2')]);
  });
  test('long whitespace-churn sequence over a single body (cache reuse)', () => {
    const vs = [];
    for (let i = 0; i < 8; i++) vs.push(topFn('\treturn x;' + ' '.repeat(i)));
    const s = soundAndSkips(vs);
    expect(s.totalSkipped).toBeGreaterThan(3);
  });
  test('alternate between two body contents repeatedly', () => {
    const vs = [];
    for (let i = 0; i < 6; i++) vs.push(objMethod(i % 2 ? '\t\treturn x + 1;' : '\t\treturn x - 1;'));
    runSeq(vs);
  });
  test('IIFE body edited (module-init expression statement)', () => {
    const mk = (b) => `let r = (function(){\n${b}\n})();\nfunction other(y){return y;}\n`;
    runSeq([mk('\treturn 1;'), mk('\treturn 1; // c'), mk('\treturn 2;')]);
  });
  test('recursive function body edited', () => {
    const mk = (b) => `function fac(n){\n${b}\n}\nlet r=fac(5);\n`;
    runSeq([mk('\tif (n <= 1) return 1;\n\treturn n * fac(n-1);'), mk('\tif (n <= 1) return 1; // base\n\treturn n * fac(n-1);')]);
  });
  test('empty body to non-empty and back', () => {
    runSeq([topFn(''), topFn('\treturn x;'), topFn('')]);
  });
  test('switch a method between arrow and function-expression repeatedly', () => {
    const fn = `let o={ m:function(x){return x;}, other:function(y){return y;} };\nlet r=o.m(1);\n`;
    const ar = `let o={ m:(x)=>{return x;}, other:function(y){return y;} };\nlet r=o.m(1);\n`;
    runSeq([fn, ar, fn, ar]);
  });
  test('file with no editable units (all top-level) stays sound', () => {
    runSeq([`let a = 1;\nlet b = a + 1;\nprint(b);\n`, `let a = 1;\nlet b = a + 2;\nprint(b);\n`]);
  });
});

describe('soundness · regression anchors for the original 3 hard cases', () => {
  test('this.val = 5 → { x: 9 } (sibling getter not stale)', () => {
    const mk = (rhs) => `let o={ set:function(){ this.val=${rhs}; return 1; }, get:function(){ return this.val.x; } };\nlet r=o.get();`;
    runSeq([mk('5'), mk('{ x: 9 }'), mk('5')]);
  });
  test('make() 7 → { y: 1 } (caller not stale)', () => {
    const mk = (rhs) => `let o={ make:function(){ return ${rhs}; }, use:function(){ let v=this.make(); return v.y; } };\nlet r=o.use();`;
    runSeq([mk('7'), mk('{ y: 1 }'), mk('7')]);
  });
  test('top-level make() 3 → { z: 1 } (object-method caller not stale)', () => {
    const mk = (rhs) => `function make(){ return ${rhs}; }\nlet o={ use:function(){ let v=make(); return v.z; } };\nlet r=o.use();`;
    runSeq([mk('3'), mk('{ z: 1 }'), mk('3')]);
  });
});
