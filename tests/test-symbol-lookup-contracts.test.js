// Enforce the two-function symbol-lookup contract (docs/stale-scope-lookup-audit.md):
//
//   resolveReference(name, pos)  - "which symbol does this identifier occurrence
//                                   denote?" Valid in every execution window.
//   lookupOpenScopes(name)       - "what does this name bind to in the scope chain
//                                   the analyzer is currently INSIDE?" Only valid
//                                   during the node's own in-scope visit.
//
// Two mistake classes this suite locks out:
//   1. hand-composing the pair at call sites (four sites had it REVERSED —
//      lookup first — which silently prefers a wrong outer-scope hit);
//   2. reintroducing the removed plain `lookup` name.

const { test, expect } = require('bun:test');
const { readFileSync, readdirSync, statSync } = require('fs');
const { join } = require('path');

const SRC = join(__dirname, '..', 'src');

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

const files = walk(SRC).map(p => ({ path: p, text: readFileSync(p, 'utf8') }));
const isSymbolTable = (p) => p.endsWith('symbolTable.ts');

test('the removed plain lookup() name does not come back', () => {
  const offenders = [];
  for (const { path, text } of files) {
    // `.lookup(` on any symbol-table-ish receiver; the named survivors are
    // lookupOpenScopes / lookupAtPosition / lookupInCurrentScope / lookupSymbol.
    const re = /[sS]ymbolTable[!?]?\.lookup\(/g;
    if (re.test(text)) offenders.push(path);
  }
  expect(offenders).toEqual([]);
});

test('no hand-composed lookupAtPosition/lookupOpenScopes pairs outside symbolTable.ts', () => {
  const offenders = [];
  for (const { path, text } of files) {
    if (isSymbolTable(path)) continue;
    // Same-name pair composed with ?? or || in either order, allowing a line break
    // between the two calls. resolveReference is the only sanctioned composition.
    const composed =
      /lookupAtPosition\([^;]{0,200}?(\?\?|\|\|)\s*[\w?.!]*lookupOpenScopes\(/s.test(text)
      || /lookupOpenScopes\([^;]{0,200}?(\?\?|\|\|)\s*[\w?.!]*lookupAtPosition\(/s.test(text);
    if (composed) offenders.push(path);
  }
  expect(offenders).toEqual([]);
});

test('lookupAtPosition stays rare outside symbolTable.ts (position-ONLY intent sites)', () => {
  // Position-only lookups (no fallback) are legitimate ONLY where "declared later"
  // must be distinguishable from "visible here" (forward-reference detection) or
  // where a miss is deliberately terminal. Growth here should be a conscious choice:
  // bump the bound only with a comment at the new site explaining why
  // resolveReference (which adds the open-chain fallback) is wrong for it.
  let count = 0;
  for (const { path, text } of files) {
    if (isSymbolTable(path)) continue;
    count += (text.match(/\.lookupAtPosition\(/g) ?? []).length;
  }
  expect(count).toBeLessThanOrEqual(12);
});
