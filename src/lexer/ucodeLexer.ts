/*
 * Main ucode lexer implementation
 * Based on the original C implementation from the ucode project
 */

import { TokenType, type Token, type LexerError, Keywords, Operators,
         isKeyword, isIdentifierStart, isIdentifierPart, isDigit,
         isHexDigit, isWhitespace, isLineBreak} from './tokenTypes';
import { UcodeErrorCode } from '../analysis/errorConstants';

export enum LexState {
    UC_LEX_IDENTIFY_BLOCK,
    UC_LEX_BLOCK_EXPRESSION_EMIT_TAG,
    UC_LEX_BLOCK_STATEMENT_EMIT_TAG,
    UC_LEX_BLOCK_COMMENT,
    UC_LEX_IDENTIFY_TOKEN,
    UC_LEX_PLACEHOLDER_START,
    UC_LEX_PLACEHOLDER_END,
    UC_LEX_EOF
}

interface ParseConfig {
    rawMode?: boolean;
    trimBlocks?: boolean;
    lstripBlocks?: boolean;
}



/** Result of decoding one `\`-escape: how many source chars it spans (including the
 *  backslash), the decoded value (passthrough recovery text when invalid), and the
 *  ucode compile-error message when the escape is invalid. */
export interface DecodedEscape {
    length: number;
    value: string;
    error?: string;
}

/**
 * Decode one `\`-escape with `pos` ON the backslash. Pure — shared by the lexer
 * (which advances its cursor by `length` and reports `error` via its side-channel)
 * and by hover (which shows the decoded character for the escape under the cursor).
 * Mirrors ucode's parse_escape (ucode/lexer.c): `\u` takes EXACTLY 4 hex digits
 * (no ES6 `\u{…}` form exists), `\x` exactly 2, octal runs 1–3 digits capped at
 * \377 — violations are "Invalid escape sequence" compile errors. Every other
 * escape decodes: \a \b \e \f \n \r \t \v, and unknown escapes pass the character
 * through (which also covers \\ \" \' \` \$). Surrogate halves from paired `\u`
 * escapes combine naturally in UTF-16 strings.
 */
export function decodeEscape(source: string, pos: number): DecodedEscape {
    let i = pos + 1; // past the backslash
    if (i >= source.length) {
        return { length: 1, value: '' }; // trailing backslash — caller ends in "Unterminated"
    }
    const escaped = source[i++]!;

    switch (escaped) {
        case 'a': return { length: 2, value: '\x07' };
        case 'b': return { length: 2, value: '\b' };
        case 'e': return { length: 2, value: '\x1b' };
        case 'f': return { length: 2, value: '\f' };
        case 'n': return { length: 2, value: '\n' };
        case 'r': return { length: 2, value: '\r' };
        case 't': return { length: 2, value: '\t' };
        case 'v': return { length: 2, value: '\v' };
        case 'u': {
            let code = 0;
            for (let n = 0; n < 4; n++) {
                if (i >= source.length || !isHexDigit(source[i]!)) {
                    return {
                        length: i - pos,
                        value: 'u', // recovery: pass through; the rest lexes as literal text
                        error: "Invalid escape sequence: '\\u' requires exactly 4 hex digits (ucode has no '\\u{…}' form)",
                    };
                }
                code = code * 16 + parseInt(source[i++]!, 16);
            }
            return { length: i - pos, value: String.fromCharCode(code) };
        }
        case 'x': {
            let code = 0;
            for (let n = 0; n < 2; n++) {
                if (i >= source.length || !isHexDigit(source[i]!)) {
                    return {
                        length: i - pos,
                        value: 'x',
                        error: "Invalid escape sequence: '\\x' requires exactly 2 hex digits",
                    };
                }
                code = code * 16 + parseInt(source[i++]!, 16);
            }
            return { length: i - pos, value: String.fromCharCode(code) };
        }
        default: {
            if (escaped >= '0' && escaped <= '7') {
                let digits = escaped;
                while (digits.length < 3 && i < source.length && source[i]! >= '0' && source[i]! <= '7') {
                    digits += source[i++]!;
                }
                const code = parseInt(digits, 8);
                if (code > 255) {
                    return {
                        length: i - pos,
                        value: digits,
                        error: `Invalid escape sequence: octal escape '\\${digits}' exceeds \\377 (255)`,
                    };
                }
                return { length: i - pos, value: String.fromCharCode(code) };
            }
            return { length: i - pos, value: escaped }; // unknown escape: the character itself (ucode's default)
        }
    }
}

export class UcodeLexer {
    private state: LexState = LexState.UC_LEX_IDENTIFY_BLOCK;
    private readonly source: string;
    private pos: number = 0;
    private line: number = 1;
    private column: number = 1;
    private noRegexp: boolean = false;
    private noKeyword: boolean = false;
    private lastOffset: number = 0;
    private buffer: string = '';
    private templates: number[] = []; // Stack of brace depth counters for template placeholders
    private eofEmitted: boolean = false; // Track if EOF has been emitted

    // Which template block we are currently lexing inside (null = template text / none).
    // ucode allows a STATEMENT block (`{%`) to run to EOF unterminated, but an
    // EXPRESSION block (`{{`) reaching EOF without `}}` is "Unterminated template block".
    private templateBlockKind: 'statement' | 'expression' | null = null;

    private rawMode: boolean = false;

    constructor(source: string, config?: ParseConfig) {
        this.source = source;

        if (config?.rawMode) {
            this.rawMode = true;
            this.state = LexState.UC_LEX_IDENTIFY_TOKEN;
        }
    }

    public comments: Token[] = [];
    // Non-fatal lexer diagnostics (e.g. unsupported regex flag) surfaced without dropping the
    // token — the consumer (server.ts / cli.ts) merges these into the document's diagnostics (#56).
    public errors: LexerError[] = [];

