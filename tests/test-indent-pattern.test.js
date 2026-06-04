const { test, expect } = require('bun:test');
const path = require('path');
const fs = require('fs');

// Guards the editor indentation rule in language-configuration.json. Only a
// line that OPENS a brace (`… {`) increases indent. Braceless control statements
// (`if (cond)` on its own line) do NOT — a line-based rule can't tell whether the
// next line will be a statement (wants indent) or an Allman-style `{` (wants the
// brace at the control's level), and ucode is overwhelmingly braced, so we favor
// Allman correctness: `if (cond)\n{` keeps `{` aligned with `if`. (K&R `if (x) {`
// and one-liners `if (x) return;` are unaffected.)
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'language-configuration.json'), 'utf8'));
const re = new RegExp(cfg.indentationRules.increaseIndentPattern);

const cases = [
  // [line, shouldIncreaseIndentAfter, description]
  ['        if (length(parts) < 2) continue;', false, 'inline-body if continue'],
  ['if (x) return;',                            false, 'inline-body if return'],
  ['while (cond);',                             false, 'empty-body while'],
  ['        obj.foo = bar;',                    false, 'plain statement'],
  ['if (length(parts) < 2)',                    false, 'braceless if — no indent (Allman-friendly)'],
  ['    for (let i = 0; i < n; i++)',           false, 'braceless for — no indent'],
  ['while (cond)',                              false, 'braceless while — no indent'],
  ['if (cond) {',                               true,  'braced if'],
  ['for (let i = 0; i < n; i++) {',             true,  'braced for'],
  ['function f() {',                            true,  'function brace'],
];

for (const [line, expected, desc] of cases) {
  test(`increaseIndentPattern: ${desc}`, () => {
    expect(re.test(line)).toBe(expected);
  });
}
