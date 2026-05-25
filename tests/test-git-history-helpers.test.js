// Unit tests for the pure helpers behind the function-history CodeLens
// (src/gitHistory.ts). These are deterministic — no git, no spawned server.
import { test, expect, describe } from 'bun:test';
import { collectFunctionDeclarations, parseGitLogLOutput, formatSummaryTitle } from '../src/gitHistory';
import { UcodeLexer } from '../src/lexer/ucodeLexer';
import { UcodeParser } from '../src/parser/ucodeParser';

const FS = '\x1f'; // matches the field separator in gitHistory's --format string

function parse(src) {
  const lexer = new UcodeLexer(src, { rawMode: true });
  const tokens = lexer.tokenize();
  const parser = new UcodeParser(tokens, src);
  parser.setComments(lexer.comments);
  return parser.parse().ast;
}

describe('parseGitLogLOutput', () => {
  test('parses multiple commits, newest first', () => {
    const out = [
      `a1b2c3${FS}Noah Peterson${FS}2 days ago${FS}Fix arg check`,
      `d4e5f6${FS}Sam Smith${FS}3 weeks ago${FS}Initial`,
    ].join('\n') + '\n';
    const s = parseGitLogLOutput(out);
    expect(s).not.toBeNull();
    expect(s.count).toBe(2);
    expect(s.last.hash).toBe('a1b2c3');
    expect(s.last.author).toBe('Noah Peterson');
    expect(s.last.relDate).toBe('2 days ago');
    expect(s.last.subject).toBe('Fix arg check');
    expect(s.commits.length).toBe(2);
  });

  test('empty / whitespace-only → null', () => {
    expect(parseGitLogLOutput('')).toBeNull();
    expect(parseGitLogLOutput('\n\n')).toBeNull();
  });

  test('tolerates a trailing newline and CR', () => {
    const s = parseGitLogLOutput(`h${FS}a${FS}now${FS}subj\r\n`);
    expect(s.count).toBe(1);
    expect(s.last.subject).toBe('subj');
  });

  test('skips malformed lines with too few fields', () => {
    const s = parseGitLogLOutput(`onlyhash\nh${FS}a${FS}now${FS}ok`);
    expect(s.count).toBe(1);
    expect(s.last.subject).toBe('ok');
  });

  test('a subject containing the separator is preserved', () => {
    const s = parseGitLogLOutput(`h${FS}a${FS}now${FS}weird${FS}subject`);
    expect(s.last.subject).toBe(`weird${FS}subject`);
  });
});

describe('formatSummaryTitle', () => {
  test('plural count + first name only', () => {
    const t = formatSummaryTitle({ count: 3, last: { hash: 'x', author: 'Noah Peterson', relDate: '2 days ago', subject: 's' }, commits: [] });
    expect(t).toBe('3 commits · last: Noah, 2 days ago');
  });

  test('singular for a single commit', () => {
    const t = formatSummaryTitle({ count: 1, last: { hash: 'x', author: 'Sam', relDate: '1 hour ago', subject: 's' }, commits: [] });
    expect(t).toBe('1 commit · last: Sam, 1 hour ago');
  });
});

describe('collectFunctionDeclarations', () => {
  test('includes declarations at any depth (top-level, exported, nested); excludes lambdas/expressions', () => {
    const src = `'use strict';
/** doc */
function alpha(a) {
    function nested() { return 2; }    // nested DECL — included
    let lam = (x) => x + 1;            // arrow — excluded
    return nested() + lam(a);
}
export function beta(b) { return b; }  // exported decl — included
let gamma = () => 42;                  // arrow — excluded
let delta = function named() { return 3; }; // fn expression — excluded
const obj = { call: function (c) { return c; } }; // fn expression value — excluded
`;
    const ast = parse(src);
    const fns = collectFunctionDeclarations(ast);
    const names = fns.map(f => f.id?.name ?? '<anon>').sort();

    expect(names).toEqual(['alpha', 'beta', 'nested']);
    expect(fns.every(f => f.type === 'FunctionDeclaration')).toBe(true);

    const alpha = fns.find(f => f.id?.name === 'alpha');
    expect(alpha.leadingJsDoc).toBeTruthy();
    expect(typeof alpha.leadingJsDoc.start).toBe('number');

    for (const f of fns) {
      expect(typeof f.start).toBe('number');
      expect(typeof f.end).toBe('number');
      expect(f.end).toBeGreaterThan(f.start);
    }
  });

  test('returns [] when there are only lambdas/expressions (no declarations)', () => {
    const ast = parse(`'use strict';\nlet x = () => 1;\nlet y = function () { return 2; };\nprint(x());\n`);
    expect(collectFunctionDeclarations(ast).length).toBe(0);
  });
});
