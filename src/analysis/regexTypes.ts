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