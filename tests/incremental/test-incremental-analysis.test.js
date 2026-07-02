// SOUNDNESS HARNESS for function-level incremental analysis.
//
// For every scenario we apply a sequence of edits. At each step we compute BOTH:
//   - FULL: a fresh analysis with no cache.
//   - INCREMENTAL: an analysis using the cache from the previous step (skipping unchanged
//     pure bodies).
// and assert the diagnostics are IDENTICAL. Incremental analysis that ever diverges from full
// analysis is a hard failure. We also assert the fast path actually engages (bodies skipped)
// where it should, so we're testing real incrementality, not an accidental no-op.

import { test, expect, describe } from 'bun:test';
import { readFileSync } from 'fs';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { UcodeLexer, detectTemplateMode, bridgeTemplateTokens } from '../../src/lexer/index.ts';
import { UcodeParser } from '../../src/parser/ucodeParser.ts';
import { SemanticAnalyzer } from '../../src/analysis/semanticAnalyzer.ts';
import { runIncremental } from '../../src/analysis/incrementalAnalysis.ts';

function parse(text) {
  const isT = detectTemplateMode(text);
  const lx = new UcodeLexer(text, { rawMode: !isT });
  const toks = isT ? bridgeTemplateTokens(lx.tokenize()) : lx.tokenize();
  return new UcodeParser(toks, text).parse().ast;
}
const OPTS = { enableScopeAnalysis: true, enableTypeChecking: true, enableControlFlowAnalysis: true, enableUnusedVariableDetection: true, enableShadowingWarnings: true };

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
  return { diagnostics: r.result.diagnostics, cache: r.cache, skipped: r.skipped };
}

// Normalize diagnostics to a stable, position+message comparable form.
const norm = (diags) => diags
  .map((d) => `${d.range.start.line}:${d.range.start.character}-${d.range.end.line}:${d.range.end.character} sev${d.severity} ${d.code || ''} ${d.message}`)
  .sort();

// Run an edit sequence; at each version assert incremental ≡ full. Returns total bodies skipped.
function runSequence(versions) {
  let cache = undefined;
  let totalSkipped = 0;
  for (let i = 0; i < versions.length; i++) {
    const text = versions[i];
    const full = step(text, undefined);          // fresh, no cache
    const inc = step(text, cache);               // uses prior cache
    expect(norm(inc.diagnostics)).toEqual(norm(full.diagnostics)); // SOUNDNESS
    cache = inc.cache;
    totalSkipped += inc.skipped;
  }
  return totalSkipped;
}

const OBJ = (body1, body2) => `let fw = {
\tparse_invert: function(val) { return { val: val, invert: false }; },
\thelper: function(x) {
${body1}
\t},
\tother: function(y) {
${body2}
\t}
};
`;

