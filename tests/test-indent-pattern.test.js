const { test, expect } = require('bun:test');
const path = require('path');
const fs = require('fs');

// Guards the editor indentation rule in language-configuration.json. The
// increaseIndentPattern must NOT indent the line after an inline-body braceless
// control statement (`if (cond) continue;`) — the body is complete on that
// line. It SHOULD still indent after a braceless block whose body is on the
// next line (`if (cond)\n  body;`) and after any `{`-opened block.
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'language-configuration.json'), 'utf8'));
const re = new RegExp(cfg.indentationRules.increaseIndentPattern);

const cases = [
  // [line, shouldIncreaseIndentAfter, description]
  ['        if (length(parts) < 2) continue;', false, 'inline-body if continue — the reported bug'],
  ['if (x) return;',                            false, 'inline-body if return'],
  ['while (cond);',                             false, 'empty-body while'],
  ['        obj.foo = bar;',                    false, 'plain statement'],
  ['if (length(parts) < 2)',                    true,  'braceless if, body on next line'],
  ['    for (let i = 0; i < n; i++)',           true,  'braceless for'],
  ['while (cond)',                              true,  'braceless while'],
  ['if (cond) {',                               true,  'braced if'],
  ['for (let i = 0; i < n; i++) {',             true,  'braced for'],
  ['function f() {',                            true,  'function brace'],
];

for (const [line, expected, desc] of cases) {
  test(`increaseIndentPattern: ${desc}`, () => {
    expect(re.test(line)).toBe(expected);
  });
}
