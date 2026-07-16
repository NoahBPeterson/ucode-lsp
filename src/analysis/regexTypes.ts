/**
 * Regex type definitions and utilities
 * Based on ucode regex literal support
 */

/** Per-pattern capture-group static shape, computed by `analyzeCaptureGroups` for
 *  a regex LITERAL. `groupCount` is the number of capturing groups (`re_nsub`);
 *  `optional[i]` (0-based, group `i+1`) is true when group `i+1` may fail to
 *  participate even on an overall successful match. See docs/tc-match-capture-group-typing.md. */
export interface CaptureGroupInfo {
  groupCount: number;
  optional: boolean[];
}

/** Tree node for one capturing group discovered while scanning a POSIX ERE pattern. */
interface GroupNode {
  index: number;           // 0-based group number (group id = index + 1)
  children: GroupNode[];
  ownQuantifierOptional: boolean; // directly followed by `?`, `*`, or `{0,...}`
  bodyHasAlt: boolean;     // this group's OWN body contains a top-level `|`
}

/** Scanning frame: either the top-level pattern (node === null) or a currently-open
 *  group's body. `hasAlt` becomes true the moment an unescaped `|` is seen at this
 *  frame's own nesting depth (not inside a nested group) — a top-level `|` in a
 *  frame means every group opened DIRECTLY in that frame is optional (only one
 *  alternation branch actually runs), regardless of whether the `|` appears before
 *  or after the group textually. */
interface Frame {
  node: GroupNode | null;
  hasAlt: boolean;
  children: GroupNode[];
}

/** Parse the `{n}` / `{n,}` / `{n,m}` interval quantifier starting at `pattern[pos]`
 *  (which must be `{`). Returns null if it doesn't look like a valid interval (then
 *  the `{` is just a literal character in POSIX ERE — no capture-group impact). */
function parseInterval(pattern: string, pos: number): { minZero: boolean; length: number } | null {
  const m = /^\{(\d*)(,(\d*))?\}/.exec(pattern.slice(pos));
  if (!m) return null;
  const minStr = m[1] ?? '';
  if (minStr === '' && !m[2]) return null; // `{}` / `{,}` — not a real POSIX interval
  const min = minStr === '' ? 0 : parseInt(minStr, 10);
  return { minZero: min === 0, length: m[0].length };
}

/** Does the quantifier (if any) immediately at `pattern[pos]` make the PRECEDING
 *  atom (here, the group that just closed) optional — i.e. a repetition whose
 *  minimum is 0 (`?`, `*`, `{0,...}`)? `+` and `{n,...}` with n>=1 keep the atom
 *  mandatory (still subject to enclosing alternation/optionality separately). */
function quantifierMakesOptional(pattern: string, pos: number): boolean {
  const c = pattern[pos];
  if (c === '?' || c === '*') return true;
  if (c === '+') return false;
  if (c === '{') {
    const interval = parseInterval(pattern, pos);
    if (interval) return interval.minZero;
  }
  return false;
}

/** Compute the static capture-group shape of a POSIX ERE pattern (ucode regexes
 *  compile straight through `regcomp(..., REG_EXTENDED)` — verified against
 *  ucode/types.c:1397-1415 — with no preprocessing, so there is no `(?:...)`
 *  non-capturing group: a literal `(?` is a regcomp error ("repetition-operator
 *  operand invalid"), confirmed against the runtime). Every unescaped `(` outside
 *  a bracket expression opens a NEW capturing group, counted left-to-right.
 *
 *  A group is OPTIONAL (may be null even on a successful overall match) iff, on
 *  the path from the pattern root to that group:
 *   - it is directly followed by a 0-minimum quantifier (`?`, `*`, `{0,...}`), OR
 *   - its ENCLOSING frame (the top-level pattern, or an ancestor group's body)
 *     contains a top-level `|` — i.e. the group sits in one branch of an
 *     alternation and the other branch might run instead (`(a)|(b)`: both
 *     optional). Alternation INSIDE a group's own body does NOT make that group
 *     itself optional — `(stdout|stderr|exitcode)` is a single mandatory group;
 *     the `|` only affects what string it captures — OR
 *   - any ANCESTOR group is itself optional (if the outer group doesn't
 *     participate, nothing nested in it does either).
 *  Anything the scanner can't cleanly prove mandatory defaults to optional (sound
 *  over-approximation, per the ticket's conservative-when-unsure directive).
 */
