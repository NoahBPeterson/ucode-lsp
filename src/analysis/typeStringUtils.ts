/**
 * Shared helpers for working with TYPE EXPRESSION STRINGS ("string | null",
 * "array<a|b>", "{a: string, b: integer}"). Leaf module — no imports — so both the
 * JSDoc parser and the registry-string consumers (hover, module dispatch, argument
 * validation) can share one splitter without an import cycle.
 */

/** Split `s` on `sep` at bracket/brace/angle/paren depth 0 (so `{a: string, b: int}`
 *  and `array<a|b>` don't split on inner commas/pipes). A naive `split('|')` shreds
 *  nested expressions into garbage tokens — every union split must go through this. */
export function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === '{' || ch === '[' || ch === '(' || ch === '<') depth++;
    else if (ch === '}' || ch === ']' || ch === ')' || ch === '>') depth--;
    else if (ch === sep && depth === 0) { out.push(s.slice(start, i)); start = i + 1; }
  }
  out.push(s.slice(start));
  return out;
}

/** Bounded Levenshtein (≤ maxDist, early row-min exit) for did-you-mean suggestions. */
export function editDistanceAtMost(a: string, b: string, maxDist: number): number | null {
  if (Math.abs(a.length - b.length) > maxDist) return null;
  const prev = new Array(b.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let best = Infinity;
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = Math.min(
        prev[j]! + 1,
        prev[j - 1]! + 1,
        diag + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diag = prev[j]!;
      prev[j] = cur;
      if (cur < best) best = cur;
    }
    if (best > maxDist) return null;
  }
  return prev[b.length]! <= maxDist ? prev[b.length]! : null;
}