    public tokenize(): Token[] {
        const tokens: Token[] = [];
        let token: Token | null;

        while ((token = this.nextToken()) !== null) {
            if (token.type === TokenType.TK_EOF) {
                tokens.push(token);
                break;
            }
            if (token.type === TokenType.TK_COMMENT) {
                this.comments.push(token); // Collect comments in side-channel
            } else {
                tokens.push(token);
            }
        }

        return tokens;
    }

    public nextToken(): Token | null {
        switch (this.state) {
            case LexState.UC_LEX_IDENTIFY_BLOCK:
                return this.identifyBlock();
            case LexState.UC_LEX_BLOCK_EXPRESSION_EMIT_TAG:
                return this.blockExpressionEmitTag();
            case LexState.UC_LEX_BLOCK_STATEMENT_EMIT_TAG:
                return this.blockStatementEmitTag();
            case LexState.UC_LEX_BLOCK_COMMENT:
                return this.blockComment();
            case LexState.UC_LEX_IDENTIFY_TOKEN:
                return this.identifyToken();
            case LexState.UC_LEX_PLACEHOLDER_START:
                return this.placeholderStart();
            case LexState.UC_LEX_PLACEHOLDER_END:
                return this.placeholderEnd();
            case LexState.UC_LEX_EOF:
                if (this.eofEmitted) {
                    return null; // Don't emit EOF multiple times
                }
                this.eofEmitted = true;
                return this.emitToken(TokenType.TK_EOF);
            default:
                return null;
        }
    }

    private identifyBlock(): Token | null {
        // Consume template text character-by-character until a tag or EOF. This is a LOOP,
        // not tail self-recursion — N chars of trailing text used to mean N stack frames,
        // so a large text run overflowed the stack (auto-docs/01). (Raw mode no longer
        // enters this state at all, but template mode must not crash here either.)
        while (true) {
            if (this.pos >= this.source.length) {
                // End of input: flush any pending template text, then hand off to the
                // EOF state to emit TK_EOF. When the file ends ON a tag there is no
                // trailing text and emitBuffer returns null — DON'T return that null
                // (tokenize() stops on null, which would drop the EOF). Emit the EOF
                // token directly instead.
                const text = this.emitBuffer(TokenType.TK_TEXT);
                this.state = LexState.UC_LEX_EOF;
                return text !== null ? text : this.nextToken();
            }

            const ch = this.peekChar();

            if (ch === '{') {
                const next = this.peekChar(1);

                if (next === '{' || next === '%' || next === '#') {
                    const text = this.emitBuffer(TokenType.TK_TEXT);
                    this.state = next === '{'
                        ? LexState.UC_LEX_BLOCK_EXPRESSION_EMIT_TAG
                        : next === '%'
                            ? LexState.UC_LEX_BLOCK_STATEMENT_EMIT_TAG
                            : LexState.UC_LEX_BLOCK_COMMENT;
                    // Empty text — the file starts with a tag, or two tags abut —
                    // makes emitBuffer return null. Returning null would stop
                    // tokenize() (template files beginning with `{%` lexed to 0
                    // tokens); instead emit the tag/comment token now.
                    return text !== null ? text : this.nextToken();
                }
            }

            this.buffer += this.nextChar();
            this.updatePosition(ch);
        }
    }

    /** Consume an optional whitespace-trim OPEN modifier, matching ucode's lexer.c
     *  exactly. The modifier only controls rendered-output whitespace (irrelevant to
     *  diagnostics/types), so we discard it — but WHICH char is a modifier depends on
     *  the tag kind:
     *    - `-` is a modifier for every tag (`{%-`, `{{-`, `{#-`): strip preceding ws.
     *    - `+` is a modifier ONLY for statement tags (`{%+`): force-preserve preceding
     *      ws (overrides the lstrip_blocks config). After `{{` / `{#`, ucode does NOT
     *      treat `+` as a modifier — for `{{+ expr }}` the `+` is UNARY PLUS on the
     *      expression, so we must leave it for the tokenizer. */
    private consumeTagOpenModifier(allowPlus: boolean): void {
        const m = this.peekChar();
        if (m === '-' || (allowPlus && m === '+')) {
            this.nextChar();
        }
    }

    private blockExpressionEmitTag(): Token | null {
        this.nextChar(); // consume '{'
        this.nextChar(); // consume '{'
        this.consumeTagOpenModifier(false); // `{{+` is unary plus, not a modifier
        this.state = LexState.UC_LEX_IDENTIFY_TOKEN;
        this.templateBlockKind = 'expression';
        return this.emitToken(TokenType.TK_LEXP);
    }

    private blockStatementEmitTag(): Token | null {
        this.nextChar(); // consume '{'
        this.nextChar(); // consume '%'
        this.consumeTagOpenModifier(true); // `{%+` force-preserves whitespace
        this.state = LexState.UC_LEX_IDENTIFY_TOKEN;
        this.templateBlockKind = 'statement';
        return this.emitToken(TokenType.TK_LSTM);
    }

    private blockComment(): Token | null {
        this.nextChar(); // consume '{'
        this.nextChar(); // consume '#'

        // Skip until #}
        let closed = false;
        while (this.pos < this.source.length) {
            const ch = this.peekChar();
            if (ch === '#' && this.peekChar(1) === '}') {
                this.nextChar(); // consume '#'
                this.nextChar(); // consume '}'
                closed = true;
                break;
            }
            this.nextChar();
            this.updatePosition(ch);
        }

        // A `{# … <EOF>` comment with no `#}` is "Unterminated template block" in ucode.
        if (!closed) {
            this.state = LexState.UC_LEX_EOF;
            return this.emitToken(TokenType.TK_ERROR, 'Unterminated template block');
        }

        this.state = LexState.UC_LEX_IDENTIFY_BLOCK;
        // Continue lexing after the comment (back to template text/tags). The old
        // `return this.blockComment()` re-entered the comment scanner and consumed
        // the next two characters as a phantom `{#`.
        return this.nextToken();
    }