describe('incremental analysis ≡ full analysis (soundness)', () => {
  test('edit one method body (whitespace/comment) — fast path engages, identical output', () => {
    const v1 = OBJ('\t\tlet a = x + 1; return a;', '\t\treturn y * 2;');
    const v2 = OBJ('\t\tlet a = x + 1;  return a; // tweak', '\t\treturn y * 2;');
    const v3 = OBJ('\t\tlet a = x + 1;  return a;', '\t\treturn y * 2; // c');
    const skipped = runSequence([v1, v2, v3]);
    expect(skipped).toBeGreaterThan(0); // bodies were actually skipped
  });

  test('introduce then fix an error inside a method body', () => {
    const clean = OBJ('\t\treturn x;', '\t\treturn y;');
    const broken = OBJ('\t\treturn x.;', '\t\treturn y;');   // syntax-ish error in body1
    runSequence([clean, broken, clean]);
  });

  test('editing a signature falls back to full (fingerprint change) but stays correct', () => {
    const v1 = OBJ('\t\treturn x;', '\t\treturn y;');
    const v2 = `let fw = {
\tparse_invert: function(val) { return { val: val }; },
\thelper: function(x, z) {
\t\treturn x;
\t},
\tother: function(y) {
\t\treturn y;
\t}
};
`;
    runSequence([v1, v2, v1]);
  });

  test('adding a new method (structure change) stays correct', () => {
    const v1 = OBJ('\t\treturn x;', '\t\treturn y;');
    const v2 = v1.replace('};\n', '\textra: function(z) { return z + 1; }\n};\n');
    runSequence([v1, v2]);
  });

  test('impure method (this.x=) is never skipped but stays correct', () => {
    const v1 = `let fw = {
\tset: function(v) { this.val = v; return v; },
\tget: function() { return this.val; }
};
`;
    const v2 = v1.replace('return v;', 'return v; // edit');
    runSequence([v1, v2]);
  });

  test('top-level function bodies are incrementally analyzed', () => {
    const f = (b1, b2) => `function alpha(a) {\n${b1}\n}\nfunction beta(b) {\n${b2}\n}\nlet r = alpha(1) + beta(2);\n`;
    const skipped = runSequence([f('\treturn a;', '\treturn b;'), f('\treturn a; // x', '\treturn b;'), f('\treturn a;', '\treturn b + 1;')]);
    expect(skipped).toBeGreaterThan(0);
  });

  test('undefined-variable in one body, edit another body', () => {
    const v1 = OBJ('\t\treturn nope;', '\t\treturn y;');       // nope undefined in helper
    const v2 = OBJ('\t\treturn nope;', '\t\treturn y + 1;');   // edit other, helper unchanged
    runSequence([v1, v2]);
  });

  // ── Cross-method semantic-dependency cases (the hard soundness ones) ──────────────────
  test('changing a this-property TYPE updates a sibling that reads it', () => {
    const mk = (rhs) => `let o = {\n\tset: function() { this.val = ${rhs}; return 1; },\n\tget: function() { return this.val.x; }\n};\nlet r = o.get();`;
    // this.val = 5 → get reads .x on integer (error); = { x: 9 } → no error. Sibling `get` is
    // structurally unchanged across the edit, so it would be skipped — must NOT be stale.
    runSequence([mk('5'), mk('{ x: 9 }'), mk('5')]);
  });

  test('changing a method RETURN type updates a caller that uses it', () => {
    const mk = (rhs) => `let o = {\n\tmake: function() { return ${rhs}; },\n\tuse: function() { let v = this.make(); return v.y; }\n};\nlet r = o.use();`;
    // make() returns 7 → use reads .y on integer; returns { y: 1 } → ok.
    runSequence([mk('7'), mk('{ y: 1 }'), mk('7')]);
  });

  test('changing a top-level function return type updates a caller body', () => {
    const mk = (rhs) => `function make() { return ${rhs}; }\nlet o = {\n\tuse: function() { let v = make(); return v.z; }\n};\nlet r = o.use();`;
    runSequence([mk('3'), mk('{ z: 1 }'), mk('3')]);
  });
});

describe('incremental analysis ≡ full analysis on real fw4.uc', () => {
  const fw4Path = './firewall4/root/usr/share/ucode/fw4.uc';
  let base;
  try { base = readFileSync(fw4Path, 'utf8'); } catch { base = null; }
  const t = base ? test : test.skip;

  // CPU-heavy: two full analyzer passes over the real ~10k-line fw4.uc (~2.5s
  // alone, ~8s under `bun test --concurrent` CPU contention) — needs an
  // explicit budget above the 5s default.
  t('edit inside one method body of fw4.uc — incremental matches full', () => {
    // Find a method body and insert a harmless comment inside it.
    const idx = base.indexOf('parse_weekdays: function');
    expect(idx).toBeGreaterThan(-1);
    const braceOpen = base.indexOf('{', idx);
    const edited = base.slice(0, braceOpen + 1) + ' /* incremental test */ ' + base.slice(braceOpen + 1);
    const skipped = runSequence([base, edited]);
    expect(skipped).toBeGreaterThan(0); // most of fw4's ~100 bodies should skip
  }, { timeout: 30000 });
});
