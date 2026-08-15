/**
 * Static validation of a JSON **string literal** passed to `json()`.
 *
 * ucode parses with json-c (`json_tokener_parse_ex`), which is markedly more
 * lenient than JavaScript's `JSON.parse` — using the latter as the oracle would
 * false-positive on real, working input. Verified against owrt-main:
 *
 *   ACCEPTED by json-c, rejected by JSON.parse:
 *     {'a':1}          single-quoted strings and keys
 *     {"a":1,} [1,2,]  trailing commas
 *     NaN Infinity -Infinity nan
 *     01               leading zeros
 *     {"a":1 /* c *\/} block comments
 *
 *   REJECTED by json-c:
 *     {1:2} {a:1}      an object key must be a QUOTED string
 *     .5  +1  0x10     not valid number syntax here
 *     {"a":1} trailing content after the value (uc_json_from_string scans the
 *                      remainder and fails on any non-space byte)
 *     ""               empty / whitespace-only input
 *     [1,2   {"a":1    unterminated
 *
 * Returns 'unsure' for anything this validator does not model with confidence,
 * so callers stay silent rather than guess.
 */
export type JsonTextVerdict = 'valid' | 'invalid' | 'unsure';

export function validateJsonText(text: string): JsonTextVerdict {
  const s = text;
  let i = 0;
  let unsure = false;

  const skipWs = (): void => {
    for (;;) {
      while (i < s.length && (s[i] === ' ' || s[i] === '\t' || s[i] === '\n' || s[i] === '\r')) i++;
      // json-c accepts /* … */ comments between tokens.
      if (s[i] === '/' && s[i + 1] === '*') {
        const end = s.indexOf('*/', i + 2);
        if (end < 0) { unsure = true; i = s.length; return; }
        i = end + 2;
        continue;
      }
      return;
    }
  };

  /** A quoted string, single or double. Returns false when unterminated. */
  const readString = (): boolean => {
    const quote = s[i];
    if (quote !== '"' && quote !== "'") return false;
    i++;
    while (i < s.length) {
      const c = s[i];
      if (c === '\\') { i += 2; continue; }
      if (c === quote) { i++; return true; }
      i++;
    }
    return false; // unterminated
  };

  const readNumberOrKeyword = (): boolean => {
    const start = i;
    while (i < s.length && !' \t\n\r,}]'.includes(s[i] ?? '')) i++;
    const tok = s.slice(start, i);
    if (tok.length === 0) return false;
    if (/^(true|false|null|nan|-?infinity)$/i.test(tok)) return true;
    // json-c accepts leading zeros; it does NOT accept .5, +1, or 0x10.
    if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(tok)) return true;
    return false;
  };

  const readValue = (depth: number): boolean => {
    if (depth > 64) { unsure = true; return true; }
    skipWs();
    if (i >= s.length) return false;
    const c = s[i];
    if (c === '"' || c === "'") return readString();
    if (c === '{') {
      i++;
      for (;;) {
        skipWs();
        if (s[i] === '}') { i++; return true; }
        // A key MUST be a quoted string — `{a:1}` and `{1:2}` are rejected.
        if (s[i] !== '"' && s[i] !== "'") return false;
        if (!readString()) return false;
        skipWs();
        if (s[i] !== ':') return false;
        i++;
        if (!readValue(depth + 1)) return false;
        skipWs();
        if (s[i] === ',') { i++; continue; }   // trailing comma is allowed
        if (s[i] === '}') { i++; return true; }
        return false;
      }
    }
    if (c === '[') {
      i++;
      for (;;) {
        skipWs();
        if (s[i] === ']') { i++; return true; }
        if (!readValue(depth + 1)) return false;
        skipWs();
        if (s[i] === ',') { i++; continue; }   // trailing comma is allowed
        if (s[i] === ']') { i++; return true; }
        return false;
      }
    }
    return readNumberOrKeyword();
  };

  if (!readValue(0)) return unsure ? 'unsure' : 'invalid';
  // uc_json_from_string rejects any non-whitespace after the parsed value.
  skipWs();
  if (unsure) return 'unsure';
  return i >= s.length ? 'valid' : 'invalid';
}
