const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');
// Canonical list of GLOBAL builtins (the bare-callable functions). Module
// functions (fs.open, math.cos, …) live in separate maps and are accessed via
// member syntax, so they don't belong in the bare-builtin highlight pattern.
const { builtinFunctions } = require('../src/builtins');

// Recursively locate a TextMate rule by scope name (robust to grammar structure).
function findRule(node, name) {
  if (!node || typeof node !== 'object') return null;
  if (node.name === name && typeof node.match === 'string') return node;
  for (const key of Object.keys(node)) {
    const found = findRule(node[key], name);
    if (found) return found;
  }
  return null;
}

// The list of names in the grammar's `support.function.builtin.ucode` pattern,
// parsed out of its `\b(a|b|c)\b(?=\s*\()` match regex.
function grammarBuiltins() {
  const grammarPath = path.join(__dirname, '..', 'syntaxes', 'ucode.tmLanguage.json');
  const grammar = JSON.parse(fs.readFileSync(grammarPath, 'utf8'));
  const rule = findRule(grammar, 'support.function.builtin.ucode');
  if (!rule) throw new Error('grammar rule support.function.builtin.ucode not found');
  const m = rule.match.match(/\(([^)]*)\)/); // first group = the name alternation
  if (!m) throw new Error('could not parse builtin alternation from: ' + rule.match);
  return m[1].split('|');
}

// The grammar must highlight EVERY global builtin — otherwise a newly-added
// builtin silently loses its color (this is exactly how `rindex` + 14 others
// drifted out before 0.6.120).
test('TextMate grammar highlights every global builtin from src/builtins.ts', () => {
  const grammarSet = new Set(grammarBuiltins());
  const missing = [...builtinFunctions.keys()].filter(fn => !grammarSet.has(fn)).sort();
  expect(missing).toEqual([]);
});

// And the reverse: nothing highlighted as a builtin that isn't one, and no dupes.
test('TextMate builtin list has no stale entries or duplicates', () => {
  const grammarList = grammarBuiltins();
  const canonical = new Set(builtinFunctions.keys());
  const stale = grammarList.filter(fn => !canonical.has(fn)).sort();
  const dupes = grammarList.filter((fn, i) => grammarList.indexOf(fn) !== i).sort();
  expect(stale).toEqual([]);
  expect(dupes).toEqual([]);
});