    private identifyToken(): Token | null {
        // Handle shebang line if it's the first line and we're at the beginning
        if (this.line === 1 && this.column === 1 && this.peekChar() === '#' && this.peekChar(1) === '!') {
            return this.parseShebang();
        }

        this.skipWhitespace();

        if (this.pos >= this.source.length) {
            this.state = LexState.UC_LEX_EOF;
            // Premature EOF inside an EXPRESSION block (`{{ … <EOF>`) is an error in
            // ucode ("Unterminated template block"). A STATEMENT block (`{% … <EOF>`)
            // running to EOF is allowed, so it falls through to a normal TK_EOF.
            if (this.templateBlockKind === 'expression') {
                this.templateBlockKind = null;
                return this.emitToken(TokenType.TK_ERROR, 'Unterminated template block');
            }
            return this.emitToken(TokenType.TK_EOF);
        }

        const ch = this.peekChar();

        // Check for block endings — ONLY in template mode. In raw mode (which every LSP
        // call site uses) a bare `}}` is just two close-braces from a nested object/array
        // literal (`{a:{b:1}}`) and `%}` is `%` then `}`. Treating them as template
        // block-end tags here flips the lexer back into template mode and swallows the
        // rest of the file — auto-docs/01: false "Expected '}'"/"Unexpected token", every
        // later diagnostic dropped, and a stack-overflow crash on large trailing text.
        if (!this.rawMode) {
            // Whitespace-trim CLOSE markers `-%}` / `-}}`. ucode strips ONLY on `-`;
            // `+` is an OPEN-only modifier, so `+%}` / `+}}` are syntax errors in every
            // release. We deliberately do NOT accept `+` here — letting the `+` fall
            // through to operator lexing so the parser raises a syntax error, matching
            // ucode (accepting what ucode rejects is a false negative, never harmless).
            // This MUST run before the `-`/`+` operator handling below, or `-%}` would
            // lex as subtraction.
            if (ch === '-'
                && this.peekChar(2) === '}'
                && (this.peekChar(1) === '%' || this.peekChar(1) === '}')) {
                const isExpression = this.peekChar(1) === '}';
                this.nextChar(); // modifier
                this.nextChar(); // '%' or '}'
                this.nextChar(); // '}'
                this.state = LexState.UC_LEX_IDENTIFY_BLOCK;
                this.templateBlockKind = null;
                return this.emitToken(isExpression ? TokenType.TK_REXP : TokenType.TK_RSTM);
            }

            if (ch === '}' && this.peekChar(1) === '}') {
                this.nextChar();
                this.nextChar();
                this.state = LexState.UC_LEX_IDENTIFY_BLOCK;
                this.templateBlockKind = null;
                return this.emitToken(TokenType.TK_REXP);
            }

            if (ch === '%' && this.peekChar(1) === '}') {
                this.nextChar();
                this.nextChar();
                this.state = LexState.UC_LEX_IDENTIFY_BLOCK;
                this.templateBlockKind = null;
                return this.emitToken(TokenType.TK_RSTM);
            }

            // Disallow nested template blocks (ucode lexer.c:
            // "Template blocks may not be nested"). In template mode, reaching
            // identifyToken means we are INSIDE a {%…%} / {{…}} block; an abutting
            // `{%` or `{{` is a nested open tag, which ucode rejects outright. Match
            // ucode's greedy tokenizer: only ADJACENT `{{` / `{%` nests — `{ {` with
            // a space is two ordinary braces (a nested object literal), and a lone
            // `{` is a normal object literal. (`{#` inside a block is a separate
            // "Unexpected character" error, handled by the default path below.)
            if (ch === '{' && (this.peekChar(1) === '{' || this.peekChar(1) === '%')) {
                const startPos = this.pos;
                this.nextChar(); // '{'
                this.nextChar(); // '{' or '%'
                return this.emitToken(TokenType.TK_ERROR, 'Template blocks may not be nested', startPos);
            }
        }

        // Template literal placeholder start
        if (ch === '$' && this.peekChar(1) === '{') {
            this.nextChar(); // consume '$'
            this.nextChar(); // consume '{'
            this.state = LexState.UC_LEX_PLACEHOLDER_START;
            // Don't emit token here - let placeholderStart() do it
            return this.nextToken();
        }

        // Numbers
        if (isDigit(ch)) {
            return this.parseNumber();
        }

        // Strings
        if (ch === '"' || ch === "'") {
            return this.parseString(ch);
        }
        
        // Template literals
        if (ch === '`') {
            return this.parseTemplateLiteral();
        }

        // Comments (must come before regex parsing)
        if (ch === '/' && this.peekChar(1) === '/') {
            return this.parseLineComment();
        }

        if (ch === '/' && this.peekChar(1) === '*') {
            return this.parseBlockComment();
        }

        // Regular expressions
        if (ch === '/' && !this.noRegexp) {
            // Look ahead to check if this looks like a valid regex start
            const next = this.peekChar(1);
            
            // Quick check: if followed immediately by newline or EOF, it's a stray slash
            if (next === '' || isLineBreak(next)) {
                const startPos = this.pos;
                this.nextChar(); // Consume the '/'
                return this.emitToken(
                    TokenType.TK_ERROR,
                    "Unexpected token '/'. Did you mean to use a comment '//'?",
                    startPos
                );
            }
            
            // Look ahead to see if this slash is followed by suspicious patterns
            const remainingCode = this.source.substring(this.pos + 1);
            
            // Pattern 1: / followed by whitespace and then /*
            const blockCommentPattern = /^\s*\/\*/;
            if (blockCommentPattern.test(remainingCode)) {
                const startPos = this.pos;
                this.nextChar(); // Consume the problematic '/'
                return this.emitToken(
                    TokenType.TK_ERROR,
                    "Unexpected token '/' before block comment. Did you mean to use a comment '//'?",
                    startPos
                );
            }
            
            // Pattern 2: / followed by whitespace and then a statement keyword
            const statementKeywords = ['export', 'import', 'function', 'let', 'const', 'if', 'while', 'for', 'return', 'break', 'continue', 'try', 'switch', 'class'];
            const keywordPattern = new RegExp(`^\\s*(${statementKeywords.join('|')})\\b`);
            const keywordMatch = remainingCode.match(keywordPattern);
            if (keywordMatch) {
                const startPos = this.pos;
                this.nextChar(); // Consume the problematic '/'
                return this.emitToken(
                    TokenType.TK_ERROR,
                    `Unexpected token '/' before '${keywordMatch[1]}'. Did you mean to use a comment '//'?`,
                    startPos
                );
            }
            
            // Pattern 3: / followed only by whitespace until end of line
            const whitespaceOnlyPattern = /^\s*$/m;
            const lineEnd = remainingCode.indexOf('\n');
            const restOfLine = lineEnd === -1 ? remainingCode : remainingCode.substring(0, lineEnd);
            if (whitespaceOnlyPattern.test(restOfLine)) {
                const startPos = this.pos;
                this.nextChar(); // Consume the problematic '/'
                return this.emitToken(
                    TokenType.TK_ERROR,
                    "Unexpected token '/'. Did you mean to use a comment '//'?",
                    startPos
                );
            }
            
            // If the lookahead passed, parse the regex as normal
            return this.parseRegex();
        }

        // Identifiers and keywords
        if (isIdentifierStart(ch)) {
            return this.parseIdentifier();
        }

        // Operators
        const operator = this.parseOperator();
        if (operator) {
            // Track braces when inside template placeholder
            if (this.templates.length > 0) {
                if (operator.type === TokenType.TK_LBRACE) {
                    // Increment brace depth for current placeholder
                    const lastIdx = this.templates.length - 1;
                    this.templates[lastIdx] = (this.templates[lastIdx] ?? 0) + 1;
                } else if (operator.type === TokenType.TK_RBRACE) {
                    // Check if we're closing the placeholder or just a nested brace
                    const lastIdx = this.templates.length - 1;
                    const braceDepth = this.templates[lastIdx] ?? 0;
                    if (braceDepth === 0) {
                        // Closing the placeholder itself
                        this.templates.pop();
                        this.state = LexState.UC_LEX_PLACEHOLDER_END;
                    } else {
                        // Just a nested brace - decrement depth
                        this.templates[lastIdx] = braceDepth - 1;
                    }
                }
            }
            return operator;
        }

        // Unknown character. Capture the start BEFORE advancing so the diagnostic range covers
        // the character itself (not the position past it), and read a full Unicode code point so
        // an astral character (a surrogate pair) is reported as one character with a correct range
        // rather than a lone-surrogate replacement glyph over a single UTF-16 unit.
        const startPos = this.pos;
        const cp = this.source.codePointAt(this.pos);
        const charStr = cp !== undefined ? String.fromCodePoint(cp) : ch;
        this.pos += charStr.length;
        return this.emitToken(TokenType.TK_ERROR, `Unexpected character: ${charStr}`, startPos);
    }