export function analyzeCaptureGroups(pattern: string): CaptureGroupInfo {
  const optional: boolean[] = [];
  let groupCount = 0;

  const root: Frame = { node: null, hasAlt: false, children: [] };
  const stack: Frame[] = [root];

  try {
    let i = 0;
    const len = pattern.length;
    while (i < len) {
      const c = pattern[i];

      if (c === '\\') { i += 2; continue; } // escape: skip the escaped char entirely

      if (c === '[') {
        // Bracket expression: '(' ')' '|' etc. inside are literal. Handle the
        // POSIX "leading ']' is literal" rule and skip to the matching ']'.
        let j = i + 1;
        if (pattern[j] === '^') j++;
        if (pattern[j] === ']') j++; // literal ']' as first (post-'^') member
        while (j < len && pattern[j] !== ']') j++;
        i = j < len ? j + 1 : len;
        continue;
      }

      if (c === '(') {
        const node: GroupNode = { index: groupCount++, children: [], ownQuantifierOptional: false, bodyHasAlt: false };
        stack[stack.length - 1]!.children.push(node);
        stack.push({ node, hasAlt: false, children: [] });
        i++;
        continue;
      }

      if (c === ')') {
        const closed = stack.length > 1 ? stack.pop()! : stack[0]!; // tolerate stray ')'
        if (closed.node) {
          closed.node.children = closed.children;
          closed.node.bodyHasAlt = closed.hasAlt;
          closed.node.ownQuantifierOptional = quantifierMakesOptional(pattern, i + 1);
        }
        i++;
        continue;
      }

      if (c === '|') {
        stack[stack.length - 1]!.hasAlt = true;
        i++;
        continue;
      }

      i++;
    }

    // Finalize the (possibly still-open, on unbalanced input) root frame.
    root.hasAlt = stack[0]!.hasAlt;
    root.children = stack[0]!.children;

    const walk = (children: GroupNode[], frameHasAlt: boolean, parentOptional: boolean): void => {
      for (const node of children) {
        const isOptional = parentOptional || frameHasAlt || node.ownQuantifierOptional;
        optional[node.index] = isOptional;
        walk(node.children, node.bodyHasAlt, isOptional);
      }
    };
    walk(root.children, root.hasAlt, false);

    // Any group the walk didn't reach (unbalanced parens left it off-tree) —
    // conservative default: optional.
    for (let g = 0; g < groupCount; g++) {
      if (optional[g] === undefined) optional[g] = true;
    }

    return { groupCount, optional };
  } catch {
    // Scanner bug/unexpected input: fail safe — every group optional.
    return { groupCount, optional: Array.from({ length: groupCount }, () => true) };
  }
}

