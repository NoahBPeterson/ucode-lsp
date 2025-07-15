/*
 * TypeScript implementation of the ucode lexer
 * Based on the original C implementation from the ucode project
 */

export enum TokenType {
    TK_LEXP = 1,      // '{{'
    TK_REXP,          // '}}'
    TK_LSTM,          // '{%'
    TK_RSTM,          // '%}'
    TK_IF,            // 'if'
    TK_ELSE,          // 'else'
    TK_COMMA,         // ','
    TK_ASSIGN,        // '='
    TK_ASADD,         // '+='
    TK_ASSUB,         // '-='
    TK_ASMUL,         // '*='
    TK_ASDIV,         // '/='
    TK_ASMOD,         // '%='
    TK_ASLEFT,        // '<<='
    TK_ASRIGHT,       // '>>='
    TK_ASBAND,        // '&='
    TK_ASBXOR,        // '^='
    TK_ASBOR,         // '|='
    TK_QMARK,         // '?'
    TK_COLON,         // ':'
    TK_OR,            // '||'
    TK_AND,           // '&&'
    TK_BOR,           // '|'
    TK_BXOR,          // '^'
    TK_BAND,          // '&'
    TK_EQS,           // '==='
    TK_NES,           // '!=='
    TK_EQ,            // '=='
    TK_NE,            // '!='
    TK_LT,            // '<'
    TK_LE,            // '<='
    TK_GT,            // '>'
    TK_GE,            // '>='
    TK_IN,            // 'in'
    TK_LSHIFT,        // '<<'
    TK_RSHIFT,        // '>>'
    TK_ADD,           // '+'
    TK_SUB,           // '-'
    TK_MUL,           // '*'
    TK_DIV,           // '/'
    TK_MOD,           // '%'
    TK_EXP,           // '**'
    TK_NOT,           // '!'
    TK_COMPL,         // '~'
    TK_INC,           // '++'
    TK_DEC,           // '--'
    TK_DOT,           // '.'
    TK_LBRACK,        // '['
    TK_RBRACK,        // ']'
    TK_LPAREN,        // '('
    TK_RPAREN,        // ')'
    TK_TEXT,          // Text content
    TK_LBRACE,        // '{'
    TK_RBRACE,        // '}'
    TK_SCOL,          // ';'
    TK_ENDIF,         // 'endif'
    TK_ELIF,          // 'elif'
    TK_WHILE,         // 'while'
    TK_ENDWHILE,      // 'endwhile'
    TK_FOR,           // 'for'
    TK_ENDFOR,        // 'endfor'
    TK_FUNC,          // 'function'
    TK_LABEL,         // Identifier
    TK_ENDFUNC,       // 'endfunction'
    TK_TRY,           // 'try'
    TK_CATCH,         // 'catch'
    TK_SWITCH,        // 'switch'
    TK_CASE,          // 'case'
    TK_DEFAULT,       // 'default'
    TK_ELLIP,         // '...'
    TK_RETURN,        // 'return'
    TK_BREAK,         // 'break'
    TK_CONTINUE,      // 'continue'
    TK_LOCAL,         // 'let'
    TK_ARROW,         // '=>'
    TK_TRUE,          // 'true'
    TK_FALSE,         // 'false'
    TK_NUMBER,        // Integer literal
    TK_DOUBLE,        // Float literal
    TK_STRING,        // String literal
    TK_REGEXP,        // Regular expression
    TK_NULL,          // 'null'
    TK_THIS,          // 'this'
    TK_DELETE,        // 'delete'
    TK_CONST,         // 'const'
    TK_QLBRACK,       // '?.['
    TK_QLPAREN,       // '?.('
    TK_QDOT,          // '?.'
    TK_ASEXP,         // '**='
    TK_ASAND,         // '&&='
    TK_ASOR,          // '||='
    TK_ASNULLISH,     // '??='
    TK_NULLISH,       // '??'
    TK_PLACEH,        // '${'
    TK_TEMPLATE,      // Template literal
    TK_IMPORT,        // 'import'
    TK_EXPORT,        // 'export'
    TK_EOF,           // End of file
    TK_COMMENT,       // Comment
    TK_ERROR          // Error token
}

