// Bring-up of OpenWrt feed modules (ucode-mod-*) that aren't in the ucode core tree.
// Names/constants are introspection-authoritative (real package on the pinned release);
// handle method names come from the vendored uc_function_list_t tables. This suite pins:
//   (1) a named import resolves (no false UC3006 "not exported" / UC3002 "cannot find"),
//   (2) the module is version-gated (UC6005) on releases before its feed appearance,
//   (3) object-handle methods resolve and bogus ones are flagged.
// See src/analysis/ucodeVersions.ts (VERSION_MODULES) for the per-module minimums.

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
const has = (code, c, tv) => codes(code, tv).includes(c);

describe('23.05 feed modules: html, bpf, lua', () => {
  test('all three are known modules', () => {
    for (const m of ['html', 'bpf', 'lua']) expect(isKnownModule(m)).toBe(true);
  });

  // Import resolution on a release that HAS them (default 25.12): no module errors.
  const validImports = {
    html: "import { entityencode, striptags, OPEN } from 'html';\n",
    bpf: "import { open_module, BPF_ANY } from 'bpf';\n",
    lua: "import { create } from 'lua';\n",
  };
  for (const [m, code] of Object.entries(validImports)) {
    test(`${m}: named import resolves on 25.12 (no UC3006/UC3002)`, () => {
      const cs = codes(code, '25.12');
      expect(cs).not.toContain('UC3006');
      expect(cs).not.toContain('UC3002');
    });
    test(`${m}: import is version-gated — flagged on 22.03, clean on 23.05+`, () => {
      expect(has(code, 'UC6005', '22.03')).toBe(true);
      expect(has(code, 'UC6005', '23.05')).toBe(false);
      expect(has(code, 'UC6005', '25.12')).toBe(false);
    });
  }

  test('a bogus import is rejected (UC3005 not-exported)', () => {
    expect(has("import { nope } from 'html';\n", 'UC3005', '25.12')).toBe(true);
  });

  test('bpf handle methods resolve; a bogus method is flagged', () => {
    const good = "import { open_module } from 'bpf';\nlet m = open_module('/x');\nm.get_map('c');\n";
    expect(codes(good, '25.12')).not.toContain('UC5004'); // get_map exists on bpf.module
    const bad = "import { open_module } from 'bpf';\nlet m = open_module('/x');\nm.no_such_method();\n";
    expect(has(bad, 'UC5004', '25.12')).toBe(true);
  });
});

describe('24.10 feed modules: uclient, udebug', () => {
  test('both are known modules', () => {
    for (const m of ['uclient', 'udebug']) expect(isKnownModule(m)).toBe(true);
  });
  const validImports = {
    uclient: "import { new as nc } from 'uclient';\n",
    udebug: "import { create_ring, FORMAT_STRING } from 'udebug';\n",
  };
  for (const [m, code] of Object.entries(validImports)) {
    test(`${m}: named import resolves on 25.12 (no UC3005/UC3002)`, () => {
      const cs = codes(code, '25.12');
      expect(cs).not.toContain('UC3005');
      expect(cs).not.toContain('UC3002');
    });
    test(`${m}: version-gated — flagged on 22.03 AND 23.05, clean on 24.10+`, () => {
      expect(has(code, 'UC6005', '22.03')).toBe(true);
      expect(has(code, 'UC6005', '23.05')).toBe(true);
      expect(has(code, 'UC6005', '24.10')).toBe(false);
      expect(has(code, 'UC6005', '25.12')).toBe(false);
    });
  }
});
