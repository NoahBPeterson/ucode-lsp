// Shared parsing + matching for `// ucode-lsp disable` suppression directives.
//
// Both the semantic analyzer (semantic diagnostics) and the server's parser
// path (lexer/parser diagnostics) consume this so the two suppression sites can
// never drift. Supported forms (case-sensitive, ESLint-style):
//
//   // ucode-lsp disable                 -> suppress every diagnostic on this line
//   // ucode-lsp disable UC1001          -> suppress only UC1001 on this line
//   // ucode-lsp disable UC1001 UC1006   -> suppress only those codes
//   // ucode-lsp disable-next-line       -> suppress the following code line
//   // ucode-lsp disable-next-line UC1001-> same, code-limited
//
// A same-line directive also covers a multi-line statement that STARTS on the
// comment line (unbalanced `(`/`{`); a disable-next-line directive covers the
// multi-line statement that starts on the following line. Trailing prose after
// `disable` that isn't a `UC####` token is ignored (so `// ucode-lsp disable
// with more` still suppresses everything, matching the historical behaviour).

export interface DisableDirective {
  /** 0-based line the `// ucode-lsp disable` comment sits on. */
  commentLine: number;
  /** 0-based inclusive first line the directive suppresses. */
  startLine: number;
  /** 0-based inclusive last line the directive suppresses. */
  endLine: number;
  /** Specific UC codes to suppress (upper-cased), or null for "all rules". */
  codes: Set<string> | null;
  /** Column of the `//` starting the directive on `commentLine`. */
  commentCol: number;
  /** Column just past the `disable`/`disable-next-line` keyword (for the range end). */
  markerEndCol: number;
}

// `disable-next-line` MUST come first so it wins the alternation over `disable`.
const DIRECTIVE_RE = /\/\/[ \t]*ucode-lsp[ \t]+(disable-next-line|disable)([^\n]*)/;
const CODE_RE = /\bUC\d+\b/gi;

/** Parse the target codes out of the trailing text after the keyword. Returns
 *  a Set of upper-cased codes, or null when no `UC####` token is present (meaning
 *  "all rules" — trailing prose does not narrow the directive). */
function parseCodes(rest: string): Set<string> | null {
  const codes = new Set<string>();
  let m: RegExpExecArray | null;
  CODE_RE.lastIndex = 0;
  while ((m = CODE_RE.exec(rest)) !== null) {
    codes.add(m[0].toUpperCase());
  }
  return codes.size > 0 ? codes : null;
}

/** Line index where a (possibly multi-line) statement starting at `startLine`
 *  ends, by balancing `(`/`{` opened on the first line. Mirrors the analyzer's
 *  original findStatementEnd so same-line disables keep covering multi-line calls. */
function findStatementEnd(lines: string[], startLine: number): number {
  const first = lines[startLine];
  if (!first) return startLine;
  let paren = 0;
  let brace = 0;
  for (const ch of first) {
    if (ch === '(') paren++;
    else if (ch === ')') paren--;
    else if (ch === '{') brace++;
    else if (ch === '}') brace--;
  }
  let end = startLine;
  if (paren > 0 || brace > 0) {
    for (let i = startLine + 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      for (const ch of line) {
        if (ch === '(') paren++;
        else if (ch === ')') paren--;
        else if (ch === '{') brace++;
        else if (ch === '}') brace--;
      }
      end = i;
      if (paren <= 0 && brace <= 0) break;
    }
  }
  return end;
}

/** Extract every disable directive from a document's raw text. */
export function parseDisableDirectives(text: string): DisableDirective[] {
  const lines = text.split(/\r?\n/);
  const directives: DisableDirective[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    if (!line) continue;
    const m = DIRECTIVE_RE.exec(line);
    if (!m) continue;

    const keyword = m[1]!;
    const rest = m[2] ?? '';
    const commentCol = m.index;
    const markerEndCol = commentCol + (m[0].length - rest.length);
    const codes = parseCodes(rest);

    if (keyword === 'disable-next-line') {
      const target = lineIndex + 1;
      if (target >= lines.length) {
        // Nothing follows — still record it so the "unnecessary" check can flag it.
        directives.push({ commentLine: lineIndex, startLine: target, endLine: target, codes, commentCol, markerEndCol });
      } else {
        directives.push({
          commentLine: lineIndex,
          startLine: target,
          endLine: findStatementEnd(lines, target),
          codes,
          commentCol,
          markerEndCol,
        });
      }
    } else {
      directives.push({
        commentLine: lineIndex,
        startLine: lineIndex,
        endLine: findStatementEnd(lines, lineIndex),
        codes,
        commentCol,
        markerEndCol,
      });
    }
  }

  return directives;
}

/** True when `directive` suppresses a diagnostic at 0-based `line` with the given
 *  rule `code` (may be undefined for un-coded diagnostics). A code-limited
 *  directive only matches diagnostics whose code is in its set. */
export function directiveCovers(
  directive: DisableDirective,
  line: number,
  code: string | number | undefined,
): boolean {
  if (line < directive.startLine || line > directive.endLine) return false;
  if (directive.codes === null) return true;
  if (code === undefined || code === null) return false;
  return directive.codes.has(String(code).toUpperCase());
}

/** True when ANY directive suppresses the given (line, code) diagnostic. */
export function anyDirectiveCovers(
  directives: DisableDirective[],
  line: number,
  code: string | number | undefined,
): boolean {
  return directives.some((d) => directiveCovers(d, line, code));
}
