// Regression (bug #3 from fw4.uc): completion pops up at comment BOUNDARIES.
//
// `isInsideStringOrComment` (completion.ts) suppresses completion strictly INSIDE a
// comment (`offset > pos && offset < end`), so the interior is fine — but the cursor
// at the exact start (`offset === pos`) or end (`offset === end`) of a comment is not
// caught, and the general builtin list (print/printf/length/…) pops up. In the real
// firewall4 fw4.uc this fires at the `*/` end of the icmp-table block comments and at
// the end of trailing `// …` line comments. Matches the user's "not on every keystroke,
// not on every character" — only the boundaries leak.
//
// FAIL-TO-PASS: these fail today; they should pass once the boundary is treated as
// inside the comment.

import { test, expect, describe } from 'bun:test';
import { UcodeLexer } from '../src/lexer/ucodeLexer.ts';
import { UcodeParser } from '../src/parser/ucodeParser.ts';
import { SemanticAnalyzer } from '../src/analysis/semanticAnalyzer.ts';
import { handleCompletion } from '../src/completion.ts';

function mkDoc(code) {
  return {
    getText: () => code,
    positionAt: (o) => { let l = 0, c = 0; for (let i = 0; i < o && i < code.length; i++) { if (code[i] === '\n') { l++; c = 0; } else c++; } return { line: l, character: c }; },
    offsetAt: (p) => { const ls = code.split('\n'); let o = 0; for (let i = 0; i < p.line; i++) o += ls[i].length + 1; return o + p.character; },
    uri: 'file:///t.uc', languageId: 'ucode', version: 1,
  };
}
function completionsAt(code, offset) {
  const doc = mkDoc(code);
  const lx = new UcodeLexer(code, { rawMode: true });
  const ar = new SemanticAnalyzer(doc, { enableScopeAnalysis: true, enableTypeChecking: true })
    .analyze(new UcodeParser(lx.tokenize(), code).parse().ast);
  const conn = { console: { log: () => {} } };
  return handleCompletion({ textDocument: { uri: 'file:///t.uc' }, position: doc.positionAt(offset) }, { get: () => doc }, conn, ar);
}

describe('no completion at comment boundaries (bug #3)', () => {
  test('end of a trailing line comment', () => {
    const code = 'let x = 1; // line cmt here\nlet z = 3;';
    const end = code.indexOf('\n'); // offset of the newline = end of the line comment
    expect(completionsAt(code, end).length).toBe(0);
  });

  test('just after a block comment close `*/`', () => {
    const code = 'let x = 1; /* blk cmt */ let y = 2;';
    const end = code.indexOf('*/') + 2; // offset right after the closing slash
    expect(completionsAt(code, end).length).toBe(0);
  });

  test('start of a comment', () => {
    const code = 'let x = 1; /* blk */ let y = 2;';
    const start = code.indexOf('/*'); // offset at the opening slash
    expect(completionsAt(code, start).length).toBe(0);
  });

  test('control: interior of a comment is already suppressed', () => {
    const code = 'let x = 1; /* blk cmt */ let y = 2;';
    const mid = code.indexOf('blk'); // strictly inside
    expect(completionsAt(code, mid).length).toBe(0);
  });
});
