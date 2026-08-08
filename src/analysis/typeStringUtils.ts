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
