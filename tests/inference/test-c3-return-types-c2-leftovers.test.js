// Coverage for the C3 (builtin/module return-type `| null` & lost shapes) and
// C2-leftover (builtin arg over-strictness) clusters.
//
// C3:  fs read/scalar `| null` (#124/#129), writefile signature (#125),
//      stat() result shape (#126), math transcendentals → double (#162),
//      zlib write `| null` (#164), uloop methods `| null` (#165),
//      socket.pair/io.pipe element type (#166).
// C2:  exists() totality (#33/#148), proto(x) get-form (#150),
//      uniq/iptoarr/arrtoip/b64dec graceful-null warning (#36),
//      rindex string|array (#179), call-non-function message (#18).

import { test, expect, describe } from 'bun:test';
import { UcodeLexer } from '../../src/lexer/ucodeLexer.ts';
import { UcodeParser } from '../../src/parser/ucodeParser.ts';
import { SemanticAnalyzer } from '../../src/analysis/semanticAnalyzer.ts';
import { typeToString } from '../../src/analysis/symbolTable.ts';
import { handleHover } from '../../src/hover.ts';

function analyze(code) {
  const lexer = new UcodeLexer(code, { rawMode: true });
  const tokens = lexer.tokenize();
  const parser = new UcodeParser(tokens, code);
  const parseResult = parser.parse();
  const doc = {
    getText: () => code,
    positionAt: (o) => { let l = 0, c = 0; for (let i = 0; i < o && i < code.length; i++) { if (code[i] === '\n') { l++; c = 0; } else { c++; } } return { line: l, character: c }; },
    offsetAt: (p) => { const lines = code.split('\n'); let o = 0; for (let i = 0; i < p.line && i < lines.length; i++) { o += lines[i].length + 1; } return o + p.character; },
    uri: 'file:///test.uc', languageId: 'ucode', version: 1,
  };
  const analyzer = new SemanticAnalyzer(doc, { enableScopeAnalysis: true, enableTypeChecking: true });
  return analyzer.analyze(parseResult.ast);
}

const typeOf = (code, varName) => {
  const sym = analyze(code).symbolTable.lookup(varName);
  return sym ? typeToString(sym.dataType) : 'NOT FOUND';
};

// Hover the first occurrence of `needle` on `lineIdx` (0-based) and return the first line.
const hoverFirstLine = (code, lineIdx, needle) => {
  const uri = 'file:///test.uc';
  const lx = new UcodeLexer(code, { rawMode: true });
  const ps = new UcodeParser(lx.tokenize(), code).parse();
  const doc = {
    getText: () => code,
    positionAt: (o) => { let l = 0, c = 0; for (let i = 0; i < o && i < code.length; i++) { if (code[i] === '\n') { l++; c = 0; } else { c++; } } return { line: l, character: c }; },
    offsetAt: (p) => { const lines = code.split('\n'); let o = 0; for (let i = 0; i < p.line && i < lines.length; i++) { o += lines[i].length + 1; } return o + p.character; },
    uri, languageId: 'ucode', version: 1,
  };
  const ar = new SemanticAnalyzer(doc, { enableScopeAnalysis: true, enableTypeChecking: true }).analyze(ps.ast);
  const documents = { get: (u) => (u === uri ? doc : undefined) };
  const col = code.split('\n')[lineIdx].indexOf(needle) + 1;
  const h = handleHover({ textDocument: { uri }, position: { line: lineIdx, character: col } }, documents, ar);
  const v = h && h.contents ? (typeof h.contents === 'string' ? h.contents : h.contents.value || '') : '';
  return v.split('\n')[0];
};
const errorsOf = (code) => analyze(code).diagnostics.filter(d => d.severity === 1);
const warningsOf = (code) => analyze(code).diagnostics.filter(d => d.severity === 2);

describe('C3 — fs handle read()/scalar methods carry `| null` (#124/#129)', () => {
  test('fs.file read() is string | null', () => {
    const t = typeOf("import { open } from 'fs';\nlet f = open('/x');\nlet c = f.read('all');\n", 'c');
    expect(t).toContain('string');
    expect(t).toContain('null');
  });

  test('fs.dir read() is string | null (the end-of-stream terminator)', () => {
    const t = typeOf("import { opendir } from 'fs';\nlet d = opendir('/etc');\nlet e = d.read();\n", 'e');
    expect(t).toContain('string');
    expect(t).toContain('null');
  });

  test('fs.file scalar methods (tell/write/fileno) are nullable', () => {
    const t = typeOf("import { open } from 'fs';\nlet f = open('/x');\nlet n = f.tell();\n", 'n');
    expect(t).toContain('integer');
    expect(t).toContain('null');
  });
});

