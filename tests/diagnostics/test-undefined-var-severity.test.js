// UC1001 (undefined variable READ) severity tracks 'use strict', because that is
// exactly what ucode does at runtime (oracle-verified, all releases):
//   - non-strict: a read of an undeclared variable evaluates to null, no error  → Warning
//   - 'use strict': the same read is a hard `Reference error`                    → Error
// A *call* of an undefined name (UC1002) or a member-access on it throws even in
// non-strict, so those stay Errors and are NOT affected here.

import { test, expect, describe } from 'bun:test';
import { UcodeLexer, detectTemplateMode, bridgeTemplateTokens } from '../../src/lexer/index.ts';
import { UcodeParser } from '../../src/parser/ucodeParser.ts';
import { SemanticAnalyzer } from '../../src/analysis/semanticAnalyzer.ts';

const Error_ = 1, Warning = 2;

function diags(src) {
  const isT = detectTemplateMode(src);
  const lx = new UcodeLexer(src, { rawMode: !isT });
  const toks = isT ? bridgeTemplateTokens(lx.tokenize()) : lx.tokenize();
  const ast = new UcodeParser(toks, src).parse().ast;
  const doc = { getText: () => src, positionAt: (o) => ({ line: 0, character: o }), offsetAt: (p) => p.character, uri: 'file:///t.uc', languageId: 'ucode', version: 1 };
  const an = new SemanticAnalyzer(doc, { enableScopeAnalysis: true, enableTypeChecking: true });
  return an.analyze(ast).diagnostics;
}
const undefVar = (src) => diags(src).find((d) => /Undefined variable/.test(d.message));

describe('UC1001 severity tracks strict mode', () => {
  test('non-strict read of an undefined variable → Warning', () => {
    const d = undefVar('let value = missingName;');
    expect(d).toBeDefined();
    expect(d.severity).toBe(Warning);
  });

  test("'use strict' read of an undefined variable → Error", () => {
    const d = undefVar("'use strict';\nlet value = missingName;");
    expect(d).toBeDefined();
    expect(d.severity).toBe(Error_);
  });

  test('non-strict bare-identifier read → Warning', () => {
    const d = undefVar('orphanRead;');
    expect(d).toBeDefined();
    expect(d.severity).toBe(Warning);
  });

  test('non-strict template free var → Warning (still flagged)', () => {
    const d = undefVar('{{ renderVar }}');
    expect(d).toBeDefined();
    expect(d.severity).toBe(Warning);
  });

  test("strict template free var → Error", () => {
    const d = undefVar("{% 'use strict'; %}{{ renderVar }}");
    expect(d).toBeDefined();
    expect(d.severity).toBe(Error_);
  });

  test('an undefined FUNCTION CALL stays an Error in non-strict (calling null throws)', () => {
    // UC1002, not UC1001 — verifies the downgrade did not bleed into call sites.
    const d = diags('undefinedFn();').find((x) => /Undefined function/.test(x.message));
    expect(d).toBeDefined();
    expect(d.severity).toBe(Error_);
  });

  test('the diagnostic is never SUPPRESSED by the downgrade (no false negative)', () => {
    // Whether strict or not, the undefined read must still be reported.
    expect(undefVar('let a = neverDeclared;')).toBeDefined();
    expect(undefVar("'use strict';\nlet a = neverDeclared;")).toBeDefined();
  });
});