export class RegexTypeRegistry {
  /**
   * Get documentation for a regex pattern
   */
  getRegexDocumentation(pattern: string, flags?: string): string {
    const flagsText = flags ? ` with flags \`${flags}\`` : '';

    // Escapes in a regex LITERAL are regex-level (there is no string-escape layer —
    // the backslash reaches the engine). Decode them so `/\*/` says what it matches.
    const CLASS_ESCAPES: Record<string, string> = {
      d: 'a digit', D: 'a non-digit', w: 'a word character', W: 'a non-word character',
      s: 'whitespace', S: 'non-whitespace', b: 'a word boundary', B: 'a non-word-boundary',
      n: 'a newline', t: 'a tab', r: 'a carriage return',
    };
    const decoded: string[] = [];
    const seen = new Set<string>();
    for (const m of pattern.matchAll(/\\(.)/g)) {
      const c = m[1]!;
      if (seen.has(c)) continue;
      seen.add(c);
      decoded.push(CLASS_ESCAPES[c] ? `\`\\${c}\` = ${CLASS_ESCAPES[c]}` : `\`\\${c}\` = a literal \`${c}\``);
    }
    const escapeNote = decoded.length > 0
      ? `\n\nEscapes here are part of the PATTERN (a regex literal has no string-escape layer): ${decoded.join(', ')}.`
      : '';

    return `**Regular Expression**${flagsText}

Pattern: \`${pattern}\`${escapeNote}

**Type:** \`regexp\`

Regular expressions are independent objects used for pattern matching and text processing. They support standard regex syntax including:

- **Character classes**: \`[a-z]\`, \`[0-9]\`, \`\\d\`, \`\\w\`, \`\\s\`
- **Quantifiers**: \`+\`, \`*\`, \`?\`, \`{n,m}\`
- **Anchors**: \`^\`, \`$\`
- **Groups**: \`(pattern)\`, \`(?:pattern)\`
- **Alternation**: \`pattern1|pattern2\`
- **Escape sequences**: \`\\.\`, \`\\[\`, \`\\]\`, \`\\(\`, \`\\)\`

**Common methods** (when used with builtin functions):
- \`match(string, regex)\` - Find matches in string
- \`replace(string, regex, replacement)\` - Replace matches
- \`test(regex, string)\` - Test if pattern matches`;
  }

  /**
   * Documentation for the flag portion of a regex literal. ucode supports exactly g, i, s
   * (verified vs ucode/lexer.c parse_regexp: is_reg_global / is_reg_icase / is_reg_newline).
   * Any other flag is rejected by the lexer.
   */
  getRegexFlagsDocumentation(flags: string): string {
    const lines: string[] = [`**Regex flags:** \`${flags}\``, ''];
    const seen = new Set<string>();
    for (const f of flags) {
      if (seen.has(f)) continue;
      seen.add(f);
      if (f === 'g') lines.push('- **`g`** - find/replace **all** matches, not just the first');
      else if (f === 'i') lines.push('- **`i`** - ignore case (match `A` and `a` alike)');
      else if (f === 's') lines.push('- **`s`** - match **line by line**');
      else lines.push(`- **\`${f}\`** - not a ucode regex flag (only \`g\`, \`i\`, \`s\` exist)`);
    }
    if (flags.includes('s')) {
      lines.push(
        '',
        '**`s` = work line by line.** Without `s`, ucode treats the whole string as one long line. With `s`:',
        '- `.` stops at a line break (it will not jump to the next line)',
        '- `^` and `$` mean the start / end of **each line**',
        '',
        'Take this two-line string:',
        '```',
        '"foo',
        'bar"',
        '```',
        '- `/^bar$/` matches nothing here. With `s`, `/^bar$/s` finds `"bar"` (now `$` means end-of-line).',
        "- `/o.b/` matches (the `.` crossed the line break). With `s`, `/o.b/s` matches nothing (the `.` can't leave its line).",
      );
    }
    return lines.join('\n');
  }

  /**
   * Extract the pattern and flags from a regex literal's lexer token value,
   * which is the raw source string (e.g. `/ab+c/i`). Greedy up to the LAST
   * slash so patterns containing escaped slashes still split correctly.
   * Returns an empty pattern for anything that isn't a `/.../flags` string.
   */
  extractPattern(regexValue: string): { pattern: string; flags?: string } {
    const m = typeof regexValue === 'string' ? regexValue.match(/^\/(.*)\/([a-z]*)$/s) : null;
    if (m) {
      const pattern = m[1] as string;
      const flags = m[2] as string;
      return flags ? { pattern, flags } : { pattern };
    }
    return { pattern: '' };
  }
}

export const regexTypeRegistry = new RegexTypeRegistry();