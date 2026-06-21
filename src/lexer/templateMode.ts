/*
 * Template-mode detection + token bridging for ucode template files
 * (`{% statements %}`, `{{ expression }}`, `{# comment #}`).
 *
 * ucode decides raw-vs-template by INVOCATION (see ucode/main.c): the `utpl`
 * binary or `-T` flag selects template; the `ucode` binary or `-R` flag selects
 * raw (the default). The LSP can't see the invocation, so it replicates the
 * decision from what the file itself carries.
 */

import { Token, TokenType } from './tokenTypes';

/**
 * Decide whether `text` should be lexed/parsed as a ucode template.
 *
 * 1. Shebang, if present, mirrors ucode's CLI: `utpl` or `-T` ⇒ template; `-R` ⇒ raw.
 * 2. Otherwise, a template tag (`{%` / `{{` / `{#`) ⇒ template. This is sound rather
 *    than a guess: those byte pairs are not valid raw ucode (`{%` would be "open block,
 *    then modulo" — a syntax error), so their presence means the file is a template.
 *    It is also the only signal the no-shebang OpenWrt template corpus carries.
 */
export function detectTemplateMode(text: string): boolean {
    const shebang = /^#![^\n]*/.exec(text)?.[0];
    if (shebang) {
        if (/\butpl\b/.test(shebang) || /-\w*T/.test(shebang)) return true;
        if (/-\w*R/.test(shebang)) return false;
    }
    // A template tag (`{%` / `{{` / `{#`) marks a template — but ONLY when it's real syntax,
    // not text inside a string or comment. A raw script like `let t = "Hello {{name}}"` or
    // `// see {{x}}` must NOT be misread as a template. Strip strings/comments first, then look
    // for a tag. (Mode is truly invocation-determined in ucode; this is the best file-only signal.)
    return /\{[%{#]/.test(stripStringsAndComments(text));
}

/** Blank out string literals (", ', `) and comments (// …, /* … *​/) so a template-tag scan
 *  doesn't trip on tag-looking text inside them. Length-preserving (replaces with spaces) so
 *  the result is cheap and offset-stable. Not a full lexer — a deliberately simple pre-filter. */
function stripStringsAndComments(text: string): string {
    let out = '';
    let i = 0;
    const n = text.length;
    while (i < n) {
        const c = text[i];
        const c2 = text[i + 1];
        if (c === '/' && c2 === '/') { // line comment
            while (i < n && text[i] !== '\n') { out += ' '; i++; }
            continue;
        }
        if (c === '/' && c2 === '*') { // block comment
            out += '  '; i += 2;
            while (i < n && !(text[i] === '*' && text[i + 1] === '/')) { out += text[i] === '\n' ? '\n' : ' '; i++; }
            if (i < n) { out += '  '; i += 2; }
            continue;
        }
        if (c === '"' || c === "'" || c === '`') { // string literal
            const quote = c;
            out += ' '; i++;
            while (i < n && text[i] !== quote) {
                if (text[i] === '\\') { out += '  '; i += 2; continue; }
                out += text[i] === '\n' ? '\n' : ' '; i++;
            }
            if (i < n) { out += ' '; i++; }
            continue;
        }
        out += c; i++;
    }
    return out;
}

// Template framing that carries no executable code:
//   text outside tags + the `{%` opener — dropped.
const FRAME_DROP = new Set<TokenType>([TokenType.TK_TEXT, TokenType.TK_LSTM]);
// Tag boundaries that delimit statements:
//   each tag CLOSE (`%}` / `}}`) and each interpolation OPEN (`{{`).
const FRAME_TO_SEMICOLON = new Set<TokenType>([
    TokenType.TK_RSTM,
    TokenType.TK_REXP,
    TokenType.TK_LEXP,
]);

/**
 * Rewrite a TEMPLATE-mode token stream into one the ordinary statement parser accepts.
 *
 * ucode compiles a template as: literal text → `print("…")`, `{{ expr }}` → `print(expr)`,
 * `{% stmts %}` → those statements. For the LSP we don't need the `print` wrapper — we
 * only need correct STATEMENT BOUNDARIES so the code inside tags type-checks and the
 * literal output text is ignored. So:
 *   - drop `TK_TEXT` (literal output — never ucode) and the `{%` opener;
 *   - turn every tag close (`%}` / `}}`) and every `{{` into a `;` separator.
 *
 * Result: `{{a}}{{b}}` → `a; b;` (two expression statements, not the invalid `a b`), and
 * `{% if (x): %}…{% endif %}` → `if (x): … endif` (the alt-colon block the parser handles).
 * Original token offsets are preserved, so diagnostics still point at the right source.
 */
export function bridgeTemplateTokens(tokens: Token[]): Token[] {
    const out: Token[] = [];
    let prev: Token | undefined;
    for (const t of tokens) {
        // An expression tag with NO expression (`{{ }}`) is a syntax error in ucode
        // ("Expecting expression"). A statement block MAY be empty (`{% %}` is fine), so
        // only the expression case is flagged: the `{{` opener (TK_LEXP) immediately
        // followed by the `}}` closer (TK_REXP), with nothing between.
        if (t.type === TokenType.TK_REXP && prev?.type === TokenType.TK_LEXP) {
            out.push({ ...t, type: TokenType.TK_ERROR, value: 'Expecting expression' });
            prev = t;
            continue;
        }
        prev = t;
        if (FRAME_DROP.has(t.type)) continue;
        if (FRAME_TO_SEMICOLON.has(t.type)) {
            out.push({ ...t, type: TokenType.TK_SCOL, value: ';' });
            continue;
        }
        out.push(t);
    }
    return out;
}
