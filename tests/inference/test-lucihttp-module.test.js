// lucihttp module (liblucihttp-ucode, the LuCI HTTP utility binding). Export names are
// introspection-authoritative across OpenWrt 22.03→main, which all ship the SAME pinned
// source revision (2023.03.15~9b5b683f) with the IDENTICAL 12 exports — so it is NOT
// version-gated. This pins: (1) the real exports resolve on every target, (2) a bogus
// export is flagged (UC3005), (3) no UC3002 "cannot find module", (4) no UC6005 version gate.
import { test, expect, describe } from 'bun:test';
const path = require('path');
const { UcodeLexer } = require(path.resolve('src/lexer/ucodeLexer'));
const { UcodeParser } = require(path.resolve('src/parser/ucodeParser'));
const { SemanticAnalyzer } = require(path.resolve('src/analysis/semanticAnalyzer'));
const { isKnownModule } = require(path.resolve('src/analysis/moduleDispatch'));
const { TextDocument } = require('vscode-languageserver-textdocument');

function diags(code, targetVersion = '25.12') {
  const doc = TextDocument.create('file:///t.uc', 'ucode', 1, code);
  const { ast } = new UcodeParser(new UcodeLexer(code, { rawMode: true }).tokenize(), code).parse();
  return new SemanticAnalyzer(doc, { targetVersion }).analyze(ast).diagnostics;
}
const codes = (code, tv) => diags(code, tv).map(d => d.code);

const FUNCS = ['urlencode', 'urldecode', 'urlencoded_parser', 'multipart_parser', 'header_attribute'];
const CONSTS = ['ENCODE_IF_NEEDED', 'ENCODE_FULL', 'ENCODE_SPACE_PLUS',
                'DECODE_IF_NEEDED', 'DECODE_PLUS', 'DECODE_KEEP_PLUS', 'DECODE_STRICT'];

test('lucihttp is a known module', () => {
  expect(isKnownModule('lucihttp')).toBe(true);
});

test("the reported import resolves cleanly (no UC3002/UC3005/UC6005)", () => {
  const c = codes("import { urlencode, urldecode, ENCODE_FULL, DECODE_KEEP_PLUS } from 'lucihttp';\n");
  expect(c).not.toContain('UC3002');
  expect(c).not.toContain('UC3005');
  expect(c).not.toContain('UC6005');
});

test('every real export resolves', () => {
  for (const name of [...FUNCS, ...CONSTS]) {
    const c = codes(`import { ${name} } from 'lucihttp';\n`);
    expect(c).not.toContain('UC3002');
    expect(c).not.toContain('UC3005');
  }
});

test('a bogus export is flagged UC3005', () => {
  expect(codes("import { not_a_real_fn } from 'lucihttp';\n")).toContain('UC3005');
});

describe('NOT version-gated — identical on every release', () => {
  for (const tv of ['22.03', '23.05', '24.10', '25.12', 'main']) {
    test(`${tv}: import resolves, no version gate`, () => {
      const c = codes("import { urlencode, ENCODE_FULL } from 'lucihttp';\n", tv);
      expect(c).not.toContain('UC3002');
      expect(c).not.toContain('UC6005');
    });
  }
});
