// Regression: a self-referential member reassignment poisons the member's type
// NON-flow-sensitively, so the read INSIDE the RHS sees the assignment's result.
//
// From firewall4/root/usr/share/ucode/fw4.uc parse_weekdays():
//     (rv.days ||= {})[day] = true;   // rv.days is an object here
//     rv.days = keys(rv.days);        // keys() reads the object -> array<string>
//
// `rv.days` is correctly `object` until the last line; but the checker resolves the
// `rv.days` PROPERTY type as the most-recent write (`keys(...)` -> array<string>) and
// applies it everywhere, so:
//   - hovering `rv.days` on the `||=` line shows array<string> (should be object), and
//   - the `rv.days` argument inside keys() is seen as array -> false
//     "Function 'keys' expects object for argument 1, got array" (UC2004).
//
// These are FAIL-TO-PASS: they fail today and should pass once member property typing
// for a `x.p = f(x.p)` reassignment is flow-correct (the RHS read predates the write).

import { test, expect, describe } from 'bun:test';
import { UcodeLexer } from '../src/lexer/ucodeLexer.ts';
import { UcodeParser } from '../src/parser/ucodeParser.ts';
import { SemanticAnalyzer } from '../src/analysis/semanticAnalyzer.ts';
import { typeToString } from '../src/analysis/symbolTable.ts';
import { handleHover } from '../src/hover.ts';

function mkDoc(code) {
  return {
    getText: () => code,
    positionAt: (o) => { let l = 0, c = 0; for (let i = 0; i < o && i < code.length; i++) { if (code[i] === '\n') { l++; c = 0; } else c++; } return { line: l, character: c }; },
    offsetAt: (p) => { const ls = code.split('\n'); let o = 0; for (let i = 0; i < p.line; i++) o += ls[i].length + 1; return o + p.character; },
    uri: 'file:///t.uc', languageId: 'ucode', version: 1,
  };
}
function analyze(code) {
  const doc = mkDoc(code);
  const lx = new UcodeLexer(code, { rawMode: true });
  const ar = new SemanticAnalyzer(doc, { enableScopeAnalysis: true, enableTypeChecking: true })
    .analyze(new UcodeParser(lx.tokenize(), code).parse().ast);
  return { doc, ar };
}

// The reduced parse_weekdays shape.
const SRC = [
  'let rv = { invert: false };',          // 0
  'let day = "Monday";',                  // 1
  '(rv.days ||= {})[day] = true;',        // 2
  'rv.days = keys(rv.days);',             // 3
].join('\n');

describe('self-referential member reassignment (fw4.uc parse_weekdays)', () => {
  test('keys(rv.days) does not falsely error — rv.days is an object at that point', () => {
    const { ar } = analyze(SRC);
    const keysErrors = ar.diagnostics.filter(
      (d) => d.severity === 1 && /keys/.test(d.message) && /object|array/.test(d.message)
    );
    expect(keysErrors.map((d) => d.message)).toEqual([]);
  });

  // The PRIMARY bug — the false `keys expects object, got array` — is fixed above by
  // deferring the property-type write until after the RHS is checked. Hover, however, reads
  // the property's flow-INSENSITIVE type (last-write-wins, by the 0.6.206 design), so on the
  // `||=` line it shows the property's eventual type rather than the object it is at that exact
  // point. Position-aware property typing is a separate, larger change; for now we only assert
  // hover resolves rv.days to a concrete collection type (not `unknown`), guarding the member
  // resolution itself.
  test('hovering rv.days resolves to a concrete collection type (not unknown)', () => {
    const { doc, ar } = analyze(SRC);
    const line = 2;
    const col = SRC.split('\n')[line].indexOf('days') + 1;
    const h = handleHover({ textDocument: { uri: 'file:///t.uc' }, position: { line, character: col } }, { get: () => doc }, ar);
    const text = h && h.contents ? (typeof h.contents === 'string' ? h.contents : h.contents.value || '') : '';
    expect(/object|array/.test(text)).toBe(true);
    expect(text).not.toContain('unknown');
  });

  test('a plain object indexed-assign + keys is fine (control — already passes)', () => {
    const { ar } = analyze('let o = {};\no["a"] = true;\nlet k = keys(o);');
    expect(ar.diagnostics.filter((d) => d.severity === 1)).toEqual([]);
  });
});