    private parseNumber(): Token | null {
        const startPos = this.pos;

        // ucode lexes a number by greedily consuming every character that could be part of a
        // numeric literal (is_numeric_char, ucode/lexer.c:577) and then handing the whole lexeme
        // to a strtoull/strtod-style parser (uc_number_parse_octal, ucode/vallist.c:49). We
        // replicate that here so the LSP agrees with the interpreter on:
        //   - hex floats:            0xFF.5 -> 255.3125, 0x1.8 -> 1.5   (C99 hex float via strtod)
        //   - leading-zero octals:   0777 -> 511, 08 -> 8
        //   - bare prefixes:         0x is an error, but 0b/0o parse to 0
        //   - invalid trailing:      0o9 / 0b2 / 123abc / 1.2.3 -> "Invalid number literal"
        //   - incomplete exponents:  1e -> "Invalid number literal"
        // All values verified against the vendored ucode binary. A malformed literal is reported
        // via the side-channel (like an invalid escape, #56) while still emitting a numeric token
        // so the argument survives and downstream arg-count checks stay intact.
        let value = this.nextChar(); // first digit (parseNumber is only entered on a digit)
        while (this.pos < this.source.length && this.isNumericChar(this.peekChar(), value)) {
            value += this.nextChar();
        }

        const parsed = this.classifyNumber(value);
        if (parsed === null || 'error' in parsed) {
            const reason = parsed && 'error' in parsed ? `: ${parsed.error}` : '';
            this.errors.push({
                message: `Invalid number literal${reason}`,
                start: startPos,
                end: this.pos,
                code: UcodeErrorCode.INVALID_NUMBER_LITERAL,
            });
            return this.emitToken(TokenType.TK_NUMBER, NaN, startPos);
        }
        return this.emitToken(
            parsed.kind === 'double' ? TokenType.TK_DOUBLE : TokenType.TK_NUMBER,
            parsed.value,
            startPos
        );
    }

    /** Mirror is_numeric_char (ucode/lexer.c:577). `prev` is the last char already in the lexeme. */
    private isNumericChar(c: string, prev: string): boolean {
        if (c >= '0' && c <= '9') return true;
        if (c === '.') return true;
        const lc = c.toLowerCase();
        if (lc === 'a' || lc === 'b' || lc === 'c' || lc === 'd' || lc === 'e'
            || lc === 'f' || lc === 'o' || lc === 'x') {
            // A number literal cannot start with these; require a preceding char.
            return prev !== '';
        }
        if (c === '+' || c === '-') {
            // A sign is only part of the number right after an exponent char.
            return prev.toLowerCase() === 'e';
        }
        return false;
    }

