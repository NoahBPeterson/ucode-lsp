// Regression guard for the bracket-pair-colorization desync bug: single-line
// constructs (double/single quoted strings, regex literals, and regex char classes)
// MUST anchor their `end` to the line boundary so an unterminated/in-progress
// construct can't span lines and swallow subsequent brackets. Multi-line template
// literals are intentionally NOT anchored. See the tokenization analysis in 0.6.173.
const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');

const grammar = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'syntaxes', 'ucode.tmLanguage.json'), 'utf8'));

function findRuleByName(node, name) {
  if (!node || typeof node !== 'object') return null;
  if (node.name === name && (node.begin || node.end)) return node;
  for (const k of Object.keys(node)) {
    const r = findRuleByName(node[k], name);
    if (r) return r;
  }
  return null;
}

// The EOL anchor we expect in each single-line rule's end pattern.
const EOL_ANCHOR = '(?<!\\\\)$';

for (const name of [
  'string.quoted.double.ucode',
  'string.quoted.single.ucode',
  'string.regexp.ucode',
  'constant.other.character-class.regexp.ucode',
]) {
  test(`${name} end is line-anchored (can't span lines)`, () => {
    const rule = findRuleByName(grammar, name);
    expect(rule).toBeTruthy();
    expect(typeof rule.end).toBe('string');
    expect(rule.end.includes(EOL_ANCHOR)).toBe(true);
  });
}

test('the template literal end is NOT line-anchored (templates are multi-line)', () => {
  const tpl = findRuleByName(grammar, 'string.template.ucode');
  expect(tpl).toBeTruthy();
  expect(tpl.end).toBe('`');
  expect(tpl.end.includes(EOL_ANCHOR)).toBe(false);
});
