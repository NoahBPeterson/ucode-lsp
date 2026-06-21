// Exhaustive, mutually-distinct unit tests for `'use strict'` detection (detectStrictMode),
// across raw scripts AND templates. The directive is honored only when it is the first
// STATEMENT; in a template, leading text / `{{ }}` / whitespace compiles to a print() and
// makes it inert, while a shebang and `{# … #}` comment blocks do not. Every template
// expectation here was confirmed against the ucode/utpl oracle (see test-template-strict-mode).

import { test, expect, describe } from 'bun:test';
import { UcodeLexer, detectTemplateMode, bridgeTemplateTokens } from '../src/lexer/index.ts';
import { UcodeParser } from '../src/parser/ucodeParser.ts';
import { SemanticAnalyzer } from '../src/analysis/semanticAnalyzer.ts';

function strictOf(src) {
  const isT = detectTemplateMode(src);
  const ast = new UcodeParser(isT ? bridgeTemplateTokens(new UcodeLexer(src, { rawMode: !isT }).tokenize()) : new UcodeLexer(src, { rawMode: !isT }).tokenize(), src).parse().ast;
  const doc = { getText: () => src, positionAt: (o) => ({ line: 0, character: o }), offsetAt: (p) => p.character, uri: 'file:///t.uc', languageId: 'ucode', version: 1 };
  const an = new SemanticAnalyzer(doc, { enableScopeAnalysis: true, enableTypeChecking: true });
  an.analyze(ast);
  return an.strictMode;
}

// [description, source, expectedStrict]
const RAW_STRICT = [
  ['raw: single-quote directive', "'use strict';", true],
  ['raw: double-quote directive', '"use strict";', true],
  ['raw: directive then code', "'use strict'; let x = 1;", true],
  ['raw: directive, newline, code', "'use strict';\nlet x = 1;", true],
  ['raw: shebang then directive', "#!/usr/bin/ucode\n'use strict';", true],
  ['raw: shebang -S then directive', "#!/usr/bin/ucode -S\n'use strict';", true],
  ['raw: line comment then directive', "// hdr\n'use strict';", true],
  ['raw: block comment then directive', "/* hdr */'use strict';", true],
  ['raw: multiline block comment then directive', "/*\n multi\n*/\n'use strict';", true],
  ['raw: two line comments then directive', "// a\n// b\n'use strict';", true],
  ['raw: shebang + comment + directive', "#!/usr/bin/ucode\n// note\n'use strict';", true],
  ['raw: leading blank lines then directive', "\n\n'use strict';", true],
  ['raw: directive then function', "'use strict';\nfunction f(){}", true],
];

const RAW_NONSTRICT = [
  ['raw: empty file', '', false],
  ['raw: whitespace only', '   \n  ', false],
  ['raw: line comment only', '// just a comment', false],
  ['raw: block comment only', '/* x */', false],
  ['raw: code, no directive', 'let x = 1;', false],
  ['raw: directive not first (after let)', "let x = 1; 'use strict';", false],
  ['raw: directive after a call', "foo(); 'use strict';", false],
  ['raw: directive after a number', "42; 'use strict';", false],
  ['raw: directive as a value', "let x = 'use strict';", false],
  ['raw: directive inside a call', "print('use strict');", false],
  ['raw: misspelled directive', "'use strcit';", false],
  ['raw: wrong case directive', "'USE STRICT';", false],
  ['raw: identifier, not a string', 'use_strict;', false],
  ['raw: backtick template literal', '`use strict`;', false],
  ['raw: partial string', "'use';", false],
  ['raw: extra words', "'use strict mode';", false],
  ['raw: string concatenation', "'use ' + 'strict';", false],
];

const TEMPLATE_STRICT = [
  ['tpl: leading {% directive %}', "{% 'use strict'; %}", true],
  ['tpl: double-quote directive', '{% "use strict"; %}', true],
  ['tpl: directive then expr tag', "{% 'use strict'; %}{{ x }}", true],
  ['tpl: {%- strip modifier', "{%- 'use strict'; -%}", true],
  ['tpl: {%+ no-strip modifier (still strict)', "{%+ 'use strict'; %}", true],
  ['tpl: one {# comment #} before', "{# hdr #}{% 'use strict'; %}", true],
  ['tpl: two comment blocks before', "{# a #}{# b #}{% 'use strict'; %}", true],
  ['tpl: comment inside the block', "{% /* c */ 'use strict'; %}", true],
  ['tpl: empty {% %} block before', "{% %}{% 'use strict'; %}", true],
  ['tpl: utpl shebang then block', "#!/usr/bin/utpl\n{% 'use strict'; %}", true],
  ['tpl: directive first, more code', "{% 'use strict'; let x = ARGV; %}", true],
  ['tpl: newlines inside the block', "{%\n'use strict';\n%}", true],
  ['tpl: comment block + directive + text', "{# h #}{% 'use strict'; %}rendered", true],
];

const TEMPLATE_NONSTRICT = [
  ['tpl: leading text', "hi{% 'use strict'; %}", false],
  ['tpl: leading space', " {% 'use strict'; %}", false],
  ['tpl: leading newline', "\n{% 'use strict'; %}", false],
  ['tpl: leading tab', "\t{% 'use strict'; %}", false],
  ['tpl: leading CRLF', "\r\n{% 'use strict'; %}", false],
  ['tpl: leading expr tag {{ }}', "{{ 1 }}{% 'use strict'; %}", false],
  ['tpl: comment then space then block', "{# c #} {% 'use strict'; %}", false],
  ['tpl: text before comment', "x{# c #}{% 'use strict'; %}", false],
  ['tpl: directive not first in block', "{% let z = 1; 'use strict'; %}", false],
  ['tpl: directive after a call in block', "{% foo(); 'use strict'; %}", false],
  ['tpl: template with no directive', "{% let x = 1; %}", false],
  ['tpl: expression tag only', "{{ x }}", false],
  ['tpl: unclosed leading comment', "{# unclosed {% 'use strict'; %}", false],
];

// detectTemplateMode interaction: a tag-looking sequence in a string/comment must not flip the
// file to template mode, so a raw directive is still honored (or not).
const INTERACTION = [
  ['raw with {{ }} inside a string, directive first', "'use strict';\nlet t = \"{{x}}\";", true],
  ['raw with {{ }} in a comment, directive not first', "let x = 1; // {{y}}\n'use strict';", false],
];

const ALL = [...RAW_STRICT, ...RAW_NONSTRICT, ...TEMPLATE_STRICT, ...TEMPLATE_NONSTRICT, ...INTERACTION];

describe(`detectStrictMode — ${ALL.length} distinct cases (raw + template, oracle-verified)`, () => {
  // Guard: keep the suite genuinely exhaustive.
  test('has at least 50 distinct cases', () => {
    expect(ALL.length).toBeGreaterThanOrEqual(50);
    expect(new Set(ALL.map(([, src]) => src)).size).toBe(ALL.length); // all sources distinct
  });

  for (const [desc, src, expected] of ALL) {
    test(`${expected ? 'STRICT' : 'non-strict'}: ${desc}`, () => {
      expect(strictOf(src)).toBe(expected);
    });
  }
});