    private isXDigit(c: string): boolean {
        return c !== '' && ((c >= '0' && c <= '9')
            || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'));
    }

    private digitValue(c: string): number {
        if (c >= '0' && c <= '9') return c.charCodeAt(0) - 48;
        const lc = c.toLowerCase();
        if (lc >= 'a' && lc <= 'f') return lc.charCodeAt(0) - 87; // 'a' (97) -> 10
        return -1;
    }

    /**
     * Classify a fully-consumed numeric lexeme, mirroring uc_number_parse_octal /
     * uc_number_parse_common(buf, octal=true) (ucode/vallist.c:49). Returns null for a malformed
     * literal (the interpreter's TK_ERROR "Invalid number literal" case).
     */
    private classifyNumber(buf: string): { kind: 'int' | 'double'; value: number } | { error: string } | null {
        let p = 0;
        let neg = false;
        if (buf[p] === '-') { neg = true; p++; }
        else if (buf[p] === '+') { p++; }

        // if (*p != 0 && !isxdigit(*p)) return NULL;
        if (p < buf.length && !this.isXDigit(buf[p]!)) return null;

        let base = 10;
        if (buf[p] === '0') {
            const c = (buf[p + 1] ?? '').toLowerCase();
            if (c >= '0' && c <= '7') base = 8;         // octal=true: a leading zero is octal
            else if (c === 'x') base = 16;
            else if (c === 'b') { base = 2; p += 2; }
            else if (c === 'o') { base = 8; p += 2; }
        }

        const u = this.strtoull(buf, p, base);
        const stop = buf[u.end] ?? '';

        // Floating point: base >= 10 and the integer scan stopped on '.' or 'e'.
        if (base >= 10 && (stop === '.' || stop.toLowerCase() === 'e')) {
            const d = this.strtod(buf, p, base);
            if (Number.isNaN(d.value) || (stop.toLowerCase() === 'e' && d.end <= u.end + 1)) {
                return { error: `the exponent needs at least one digit after the '${stop}'` };
            }
            if (d.end !== buf.length) {
                return { error: `unexpected '${buf[d.end]}' after the number (a literal can hold only one '.' and one exponent)` };
            }
            return { kind: 'double', value: neg ? -d.value : d.value };
        }

        // Integer: any leftover character means the literal was malformed. Say WHY:
        // which character broke it and what digits the base actually allows.
        if (u.end !== buf.length) {
            const c = buf[u.end]!;
            if (base === 16 && u.end === p + 1 && (buf[p + 1] === 'x' || buf[p + 1] === 'X')) {
                return { error: `'0x' must be followed by at least one hex digit (0-9, a-f)` };
            }
            const BASE_INFO: Record<number, { name: string; digits: string }> = {
                2: { name: 'binary (0b)', digits: '0 and 1' },
                8: { name: 'octal (0o or leading 0)', digits: '0-7' },
                10: { name: 'decimal', digits: '0-9' },
                16: { name: 'hexadecimal (0x)', digits: '0-9, a-f' },
            };
            const info = BASE_INFO[base]!;
            if (/[0-9a-fA-F]/.test(c)) {
                return { error: `'${c}' is not a valid digit in a ${info.name} literal — allowed digits are ${info.digits}` };
            }
            return { error: `unexpected '${c}' in a ${info.name} literal` };
        }
        return { kind: 'int', value: neg ? -u.value : u.value };
    }

    /** strtoull(3)-style scan: returns the parsed value and the index of the first unparsed char. */
    private strtoull(buf: string, start: number, base: number): { value: number; end: number } {
        let i = start;
        if (base === 16 && buf[i] === '0' && (buf[i + 1] === 'x' || buf[i + 1] === 'X')) {
            // strtoull only consumes the "0x" prefix when a hex digit follows; otherwise it parses
            // just the leading '0' and stops at 'x' (this is why bare `0x` is an error).
            if (this.isXDigit(buf[i + 2] ?? '')) {
                i += 2;
            } else {
                return { value: 0, end: i + 1 };
            }
        }
        const digStart = i;
        let value = 0;
        while (i < buf.length) {
            const d = this.digitValue(buf[i]!);
            if (d < 0 || d >= base) break;
            value = value * base + d;
            i++;
        }
        if (i === digStart) {
            // No digits consumed. strtoull returns 0 with the end pointer at the start, e.g. the
            // stripped-prefix `0b`/`0o` lexemes (end at string terminator) parse to 0.
            return { value: 0, end: start };
        }
        return { value, end: i };
    }

    /** strtod(3)-style scan (decimal and C99 hex floats). ucode never lexes a 'p' binary exponent. */
    private strtod(buf: string, start: number, base: number): { value: number; end: number } {
        if (base === 16) {
            const m = /^0[xX]([0-9a-fA-F]*)(?:\.([0-9a-fA-F]*))?/.exec(buf.slice(start));
            if (!m) return { value: NaN, end: start };
            const intHex = m[1] ?? '';
            const fracHex = m[2] ?? '';
            let value = intHex ? parseInt(intHex, 16) : 0;
            if (fracHex) value += parseInt(fracHex, 16) / Math.pow(16, fracHex.length);
            return { value, end: start + m[0].length };
        }
        const m = /^[0-9]*(?:\.[0-9]*)?(?:[eE][+-]?[0-9]+)?/.exec(buf.slice(start));
        const text = m ? m[0] : '';
        return { value: parseFloat(text), end: start + text.length };
    }

    /**
     * Consume one `\`-escape (cursor ON the backslash) and return its decoded value.
     * Decoding lives in the pure `decodeEscape` (shared with hover, which shows the
     * decoded character); this wrapper advances the cursor and surfaces any error via
     * the side-channel (a valid token is still emitted so the AST/arg counts stay
     * intact, same as unsupported regex flags, #56).
     */
    private consumeEscape(): string {
        const escStart = this.pos;
        const d = decodeEscape(this.source, this.pos);
        this.pos += d.length;
        if (d.error) {
            this.errors.push({
                message: d.error,
                start: escStart,
                end: this.pos,
                code: UcodeErrorCode.INVALID_ESCAPE_SEQUENCE,
            });
        }
        return d.value;
    }

    private parseString(quote: string): Token | null {
        const startPos = this.pos;
        let value = '';
        
        this.nextChar(); // consume opening quote
        
        while (this.pos < this.source.length) {
            const ch = this.peekChar();
            
            if (ch === quote) {
                this.nextChar(); // consume closing quote
                return this.emitToken(TokenType.TK_STRING, value, startPos);
            }
            
            if (ch === '\\') {
                value += this.consumeEscape();
            } else {
                value += this.nextChar();
            }
        }

        return this.emitToken(TokenType.TK_ERROR, 'Unterminated string', startPos);
    }

    private parseTemplateLiteral(): Token | null {
        const startPos = this.pos;
        let value = '';

        this.nextChar(); // consume opening backtick

        while (this.pos < this.source.length) {
            const ch = this.peekChar();

            // End of template literal
            if (ch === '`') {
                this.nextChar(); // consume closing backtick
                return this.emitToken(TokenType.TK_TEMPLATE, value, startPos);
            }

            // Handle escape sequences
            if (ch === '\\') {
                value += this.consumeEscape();
            }
            // Handle template interpolations ${...}
            else if (ch === '$' && this.peekChar(1) === '{') {
                // Emit the template part before the placeholder
                // DO NOT consume the ${, let identifyToken() handle it
                return this.emitToken(TokenType.TK_TEMPLATE, value, startPos);
            }
            else {
                value += this.nextChar();
            }
        }

        return this.emitToken(TokenType.TK_ERROR, 'Unterminated template literal', startPos);
    }

    private parseRegex(): Token | null {
        const startPos = this.pos;
        let value = '';
        let inCharClass = false;

        this.nextChar(); // consume opening /
        value += '/';
        const bodyStart = this.pos;

        while (this.pos < this.source.length) {
            const ch = this.peekChar();

            if (ch === '/' && !inCharClass) {
                const bodyEnd = this.pos;
                value += this.nextChar(); // consume closing /

                // Handle regex flags (ucode supports: g, i, s). An unsupported flag is a real
                // error, but we must NOT drop the regex token — doing so deletes the argument from
                // the enclosing call, cascading into spurious arg-count errors (e.g. printf "1
                // specifier but 0 arguments", match "expects at least 2 arguments") (#56). So we
                // consume every trailing flag, record each unsupported one in the side-channel,
                // and still emit a valid TK_REGEXP so the argument survives.
                const supportedFlags = new Set(['g', 'i', 's']);
                while (this.pos < this.source.length && /[a-zA-Z]/.test(this.peekChar())) {
                    const flag = this.peekChar();
                    const flagPos = this.pos;
                    value += this.nextChar(); // consume the flag regardless of validity
                    if (!supportedFlags.has(flag)) {
                        this.errors.push({
                            message: `Unsupported regex flag '${flag}'. Supported flags are: g, i, s`,
                            start: flagPos,
                            end: this.pos,
                            code: UcodeErrorCode.SYNTAX_ERROR,
                        });
                    }
                }

                this.validateRegexBody(this.source.slice(bodyStart, bodyEnd), bodyStart);

                return this.emitToken(TokenType.TK_REGEXP, value, startPos);
            }

            // Check for unescaped newline - this indicates a stray slash, not a regex
            if (isLineBreak(ch)) {
                // Reset position to just after the initial slash
                this.pos = startPos + 1;
                return this.emitToken(TokenType.TK_ERROR, "Unexpected token '/'. Did you mean to use a comment '//'?", startPos);
            }

            if (ch === '\\') {
                value += this.nextChar(); // consume backslash
                if (this.pos < this.source.length) {
                    value += this.nextChar(); // consume escaped character
                }
            } else {
                // Track character class brackets
                if (ch === '[' && !inCharClass) {
                    inCharClass = true;
                } else if (ch === ']' && inCharClass) {
                    inCharClass = false;
                }
                value += this.nextChar();
            }
        }

        return this.emitToken(TokenType.TK_ERROR, 'Unterminated regex', startPos);
    }

    private isRegexRangeAtom(c: string): boolean {
        return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9');
    }

    /**
     * Conservatively validate a regex literal body. ucode compiles patterns with POSIX ERE
     * (regcomp) at runtime, so a broken pattern is a real error — but POSIX ERE and JS RegExp
     * diverge on many constructs (`[[:alpha:]]`, `\d`, an unmatched `)` which glibc treats as a
     * literal, ...). To avoid false positives we flag ONLY constructs that are definitely invalid
     * in BOTH engines: an unclosed group, and a character range whose endpoints are out of order.
     */
    private validateRegexBody(body: string, bodyStart: number): void {
        let parenDepth = 0;
        let inClass = false;
        let classLen = 0; // body chars seen in the current class (a leading '^' is not counted)
        for (let i = 0; i < body.length; i++) {
            const ch = body[i]!;
            if (ch === '\\') { i++; continue; } // escaped char: skip it and its operand
            if (inClass) {
                if (ch === '^' && classLen === 0) { continue; }       // negation marker
                if (ch === ']' && classLen > 0) { inClass = false; continue; } // ']' first is literal
                if (ch === '-' && classLen > 0 && i + 1 < body.length) {
                    const a = body[i - 1]!;
                    const b = body[i + 1]!;
                    const aEscaped = i >= 2 && body[i - 2] === '\\';
                    if (!aEscaped && this.isRegexRangeAtom(a) && this.isRegexRangeAtom(b)
                        && a.charCodeAt(0) > b.charCodeAt(0)) {
                        this.errors.push({
                            message: 'Invalid character range in regular expression: range endpoints are out of order',
                            start: bodyStart,
                            end: bodyStart + body.length,
                            code: UcodeErrorCode.SYNTAX_ERROR,
                        });
                        return;
                    }
                }
                classLen++;
                continue;
            }
            if (ch === '[') { inClass = true; classLen = 0; continue; }
            if (ch === '(') parenDepth++;
            else if (ch === ')' && parenDepth > 0) parenDepth--;
        }
        if (parenDepth > 0) {
            this.errors.push({
                message: 'Unbalanced parenthesis in regular expression',
                start: bodyStart,
                end: bodyStart + body.length,
                code: UcodeErrorCode.SYNTAX_ERROR,
            });
        }
    }

    private parseLineComment(): Token | null {
        const startPos = this.pos;
        let value = '';
        
        this.nextChar(); // consume first /
        this.nextChar(); // consume second /
        
        while (this.pos < this.source.length && !isLineBreak(this.peekChar())) {
            value += this.nextChar();
        }
        
        return this.emitToken(TokenType.TK_COMMENT, value, startPos);
    }

    private parseBlockComment(): Token | null {
        const startPos = this.pos;
        let value = '';

        this.nextChar(); // consume opening '/'
        this.nextChar(); // consume opening '*'

        // ucode's parse_comment (ucode/lexer.c:177) reads the opening '*' inside its scan loop,
        // where it may immediately double as the closing '*' of a '*/'. As a result ucode treats
        // `/*/` as a complete (empty) block comment, not an unterminated one (verified against
        // the vendored ucode binary: `let x = /*/;` reports "Expecting expression" at the `;`).
        // Token `value` must stay "everything after /*" (a leading '*' marks a JSDoc comment for
        // findLeadingJsDoc), so keep the up-front consume and special-case the immediate closer.
        if (this.peekChar() === '/') {
            this.nextChar(); // the opening '*' doubles as the closer: empty comment
            // Almost always an attempted regex matching '*'. Legal (the interpreter
            // accepts it silently), so warning severity — with a quick fix (server.ts)
            // that escapes the star.
            this.errors.push({
                message: "'/*/' is a complete EMPTY comment in ucode, not a regex matching '*'. To match a literal '*', escape it: /\\*/",
                start: startPos,
                end: this.pos,
                code: UcodeErrorCode.SUSPICIOUS_EMPTY_COMMENT,
                severity: 'warning',
            });
            return this.emitToken(TokenType.TK_COMMENT, value, startPos);
        }
        while (this.pos < this.source.length) {
            const ch = this.nextChar();
            this.updatePosition(ch);
            if (ch === '*' && this.peekChar() === '/') {
                this.nextChar(); // consume closing '/'
                return this.emitToken(TokenType.TK_COMMENT, value, startPos);
            }
            value += ch;
        }

        return this.emitToken(TokenType.TK_ERROR, 'Unterminated comment', startPos);
    }

    private parseShebang(): Token | null {
        const startPos = this.pos;
        
        // Skip to the end of the line
        while (this.pos < this.source.length && !isLineBreak(this.peekChar())) {
            this.nextChar();
        }
        
        // Skip the line break if present
        if (this.pos < this.source.length && isLineBreak(this.peekChar())) {
            this.updatePosition(this.nextChar());
        }
        
        // Return a comment token (which will be filtered out by default)
        return this.emitToken(TokenType.TK_COMMENT, 'shebang', startPos);
    }

    private parseIdentifier(): Token | null {
        const startPos = this.pos;
        let value = '';
        
        while (this.pos < this.source.length && isIdentifierPart(this.peekChar())) {
            value += this.nextChar();
        }
        
        // Check if it's a keyword
        if (!this.noKeyword && isKeyword(value)) {
            const keywordType = Keywords[value];
            if (keywordType) {
                return this.emitToken(keywordType, value, startPos);
            }
        }
        
        return this.emitToken(TokenType.TK_LABEL, value, startPos);
    }

    private parseOperator(): Token | null {
        const startPos = this.pos;
        
        // Try to match longer operators first
        for (let len = 3; len >= 1; len--) {
            const substr = this.source.substring(this.pos, this.pos + len);
            if (substr in Operators) {
                const operatorType = Operators[substr];
                // In raw mode the template delimiters `{{`/`}}`/`{%`/`%}` are NOT operators —
                // they're ordinary brace/percent runs (a nested object literal `{a:{b:1}}`,
                // or `%` then `}`). Skip them here so the single-char fallback tokenizes
                // `}}` as two `}`, etc. Matching `}}` as one TK_REXP token is what fed the
                // parser garbage and flipped the lexer into template mode (auto-docs/01).
                if (this.rawMode && (operatorType === TokenType.TK_LEXP || operatorType === TokenType.TK_REXP
                    || operatorType === TokenType.TK_LSTM || operatorType === TokenType.TK_RSTM)) {
                    continue;
                }
                for (let i = 0; i < len; i++) {
                    this.nextChar();
                }
                if (operatorType) {
                    return this.emitToken(operatorType, substr, startPos);
                }
            }
        }
        
        return null;
    }

    private placeholderStart(): Token | null {
        this.state = LexState.UC_LEX_IDENTIFY_TOKEN;

        // Push 0 onto templates stack to start tracking brace depth for this placeholder
        this.templates.push(0);

        const startPos = this.pos - 2; // We already consumed ${
        return {
            type: TokenType.TK_PLACEH,
            pos: startPos,
            end: this.pos,
            value: '${',
            line: this.line,
            column: this.column
        };
    }

    private placeholderEnd(): Token | null {
        // Continue parsing template literal from current position
        // The C implementation calls parse_string(lex, '`') here
        this.state = LexState.UC_LEX_IDENTIFY_TOKEN;

        return this.continueTemplateLiteral();
    }

    private continueTemplateLiteral(): Token | null {
        const startPos = this.pos;
        let value = '';

        while (this.pos < this.source.length) {
            const ch = this.peekChar();

            // End of template literal
            if (ch === '`') {
                this.nextChar(); // consume closing backtick
                this.state = LexState.UC_LEX_IDENTIFY_TOKEN; // Reset state after template ends
                return this.emitToken(TokenType.TK_TEMPLATE, value, startPos);
            }

            // Handle escape sequences
            if (ch === '\\') {
                value += this.consumeEscape();
            }
            // Handle template interpolations ${...}
            else if (ch === '$' && this.peekChar(1) === '{') {
                // Emit the template part before the placeholder
                // DO NOT consume the ${, let identifyToken() handle it
                return this.emitToken(TokenType.TK_TEMPLATE, value, startPos);
            }
            else {
                value += this.nextChar();
            }
        }

        return this.emitToken(TokenType.TK_ERROR, 'Unterminated template literal', startPos);
    }

    private skipWhitespace(): void {
        while (this.pos < this.source.length && isWhitespace(this.peekChar())) {
            const ch = this.nextChar();
            this.updatePosition(ch);
        }
    }

    private peekChar(offset: number = 0): string {
        const idx = this.pos + offset;
        return idx < this.source.length ? (this.source[idx] || '') : '';
    }

    private nextChar(): string {
        if (this.pos >= this.source.length) {
            return '';
        }
        
        return this.source[this.pos++] || '';
    }

    private updatePosition(ch: string): void {
        if (isLineBreak(ch)) {
            this.line++;
            this.column = 1;
        } else {
            this.column++;
        }
    }


    private emitToken(type: TokenType, value?: string | number, pos?: number): Token {
        const startPos = pos ?? this.pos;
        const endPos = this.pos;
        
        // Update noRegexp flag based on the token type
        this.updateNoRegexpFlag(type);
        
        // Update noKeyword flag based on the token type
        this.updateNoKeywordFlag(type);
        
        return {
            type,
            // `??`, not `||`: a numeric 0 token value (any zero literal, incl. bare 0b/0o)
            // must survive — `||` collapsed it to '' and hover lost the decimal value.
            value: value ?? '',
            pos: startPos,
            end: endPos,
            line: this.line,
            column: this.column
        };
    }

    private updateNoRegexpFlag(tokenType: TokenType): void {
        // After these tokens, a regex is not expected (division is more likely)
        if (tokenType === TokenType.TK_LABEL ||          // identifier
            tokenType === TokenType.TK_NUMBER ||         // number
            tokenType === TokenType.TK_DOUBLE ||         // double
            tokenType === TokenType.TK_STRING ||         // string
            tokenType === TokenType.TK_RPAREN ||         // )
            tokenType === TokenType.TK_RBRACK ||         // ]
            tokenType === TokenType.TK_RBRACE ||         // }
            tokenType === TokenType.TK_TRUE ||           // true
            tokenType === TokenType.TK_FALSE ||          // false
            tokenType === TokenType.TK_NULL ||           // null
            tokenType === TokenType.TK_THIS ||           // this
            tokenType === TokenType.TK_INC ||            // ++
            tokenType === TokenType.TK_DEC) {            // --
            this.noRegexp = true;
        }
        // After these tokens, a regex is expected (not division)
        else if (tokenType === TokenType.TK_LPAREN ||    // (
                 tokenType === TokenType.TK_LBRACK ||    // [
                 tokenType === TokenType.TK_COMMA ||     // ,
                 tokenType === TokenType.TK_ASSIGN ||    // =
                 tokenType === TokenType.TK_EQ ||        // ==
                 tokenType === TokenType.TK_NE ||        // !=
                 tokenType === TokenType.TK_LT ||        // <
                 tokenType === TokenType.TK_LE ||        // <=
                 tokenType === TokenType.TK_GT ||        // >
                 tokenType === TokenType.TK_GE ||        // >=
                 tokenType === TokenType.TK_AND ||       // &&
                 tokenType === TokenType.TK_OR ||        // ||
                 tokenType === TokenType.TK_NOT ||       // !
                 tokenType === TokenType.TK_BAND ||      // &
                 tokenType === TokenType.TK_BOR ||       // |
                 tokenType === TokenType.TK_BXOR ||      // ^
                 tokenType === TokenType.TK_ADD ||       // +
                 tokenType === TokenType.TK_SUB ||       // -
                 tokenType === TokenType.TK_MUL ||       // *
                 tokenType === TokenType.TK_MOD ||       // %
                 tokenType === TokenType.TK_RETURN ||    // return
                 tokenType === TokenType.TK_IF ||        // if
                 tokenType === TokenType.TK_WHILE ||     // while
                 tokenType === TokenType.TK_FOR ||       // for
                 tokenType === TokenType.TK_CASE ||      // case
                 tokenType === TokenType.TK_COLON ||     // :
                 tokenType === TokenType.TK_QMARK) {     // ?
            this.noRegexp = false;
        }
        // Special handling for { and ; - regex is less likely but still possible
        else if (tokenType === TokenType.TK_LBRACE ||    // {
                 tokenType === TokenType.TK_SCOL) {      // ;
            this.noRegexp = false; // Allow regex but lookahead will catch stray slashes
        }
        // For other tokens, don't change the flag
    }

    private updateNoKeywordFlag(tokenType: TokenType): void {
        // After TK_DOT or TK_QDOT, the next identifier is a property name and must be treated
        // as TK_LABEL — so a reserved word like `const`/`if` can be a member name (valid ucode:
        // `o.const`, `o?.const`). TK_QDOT was missing, so `o?.const` lexed `const` as a keyword
        // and the parser rejected it ("Expected property name after '?.'"). (#20 follow-up)
        if (tokenType === TokenType.TK_DOT || tokenType === TokenType.TK_QDOT) {
            this.noKeyword = true;
        }
        // Reset flag after consuming one identifier following a dot
        else if (tokenType === TokenType.TK_LABEL && this.noKeyword) {
            this.noKeyword = false;
        }
        // Reset flag if we encounter any non-identifier token while expecting member access
        // This handles cases like "a.;" where the dot is not followed by an identifier
        else if (this.noKeyword && tokenType !== TokenType.TK_LABEL) {
            this.noKeyword = false;
        }
    }

    private emitBuffer(type: TokenType, stripTrailingChars?: string): Token | null {
        if (this.buffer.length === 0 && type === TokenType.TK_TEXT) {
            return null;
        }

        let content = this.buffer;
        
        if (stripTrailingChars) {
            while (content.length > 0 && stripTrailingChars.includes(content[content.length - 1] || '')) {
                content = content.slice(0, -1);
            }
        }

        const token = this.emitToken(type, content || '', this.lastOffset);
        this.buffer = '';
        return token;
    }

}