export interface Token {
    type: TokenType;
    value?: string | number | undefined;
    pos: number;
    end: number;
}

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

// enum Modifier {
//     UNSPEC,
//     PLUS,
//     MINUS,
//     NEWLINE
// }

// enum BlockType {
//     NONE,
//     EXPRESSION = '{'.charCodeAt(0),
//     STATEMENTS = '%'.charCodeAt(0),
//     COMMENT = '#'.charCodeAt(0)
// }

interface ParseConfig {
    rawMode?: boolean;
    trimBlocks?: boolean;
    lstripBlocks?: boolean;
}

interface Keyword {
    type: TokenType;
    pattern: string;
    length: number;
}

const RESERVED_WORDS: Keyword[] = [
    { type: TokenType.TK_ENDFUNC, pattern: "endfunction", length: 11 },
    { type: TokenType.TK_CONTINUE, pattern: "continue", length: 8 },
    { type: TokenType.TK_ENDWHILE, pattern: "endwhile", length: 8 },
    { type: TokenType.TK_FUNC, pattern: "function", length: 8 },
    { type: TokenType.TK_DEFAULT, pattern: "default", length: 7 },
    { type: TokenType.TK_DELETE, pattern: "delete", length: 6 },
    { type: TokenType.TK_RETURN, pattern: "return", length: 6 },
    { type: TokenType.TK_ENDFOR, pattern: "endfor", length: 6 },
    { type: TokenType.TK_SWITCH, pattern: "switch", length: 6 },
    { type: TokenType.TK_IMPORT, pattern: "import", length: 6 },
    { type: TokenType.TK_EXPORT, pattern: "export", length: 6 },
    { type: TokenType.TK_ENDIF, pattern: "endif", length: 5 },
    { type: TokenType.TK_WHILE, pattern: "while", length: 5 },
    { type: TokenType.TK_BREAK, pattern: "break", length: 5 },
    { type: TokenType.TK_CATCH, pattern: "catch", length: 5 },
    { type: TokenType.TK_CONST, pattern: "const", length: 5 },
    { type: TokenType.TK_FALSE, pattern: "false", length: 5 },
    { type: TokenType.TK_TRUE, pattern: "true", length: 4 },
    { type: TokenType.TK_ELIF, pattern: "elif", length: 4 },
    { type: TokenType.TK_ELSE, pattern: "else", length: 4 },
    { type: TokenType.TK_THIS, pattern: "this", length: 4 },
    { type: TokenType.TK_NULL, pattern: "null", length: 4 },
    { type: TokenType.TK_CASE, pattern: "case", length: 4 },
    { type: TokenType.TK_TRY, pattern: "try", length: 3 },
    { type: TokenType.TK_FOR, pattern: "for", length: 3 },
    { type: TokenType.TK_LOCAL, pattern: "let", length: 3 },
    { type: TokenType.TK_IF, pattern: "if", length: 2 },
    { type: TokenType.TK_IN, pattern: "in", length: 2 },
];

export class UcodeLexer {
    private state: LexState = LexState.UC_LEX_IDENTIFY_BLOCK;
    private config: ParseConfig | undefined;
    private readonly source: string;
    private pos: number = 0;
    private noRegexp: boolean = false;
    private noKeyword: boolean = false;
    private leadSurrogate: number = 0;
    private lastOffset: number = 0;
    private buffer: string = '';

