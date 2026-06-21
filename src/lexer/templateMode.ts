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
    return /\{[%{#]/.test(text);
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
    for (const t of tokens) {
        if (FRAME_DROP.has(t.type)) continue;
        if (FRAME_TO_SEMICOLON.has(t.type)) {
            out.push({ ...t, type: TokenType.TK_SCOL, value: ';' });
            continue;
        }
        out.push(t);
    }
    return out;
}
