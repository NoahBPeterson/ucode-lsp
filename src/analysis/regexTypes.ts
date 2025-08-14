/**
 * Regex type definitions and utilities
 * Based on ucode regex literal support
 */

export interface RegexSignature {
  pattern: string;
  flags?: string;
  description: string;
}

export class RegexTypeRegistry {
  /**
   * Check if a value represents a regex literal
   */
  isRegexLiteral(value: any): boolean {
    return typeof value === 'object' && value !== null && 
           value.type === 'regexp' && typeof value.pattern === 'string';
  }

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
   * Get basic regex type information
   */
  getBasicRegexInfo(): string {
    return `**regex** - Regular expression pattern for text matching`;
  }

  /**
   * Validate regex pattern syntax (basic validation)
   */
  validatePattern(pattern: string): { valid: boolean; error?: string } {
    try {
      new RegExp(pattern);
      return { valid: true };
    } catch (error) {
      return { 
        valid: false, 
        error: error instanceof Error ? error.message : 'Invalid regex pattern'
      };
    }
  }

  /**
   * Extract pattern from regex literal node
   */
  extractPattern(regexNode: any): { pattern: string; flags?: string } {
    if (regexNode && typeof regexNode.pattern === 'string') {
      return {
        pattern: regexNode.pattern,
        flags: regexNode.flags || undefined
      };
    }
    return { pattern: '' };
  }
}

export const regexTypeRegistry = new RegexTypeRegistry();