    constructor(source: string, config?: ParseConfig) {
        this.source = source;
        this.config = config;
        
        if (config?.rawMode) {
            this.state = LexState.UC_LEX_IDENTIFY_TOKEN;
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

    private checkChar(expected: string): boolean {
        if (this.peekChar() === expected) {
            this.nextChar();
            return true;
        }
        return false;
    }

    private emitToken(type: TokenType, value?: string | number, pos?: number): Token {
        const startPos = pos ?? this.pos;
        const endPos = this.pos;
        
        // Ensure end position is at least startPos + token length
        const tokenLength = value ? String(value).length : 1;
        const adjustedEndPos = Math.max(endPos, startPos + tokenLength);
        
        return {
            type,
            value,
            pos: startPos,
            end: adjustedEndPos
        };
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

    private isAlpha(ch: string): boolean {
        return /[a-zA-Z_]/.test(ch);
    }

    private isAlnum(ch: string): boolean {
        return /[a-zA-Z0-9_]/.test(ch);
    }

    private isDigit(ch: string): boolean {
        return /[0-9]/.test(ch);
    }

    private isXDigit(ch: string): boolean {
        return /[0-9a-fA-F]/.test(ch);
    }

    private isSpace(ch: string): boolean {
        return /\s/.test(ch);
    }

    private hexValue(ch: string): number {
        if (ch >= 'a' && ch <= 'f') return 10 + ch.charCodeAt(0) - 'a'.charCodeAt(0);
        if (ch >= 'A' && ch <= 'F') return 10 + ch.charCodeAt(0) - 'A'.charCodeAt(0);
        return ch.charCodeAt(0) - '0'.charCodeAt(0);
    }

    private appendUtf8(code: number): void {
        try {
            this.buffer += String.fromCodePoint(code);
        } catch {
            this.buffer += '\uFFFD'; // Replacement character
        }
    }

    private parseEscape(regexMacros: string = ''): Token | null {
        if (this.checkChar('u')) {
            let code = 0;
            for (let i = 0; i < 4; i++) {
                const ch = this.nextChar();
                if (!this.isXDigit(ch)) {
                    return this.emitToken(TokenType.TK_ERROR, "Invalid escape sequence");
                }
                code = code * 16 + this.hexValue(ch);
            }

            if ((code & 0xFC00) === 0xD800) {
                if (this.leadSurrogate) {
                    this.appendUtf8(0xFFFD);
                }
                this.leadSurrogate = code;
            } else if ((code & 0xFC00) === 0xDC00) {
                if (this.leadSurrogate) {
                    code = 0x10000 + ((this.leadSurrogate & 0x3FF) << 10) + (code & 0x3FF);
                    this.leadSurrogate = 0;
                } else {
                    code = 0xFFFD;
                }
                this.appendUtf8(code);
            } else {
                this.appendUtf8(code);
            }
        } else if (this.checkChar('x')) {
            let code = 0;
            for (let i = 0; i < 2; i++) {
                const ch = this.nextChar();
                if (!this.isXDigit(ch)) {
                    return this.emitToken(TokenType.TK_ERROR, "Invalid escape sequence");
                }
                code = code * 16 + this.hexValue(ch);
            }
            this.appendUtf8(code);
        } else {
            let code = 0;
            let count = 0;
            
            for (let i = 0; i < 3 && this.peekChar() >= '0' && this.peekChar() <= '7'; i++) {
                const ch = this.nextChar();
                code = code * 8 + (ch.charCodeAt(0) - '0'.charCodeAt(0));
                count++;
            }

            if (count > 0) {
                if (code > 255) {
                    return this.emitToken(TokenType.TK_ERROR, "Invalid escape sequence");
                }
                this.appendUtf8(code);
            } else {
                const ch = this.peekChar();
                if (regexMacros.includes(ch)) {
                    this.nextChar();
                    const macros: Record<string, string> = {
                        'd': '[[:digit:]]',
                        'D': '[^[:digit:]]',
                        'w': '[[:alnum:]_]',
                        'W': '[^[:alnum:]_]',
                        's': '[[:space:]]',
                        'S': '[^[:space:]]'
                    };
                    
                    if (macros[ch]) {
                        this.buffer += macros[ch];
                    } else {
                        this.buffer += '\\' + ch;
                    }
                } else {
                    const escapeChar = this.nextChar();
                    const escapes: Record<string, string> = {
                        'a': '\u0007',
                        'b': '\u0008',
                        'e': '\u001B',
                        'f': '\u000C',
                        'n': '\u000A',
                        'r': '\u000D',
                        't': '\u0009',
                        'v': '\u000B'
                    };

                    if (escapeChar === '') {
                        return this.emitToken(TokenType.TK_ERROR, "Unterminated string");
                    }

                    this.buffer += escapes[escapeChar] || escapeChar;
                }
            }
        }

        return null;
    }

    private parseString(delimiter: string): Token {
        let type: TokenType;
        const startPos = this.pos - 1; // Start position (we've already consumed the opening delimiter)

        if (delimiter === '`') {
            type = TokenType.TK_TEMPLATE;
        } else if (delimiter === '/') {
            type = TokenType.TK_REGEXP;
        } else {
            type = TokenType.TK_STRING;
        }

        while (true) {
            const ch = this.nextChar();
            if (ch === '') {
                return this.emitToken(TokenType.TK_ERROR, "Unterminated string", startPos);
            }

            if (ch === '$' && type === TokenType.TK_TEMPLATE && this.checkChar('{')) {
                this.state = LexState.UC_LEX_PLACEHOLDER_START;
                const token = this.emitBuffer(type) || this.emitToken(type, '', startPos);
                if (token) {
                    token.pos = startPos;
                    token.end -= 2;
                }
                return token;
            }

            if (ch === '[' && type === TokenType.TK_REGEXP) {
                this.buffer += '[';
                
                if (this.checkChar('^')) {
                    this.buffer += '^';
                }
                
                if (this.checkChar(']')) {
                    this.buffer += ']';
                }

                while (true) {
                    const bracketChar = this.nextChar();
                    if (bracketChar === '' || bracketChar === ']') {
                        this.buffer += bracketChar;
                        break;
                    }

                    if (bracketChar === '\\') {
                        const escapeResult = this.parseEscape('^');
                        if (escapeResult) return escapeResult;
                        continue;
                    }

                    this.buffer += bracketChar;

                    if (bracketChar === '[') {
                        const nextChar = this.peekChar();
                        if (nextChar === ':' || nextChar === '.' || nextChar === '=') {
                            this.buffer += this.nextChar();
                            
                            while (true) {
                                const nestedChar = this.nextChar();
                                if (nestedChar === '' || (nestedChar === nextChar && this.checkChar(']'))) {
                                    this.buffer += nestedChar + ']';
                                    break;
                                }
                                
                                if (nestedChar === '\\') {
                                    const escapeResult = this.parseEscape('');
                                    if (escapeResult) return escapeResult;
                                    continue;
                                }
                                
                                this.buffer += nestedChar;
                            }
                        }
                    }
                }
            } else if (ch === '\\') {
                const escapeResult = this.parseEscape(
                    type === TokenType.TK_REGEXP ? '^bBdDsSwW<>.[$()|*+?{\\' : ''
                );
                if (escapeResult) return escapeResult;
            } else if (ch === delimiter) {
                const token = this.emitBuffer(type) || this.emitToken(type, '', startPos);
                if (token) {
                    token.pos = startPos;
                }
                return token;
            } else {
                this.buffer += ch;
            }
        }
    }

    private parseRegexp(): Token {
        const token = this.parseString('/');
        
        if (token.type === TokenType.TK_REGEXP) {
            let flags = '';
            const flagChars = 'gis';
            
            while (flagChars.includes(this.peekChar())) {
                flags += this.nextChar();
            }

            if (flags) {
                token.value = String.fromCharCode(
                    (flags.includes('g') ? 1 : 0) |
                    (flags.includes('i') ? 2 : 0) |
                    (flags.includes('s') ? 4 : 0)
                ) + (token.value || '');
            }
        }

        return token;
    }

    private parseComment(kind: string): Token {
        this.buffer = '/';

        while (true) {
            const ch = this.nextChar();
            this.buffer += ch;

            if (kind === '/' && (ch === '\n' || ch === '')) {
                break;
            }

            if (kind === '*' && ch === '*' && this.checkChar('/')) {
                this.buffer += '/';
                break;
            }

            if (ch === '') {
                return this.emitToken(TokenType.TK_ERROR, "Unterminated comment");
            }
        }

        return this.emitBuffer(TokenType.TK_COMMENT) || this.emitToken(TokenType.TK_COMMENT, '');
    }

    private parseLabel(firstChar: string): Token {
        const startPos = this.pos - 1;
        this.buffer = firstChar;

        while (this.isAlnum(this.peekChar())) {
            this.buffer += this.nextChar();
        }

        const labelValue = this.buffer;
        this.buffer = '';

        if (!this.noKeyword) {
            for (const word of RESERVED_WORDS) {
                if (labelValue === word.pattern) {
                    return this.emitToken(word.type, word.pattern, startPos);
                }
            }
        }

        return this.emitToken(TokenType.TK_LABEL, labelValue, startPos);
    }

    private isNumericChar(ch: string): boolean {
        const prev = this.buffer.length > 0 ? this.buffer[this.buffer.length - 1] : '';
        const lowerCh = ch.toLowerCase();

        if (/[.0-9]/.test(ch)) return true;
        if (/[abcdefox]/.test(lowerCh) && prev !== '') return true;
        if (/[+-]/.test(ch) && prev && prev.toLowerCase() === 'e') return true;

        return false;
    }

    private parseNumber(firstChar: string): Token {
        const startPos = this.pos - 1;
        this.buffer = firstChar;

        while (this.isNumericChar(this.peekChar())) {
            this.buffer += this.nextChar();
        }

        const numStr = this.buffer;
        this.buffer = '';

        try {
            let value: number;
            if (numStr.includes('.') || numStr.includes('e') || numStr.includes('E')) {
                value = parseFloat(numStr);
                return this.emitToken(TokenType.TK_DOUBLE, value, startPos);
            } else {
                value = parseInt(numStr, 0); // Auto-detect base
                return this.emitToken(TokenType.TK_NUMBER, value, startPos);
            }
        } catch {
            return this.emitToken(TokenType.TK_ERROR, "Invalid number literal", startPos);
        }
    }

    private findToken(): Token | null {
        const tpl = !(this.config?.rawMode);
        let ch = this.nextChar();

        while (this.isSpace(ch)) {
            ch = this.nextChar();
        }

        const startPos = this.pos - 1;

        switch (ch) {
            case '~':
                return this.emitToken(TokenType.TK_COMPL, '~', startPos);

            case '}':
                if (tpl && this.checkChar('}')) {
                    return this.emitToken(TokenType.TK_REXP, '}}', startPos);
                }
                return this.emitToken(TokenType.TK_RBRACE, '}', startPos);

            case '|':
                if (this.checkChar('|')) {
                    if (this.checkChar('=')) {
                        return this.emitToken(TokenType.TK_ASOR, '||=', startPos);
                    }
                    return this.emitToken(TokenType.TK_OR, '||', startPos);
                }
                if (this.checkChar('=')) {
                    return this.emitToken(TokenType.TK_ASBOR, '|=', startPos);
                }
                return this.emitToken(TokenType.TK_BOR, '|', startPos);

            case '{':
                if (tpl && this.checkChar('{')) {
                    return this.emitToken(TokenType.TK_LEXP, '{{', startPos);
                }
                if (tpl && this.checkChar('%')) {
                    return this.emitToken(TokenType.TK_LSTM, '{%', startPos);
                }
                return this.emitToken(TokenType.TK_LBRACE, '{', startPos);

            case '^':
                if (this.checkChar('=')) {
                    return this.emitToken(TokenType.TK_ASBXOR, '^=', startPos);
                }
                return this.emitToken(TokenType.TK_BXOR, '^', startPos);

            case '[':
                return this.emitToken(TokenType.TK_LBRACK, '[', startPos);

            case ']':
                return this.emitToken(TokenType.TK_RBRACK, ']', startPos);

            case '?':
                if (this.checkChar('?')) {
                    if (this.checkChar('=')) {
                        return this.emitToken(TokenType.TK_ASNULLISH, '??=', startPos);
                    }
                    return this.emitToken(TokenType.TK_NULLISH, '??', startPos);
                }
                if (this.checkChar('.')) {
                    if (this.checkChar('[')) {
                        return this.emitToken(TokenType.TK_QLBRACK, '?.[', startPos);
                    }
                    if (this.checkChar('(')) {
                        return this.emitToken(TokenType.TK_QLPAREN, '?.(', startPos);
                    }
                    return this.emitToken(TokenType.TK_QDOT, '?.', startPos);
                }
                return this.emitToken(TokenType.TK_QMARK, '?', startPos);

            case '>':
                if (this.checkChar('>')) {
                    if (this.checkChar('=')) {
                        return this.emitToken(TokenType.TK_ASRIGHT, '>>=', startPos);
                    }
                    return this.emitToken(TokenType.TK_RSHIFT, '>>', startPos);
                }
                if (this.checkChar('=')) {
                    return this.emitToken(TokenType.TK_GE, '>=', startPos);
                }
                return this.emitToken(TokenType.TK_GT, '>', startPos);

            case '=':
                if (this.checkChar('=')) {
                    if (this.checkChar('=')) {
                        return this.emitToken(TokenType.TK_EQS, '===', startPos);
                    }
                    return this.emitToken(TokenType.TK_EQ, '==', startPos);
                }
                if (this.checkChar('>')) {
                    return this.emitToken(TokenType.TK_ARROW, '=>', startPos);
                }
                return this.emitToken(TokenType.TK_ASSIGN, '=', startPos);

            case '<':
                if (this.checkChar('<')) {
                    if (this.checkChar('=')) {
                        return this.emitToken(TokenType.TK_ASLEFT, '<<=', startPos);
                    }
                    return this.emitToken(TokenType.TK_LSHIFT, '<<', startPos);
                }
                if (this.checkChar('=')) {
                    return this.emitToken(TokenType.TK_LE, '<=', startPos);
                }
                return this.emitToken(TokenType.TK_LT, '<', startPos);

            case ';':
                return this.emitToken(TokenType.TK_SCOL, ';', startPos);

            case ':':
                return this.emitToken(TokenType.TK_COLON, ':', startPos);

            case '/':
                const nextCh = this.peekChar();
                if (nextCh === '/' || nextCh === '*') {
                    return this.parseComment(nextCh);
                }
                if (this.noRegexp) {
                    if (this.checkChar('=')) {
                        return this.emitToken(TokenType.TK_ASDIV, '/=', startPos);
                    }
                    return this.emitToken(TokenType.TK_DIV, '/', startPos);
                }
                return this.parseRegexp();

            case '.':
                if (this.checkChar('.')) {
                    if (this.checkChar('.')) {
                        return this.emitToken(TokenType.TK_ELLIP, '...', startPos);
                    }
                    return this.emitToken(TokenType.TK_ERROR, "Unexpected character");
                }
                return this.emitToken(TokenType.TK_DOT, '.', startPos);

            case '-':
                if (this.checkChar('=')) {
                    return this.emitToken(TokenType.TK_ASSUB, '-=', startPos);
                }
                if (this.checkChar('-')) {
                    return this.emitToken(TokenType.TK_DEC, '--', startPos);
                }
                return this.emitToken(TokenType.TK_SUB, '-', startPos);

            case ',':
                return this.emitToken(TokenType.TK_COMMA, ',', startPos);

            case '+':
                if (this.checkChar('=')) {
                    return this.emitToken(TokenType.TK_ASADD, '+=', startPos);
                }
                if (this.checkChar('+')) {
                    return this.emitToken(TokenType.TK_INC, '++', startPos);
                }
                return this.emitToken(TokenType.TK_ADD, '+', startPos);

            case '*':
                if (this.checkChar('*')) {
                    if (this.checkChar('=')) {
                        return this.emitToken(TokenType.TK_ASEXP, '**=', startPos);
                    }
                    return this.emitToken(TokenType.TK_EXP, '**', startPos);
                }
                if (this.checkChar('=')) {
                    return this.emitToken(TokenType.TK_ASMUL, '*=', startPos);
                }
                return this.emitToken(TokenType.TK_MUL, '*', startPos);

            case '(':
                return this.emitToken(TokenType.TK_LPAREN, '(', startPos);

            case ')':
                return this.emitToken(TokenType.TK_RPAREN, ')', startPos);

            case "'":
            case '"':
            case '`':
                return this.parseString(ch);

            case '&':
                if (this.checkChar('&')) {
                    if (this.checkChar('=')) {
                        return this.emitToken(TokenType.TK_ASAND, '&&=', startPos);
                    }
                    return this.emitToken(TokenType.TK_AND, '&&', startPos);
                }
                if (this.checkChar('=')) {
                    return this.emitToken(TokenType.TK_ASBAND, '&=', startPos);
                }
                return this.emitToken(TokenType.TK_BAND, '&', startPos);

            case '%':
                if (this.checkChar('=')) {
                    return this.emitToken(TokenType.TK_ASMOD, '%=', startPos);
                }
                return this.emitToken(TokenType.TK_MOD, '%', startPos);

            case '!':
                if (this.checkChar('=')) {
                    if (this.checkChar('=')) {
                        return this.emitToken(TokenType.TK_NES, '!==', startPos);
                    }
                    return this.emitToken(TokenType.TK_NE, '!=', startPos);
                }
                return this.emitToken(TokenType.TK_NOT, '!', startPos);

            case '':
                return this.emitToken(TokenType.TK_EOF, '', startPos);

            default:
                if (this.isAlpha(ch)) {
                    return this.parseLabel(ch);
                }
                if (this.isDigit(ch)) {
                    return this.parseNumber(ch);
                }
                return this.emitToken(TokenType.TK_ERROR, "Unexpected character");
        }
    }

    public nextToken(): Token {
        let token: Token | null = null;

        while (this.state !== LexState.UC_LEX_EOF) {
            switch (this.state) {
                case LexState.UC_LEX_IDENTIFY_TOKEN:
                    do { 
                        token = this.findToken(); 
                    } while (token === null);

                    if (token.type === TokenType.TK_EOF) {
                        this.state = LexState.UC_LEX_EOF;
                    }
                    break;

                default:
                    // For now, simplified - just handle token identification
                    this.state = LexState.UC_LEX_IDENTIFY_TOKEN;
                    continue;
            }

            if (token && token.type !== TokenType.TK_COMMENT) {
                this.noKeyword = false;
                this.updateLexerState(token);
            }

            if (token) {
                return token;
            }
        }

        return this.emitToken(TokenType.TK_EOF, '');
    }

    private updateLexerState(token: Token): void {
        // These are the token types that can be followed by a division operator,
        // but not a regular expression.
        const typesThatPrecedeDiv = [
            TokenType.TK_RPAREN,    // )
            TokenType.TK_RBRACK,    // ]
            TokenType.TK_LABEL,     // variable
            TokenType.TK_NUMBER,    // 123
            TokenType.TK_DOUBLE,    // 1.23
            TokenType.TK_STRING,    // "hello"
            TokenType.TK_TRUE,
            TokenType.TK_FALSE,
            TokenType.TK_NULL,
            TokenType.TK_THIS,
            TokenType.TK_INC,       // x++
            TokenType.TK_DEC        // x--
        ];

        if (typesThatPrecedeDiv.includes(token.type)) {
            this.noRegexp = true;
        } else {
            this.noRegexp = false;
        }
    }

    public tokenize(): Token[] {
        const tokens: Token[] = [];
        let token: Token;

        do {
            token = this.nextToken();
            tokens.push(token);
        } while (token.type !== TokenType.TK_EOF);

        return tokens;
    }

    public static getTokenName(type: TokenType): string {
        const tokenNames: Partial<Record<TokenType, string>> = {
            [TokenType.TK_LEXP]: "'{{'",
            [TokenType.TK_REXP]: "'}}'",
            [TokenType.TK_LSTM]: "'{%'",
            [TokenType.TK_RSTM]: "'%}'",
            [TokenType.TK_COMMA]: "','",
            [TokenType.TK_ASSIGN]: "'='",
            [TokenType.TK_ASADD]: "'+='",
            [TokenType.TK_ASSUB]: "'-='",
            [TokenType.TK_ASMUL]: "'*='",
            [TokenType.TK_ASDIV]: "'/='",
            [TokenType.TK_ASMOD]: "'%='",
            [TokenType.TK_ASLEFT]: "'<<='",
            [TokenType.TK_ASRIGHT]: "'>>='",
            [TokenType.TK_ASBAND]: "'&='",
            [TokenType.TK_ASBXOR]: "'^='",
            [TokenType.TK_ASBOR]: "'|='",
            [TokenType.TK_QMARK]: "'?'",
            [TokenType.TK_COLON]: "':'",
            [TokenType.TK_OR]: "'||'",
            [TokenType.TK_AND]: "'&&'",
            [TokenType.TK_BOR]: "'|'",
            [TokenType.TK_BXOR]: "'^'",
            [TokenType.TK_BAND]: "'&'",
            [TokenType.TK_EQS]: "'==='",
            [TokenType.TK_NES]: "'!=='",
            [TokenType.TK_EQ]: "'=='",
            [TokenType.TK_NE]: "'!='",
            [TokenType.TK_LT]: "'<'",
            [TokenType.TK_LE]: "'<='",
            [TokenType.TK_GT]: "'>'",
            [TokenType.TK_GE]: "'>='",
            [TokenType.TK_LSHIFT]: "'<<'",
            [TokenType.TK_RSHIFT]: "'>>'",
            [TokenType.TK_ADD]: "'+'",
            [TokenType.TK_SUB]: "'-'",
            [TokenType.TK_MUL]: "'*'",
            [TokenType.TK_DIV]: "'/'",
            [TokenType.TK_MOD]: "'%'",
            [TokenType.TK_EXP]: "'**'",
            [TokenType.TK_NOT]: "'!'",
            [TokenType.TK_COMPL]: "'~'",
            [TokenType.TK_INC]: "'++'",
            [TokenType.TK_DEC]: "'--'",
            [TokenType.TK_DOT]: "'.'",
            [TokenType.TK_LBRACK]: "'['",
            [TokenType.TK_RBRACK]: "']'",
            [TokenType.TK_LPAREN]: "'('",
            [TokenType.TK_RPAREN]: "')'",
            [TokenType.TK_LBRACE]: "'{'",
            [TokenType.TK_RBRACE]: "'}'",
            [TokenType.TK_SCOL]: "';'",
            [TokenType.TK_ELLIP]: "'...'",
            [TokenType.TK_ARROW]: "'=>'",
            [TokenType.TK_QLBRACK]: "'?.['",
            [TokenType.TK_QLPAREN]: "'?.('",
            [TokenType.TK_QDOT]: "'?.'",
            [TokenType.TK_ASEXP]: "'**='",
            [TokenType.TK_ASAND]: "'&&='",
            [TokenType.TK_ASOR]: "'||='",
            [TokenType.TK_ASNULLISH]: "'??='",
            [TokenType.TK_NULLISH]: "'??'",
            [TokenType.TK_PLACEH]: "'${'",
            [TokenType.TK_TEXT]: "Text",
            [TokenType.TK_LABEL]: "Label",
            [TokenType.TK_NUMBER]: "Number",
            [TokenType.TK_DOUBLE]: "Double",
            [TokenType.TK_STRING]: "String",
            [TokenType.TK_REGEXP]: "Regexp",
            [TokenType.TK_TEMPLATE]: "Template",
            [TokenType.TK_ERROR]: "Error",
            [TokenType.TK_EOF]: "End of file",
            [TokenType.TK_COMMENT]: "Comment"
        };

        // Check for reserved words
        for (const word of RESERVED_WORDS) {
            if (word.type === type) {
                return `'${word.pattern}'`;
            }
        }

        return tokenNames[type] || '?';
    }

    public static isKeyword(label: string): boolean {
        return RESERVED_WORDS.some(word => word.pattern === label);
    }
}