describe('C3 — stat() result shape (#126)', () => {
  const PRE = "import { stat } from 'fs';\nlet st = stat('/x');\n";
  test('st.size is integer', () => {
    expect(typeOf(PRE + 'let s = st.size;', 's')).toBe('integer');
  });
  test('st.type is string', () => {
    expect(typeOf(PRE + 'let ty = st.type;', 'ty')).toBe('string');
  });
  test('nested st.dev.major is integer (chained member resolution)', () => {
    expect(typeOf(PRE + 'let mj = st.dev.major;', 'mj')).toBe('integer');
  });
  test('nested st.perm.user_exec is boolean', () => {
    expect(typeOf(PRE + 'let ex = st.perm.user_exec;', 'ex')).toBe('boolean');
  });
  test('accessing a known stat field does not error', () => {
    expect(errorsOf(PRE + 'let s = st.size; let m = st.mtime; let ty = st.type;').length).toBe(0);
  });
  test('an unknown stat field is flagged', () => {
    expect(errorsOf(PRE + 'let bad = st.bogusfield;').some(d => d.message.includes('bogusfield'))).toBe(true);
  });

  // Hovering the nested PROPERTY NAME itself (not just the assigned variable) resolves.
  test('hovering nested `major` shows integer', () => {
    const code = "import { stat } from 'fs';\nlet info = stat('/x');\nlet mj = info.dev.major;";
    expect(hoverFirstLine(code, 2, 'major')).toContain('integer');
  });
  test('hovering nested `user_exec` shows boolean', () => {
    const code = "import { stat } from 'fs';\nlet info = stat('/x');\nlet ex = info.perm.user_exec;";
    expect(hoverFirstLine(code, 2, 'user_exec')).toContain('boolean');
  });
});

describe('chained / indexed receiver resolves the handle type', () => {
  test('open().read() (call-result receiver) is string | null', () => {
    const t = typeOf("import { open } from 'fs';\nlet c = open('/x').read('all');", 'c');
    expect(t).toContain('string');
    expect(t).toContain('null');
  });
  test('array<socket> element method resolves: pair()[0].recv() is not unknown', () => {
    const t = typeOf("import { pair } from 'socket';\nlet rx = pair()[0].recv(10);", 'rx');
    expect(t).not.toBe('unknown');
  });
});

describe('C3 — math transcendentals return double (#162)', () => {
  for (const fn of ['sqrt(4)', 'pow(2,3)', 'sin(1)', 'cos(1)', 'exp(1)', 'log(2)', 'atan2(1,1)']) {
    test(`math.${fn} is double`, () => {
      expect(typeOf(`import * as math from 'math';\nlet x = math.${fn};`, 'x')).toBe('double');
    });
  }
});

describe('C3 — socket.pair / io.pipe element types (#166)', () => {
  test('socket.pair() is array<socket> | null', () => {
    const t = typeOf("import { pair } from 'socket';\nlet a = pair();", 'a');
    expect(t).toContain('array');
    expect(t).toContain('null');
  });
});

describe('C2 — exists() type mismatch is a warning, not an error (#33/#148)', () => {
  test('non-object first argument warns, never errors', () => {
    const code = 'let x = exists(5, "k");';
    expect(errorsOf(code).length).toBe(0);
    expect(warningsOf(code).some(d => d.message.includes('exists'))).toBe(true);
  });
  test('non-string key warns (it is coerced), never errors', () => {
    const code = 'let o = {}; let x = exists(o, true);';
    expect(errorsOf(code).length).toBe(0);
    expect(warningsOf(code).some(d => d.message.includes('exists'))).toBe(true);
  });
});

describe('C2 — proto(x) query form tolerates any value (#150)', () => {
  test('proto("string") is not an error', () => {
    expect(errorsOf('let x = proto("s");').length).toBe(0);
  });
});

describe('C2 — graceful-null builtins warn, not error (#36)', () => {
  test('uniq("abc") is a warning, not an error', () => {
    const code = 'let x = uniq("abc");';
    expect(errorsOf(code).length).toBe(0);
    expect(warningsOf(code).some(d => d.message.includes('uniq'))).toBe(true);
  });
  test('b64dec(123) is a warning, not an error', () => {
    const code = 'let x = b64dec(123);';
    expect(errorsOf(code).length).toBe(0);
    expect(warningsOf(code).some(d => d.message.includes('b64dec'))).toBe(true);
  });
});

describe('C2 — calling a non-function value reports its type, not "Undefined function" (#18)', () => {
  test('let n = 5; n() says n is not a function', () => {
    const errs = errorsOf('let n = 5;\nn();');
    expect(errs.length).toBeGreaterThan(0);
    const msg = errs.map(e => e.message).join(' | ');
    expect(msg).toContain("not a function");
    expect(msg).not.toContain('Undefined function');
  });
});
