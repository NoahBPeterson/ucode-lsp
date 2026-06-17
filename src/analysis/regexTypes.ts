/**
 * Regex type definitions and utilities
 * Based on ucode regex literal support
 */

export class RegexTypeRegistry {
  /**
   * Get documentation for a regex pattern
   */
  getRegexDocumentation(pattern: string, flags?: string): string {
    const flagsText = flags ? ` with flags \`${flags}\`` : '';
    
    return `**Regular Expression**${flagsText}

Pattern: \`${pattern}\`

**Type:** \`regex\`

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