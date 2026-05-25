// Unit tests for the in-file reference finder behind the "N references" CodeLens.
import { test, expect, describe } from 'bun:test';
import { findFunctionReferences, formatReferencesTitle } from '../src/references';
import { collectFunctionDeclarations } from '../src/gitHistory';
import { UcodeLexer } from '../src/lexer/ucodeLexer';
import { UcodeParser } from '../src/parser/ucodeParser';

function parse(src) {
  const lexer = new UcodeLexer(src, { rawMode: true });
  const tokens = lexer.tokenize();
  const parser = new UcodeParser(tokens, src);
  parser.setComments(lexer.comments);
  return parser.parse().ast;
}

function refsFor(src, name) {
  const ast = parse(src);
  const fn = collectFunctionDeclarations(ast).find(f => f.id && f.id.name === name);
  return findFunctionReferences(ast, name, fn.id);
}

describe('formatReferencesTitle', () => {
  test('none / singular / plural', () => {
    expect(formatReferencesTitle(0)).toBe('no references');
    expect(formatReferencesTitle(1)).toBe('1 reference');
    expect(formatReferencesTitle(3)).toBe('3 references');
  });
});

describe('findFunctionReferences', () => {
  test('counts call sites, excludes the declaration', () => {
    const src = `function helper() { return 1; }
function main() {
    return helper() + helper();
}
helper();
`;
    expect(refsFor(src, 'helper').length).toBe(3); // two in main + one top-level
    expect(refsFor(src, 'main').length).toBe(0);   // never called
  });

  test('excludes member properties and object-literal keys of the same name', () => {
    const src = `function load() { return 1; }
let obj = { load: 1 };
let x = obj.load;
load();
`;
    // {load:1} key and obj.load member are NOT references; only load() is.
    expect(refsFor(src, 'load').length).toBe(1);
  });

  test('reports source spans (start < end) for each reference', () => {
    const src = `function f() { return 1; }\nf();\n`;
    const spans = refsFor(src, 'f');
    expect(spans.length).toBe(1);
    expect(spans[0].end).toBeGreaterThan(spans[0].start);
  });
});
