/*
 * Main ucode lexer implementation
 * Based on the original C implementation from the ucode project
 */

import { TokenType, Token, Keywords, Operators, 
         isKeyword, isIdentifierStart, isIdentifierPart, isDigit, 
         isHexDigit, isWhitespace, isLineBreak } from './tokenTypes';

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
    private errors: string[] = [];

    constructor(source: string, config?: ParseConfig) {
        this.source = source;
        
        if (config?.rawMode) {
            this.state = LexState.UC_LEX_IDENTIFY_TOKEN;
        }
    }

    public tokenize(): Token[] {
        const tokens: Token[] = [];
        let token: Token | null;
        
        while ((token = this.nextToken()) !== null) {
            if (token.type === TokenType.TK_EOF) {
                tokens.push(token);
                break;
            }
            if (token.type !== TokenType.TK_COMMENT) { // Skip comments by default
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
                return this.emitToken(TokenType.TK_EOF);
            default:
                return null;
        }
    }

    private identifyBlock(): Token | null {
        if (this.pos >= this.source.length) {
            this.state = LexState.UC_LEX_EOF;
            return this.emitBuffer(TokenType.TK_TEXT);
        }

        const ch = this.peekChar();
        
        if (ch === '{') {
            const next = this.peekChar(1);
            
            if (next === '{') {
                // Expression block
                const text = this.emitBuffer(TokenType.TK_TEXT);
                this.state = LexState.UC_LEX_BLOCK_EXPRESSION_EMIT_TAG;
                return text;
            } else if (next === '%') {
                // Statement block
                const text = this.emitBuffer(TokenType.TK_TEXT);
                this.state = LexState.UC_LEX_BLOCK_STATEMENT_EMIT_TAG;
                return text;
            } else if (next === '#') {
                // Comment block
                const text = this.emitBuffer(TokenType.TK_TEXT);
                this.state = LexState.UC_LEX_BLOCK_COMMENT;
                return text;
            }
        }

        this.buffer += this.nextChar();
        this.updatePosition(ch);
        return this.identifyBlock();
    }

    private blockExpressionEmitTag(): Token | null {
        this.nextChar(); // consume '{'
        this.nextChar(); // consume '{'
        this.state = LexState.UC_LEX_IDENTIFY_TOKEN;
        return this.emitToken(TokenType.TK_LEXP);
    }

    private blockStatementEmitTag(): Token | null {
        this.nextChar(); // consume '{'
        this.nextChar(); // consume '%'
        this.state = LexState.UC_LEX_IDENTIFY_TOKEN;
        return this.emitToken(TokenType.TK_LSTM);
    }

    private blockComment(): Token | null {
        this.nextChar(); // consume '{'
        this.nextChar(); // consume '#'
        
        // Skip until #}
        while (this.pos < this.source.length) {
            const ch = this.peekChar();
            if (ch === '#' && this.peekChar(1) === '}') {
                this.nextChar(); // consume '#'
                this.nextChar(); // consume '}'
                break;
            }
            this.nextChar();
            this.updatePosition(ch);
        }
        
        this.state = LexState.UC_LEX_IDENTIFY_BLOCK;
        return this.blockComment();
    }

    private identifyToken(): Token | null {
        this.skipWhitespace();
        
        if (this.pos >= this.source.length) {
            this.state = LexState.UC_LEX_EOF;
            return this.emitToken(TokenType.TK_EOF);
        }

        const ch = this.peekChar();

        // Check for block endings
        if (ch === '}' && this.peekChar(1) === '}') {
            this.nextChar();
            this.nextChar();
            this.state = LexState.UC_LEX_IDENTIFY_BLOCK;
            return this.emitToken(TokenType.TK_REXP);
        }

        if (ch === '%' && this.peekChar(1) === '}') {
            this.nextChar();
            this.nextChar();
            this.state = LexState.UC_LEX_IDENTIFY_BLOCK;
            return this.emitToken(TokenType.TK_RSTM);
        }

        // Template literals
        if (ch === '$' && this.peekChar(1) === '{') {
            this.nextChar();
            this.nextChar();
            this.state = LexState.UC_LEX_PLACEHOLDER_START;
            return this.emitToken(TokenType.TK_PLACEH);
        }

        // Numbers
        if (isDigit(ch)) {
            return this.parseNumber();
        }

        // Strings
        if (ch === '"' || ch === "'") {
            return this.parseString(ch);
        }

        // Regular expressions
        if (ch === '/' && !this.noRegexp) {
            return this.parseRegex();
        }

        // Comments
        if (ch === '/' && this.peekChar(1) === '/') {
            return this.parseLineComment();
        }

        if (ch === '/' && this.peekChar(1) === '*') {
            return this.parseBlockComment();
        }

        // Identifiers and keywords
        if (isIdentifierStart(ch)) {
            return this.parseIdentifier();
        }

        // Operators
        const operator = this.parseOperator();
        if (operator) {
            return operator;
        }

        // Unknown character
        this.nextChar();
        return this.emitToken(TokenType.TK_ERROR, `Unexpected character: ${ch}`);
    }

    private parseNumber(): Token | null {
        const startPos = this.pos;
        let value = '';
        let isFloat = false;

        // Handle hex numbers
        if (this.peekChar() === '0' && (this.peekChar(1) === 'x' || this.peekChar(1) === 'X')) {
            value += this.nextChar(); // '0'
            value += this.nextChar(); // 'x' or 'X'
            
            while (isHexDigit(this.peekChar())) {
                value += this.nextChar();
            }
            
            return this.emitToken(TokenType.TK_NUMBER, parseInt(value, 16), startPos);
        }

        // Handle decimal numbers
        while (isDigit(this.peekChar())) {
            value += this.nextChar();
        }

        // Handle float
        if (this.peekChar() === '.') {
            isFloat = true;
            value += this.nextChar();
            
            while (isDigit(this.peekChar())) {
                value += this.nextChar();
            }
        }

        // Handle scientific notation
        if (this.peekChar() === 'e' || this.peekChar() === 'E') {
            isFloat = true;
            value += this.nextChar();
            
            if (this.peekChar() === '+' || this.peekChar() === '-') {
                value += this.nextChar();
            }
            
            while (isDigit(this.peekChar())) {
                value += this.nextChar();
            }
        }

        const numValue = isFloat ? parseFloat(value) : parseInt(value, 10);
        return this.emitToken(isFloat ? TokenType.TK_DOUBLE : TokenType.TK_NUMBER, numValue, startPos);
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
                this.nextChar(); // consume backslash
                const escaped = this.nextChar();
                
                switch (escaped) {
                    case 'n': value += '\n'; break;
                    case 't': value += '\t'; break;
                    case 'r': value += '\r'; break;
                    case '\\': value += '\\'; break;
                    case '"': value += '"'; break;
                    case "'": value += "'"; break;
                    default: value += escaped; break;
                }
            } else {
                value += this.nextChar();
            }
        }
        
        return this.emitToken(TokenType.TK_ERROR, 'Unterminated string', startPos);
    }

    private parseRegex(): Token | null {
        const startPos = this.pos;
        let value = '';
        
        this.nextChar(); // consume opening /
        value += '/';
        
        while (this.pos < this.source.length) {
            const ch = this.peekChar();
            
            if (ch === '/') {
                value += this.nextChar(); // consume closing /
                
                // Handle regex flags
                while (this.pos < this.source.length && /[gimuy]/.test(this.peekChar())) {
                    value += this.nextChar();
                }
                
                return this.emitToken(TokenType.TK_REGEXP, value, startPos);
            }
            
            if (ch === '\\') {
                value += this.nextChar(); // consume backslash
                if (this.pos < this.source.length) {
                    value += this.nextChar(); // consume escaped character
                }
            } else {
                value += this.nextChar();
            }
        }
        
        return this.emitToken(TokenType.TK_ERROR, 'Unterminated regex', startPos);
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
        
        this.nextChar(); // consume /
        this.nextChar(); // consume *
        
        while (this.pos < this.source.length - 1) {
            if (this.peekChar() === '*' && this.peekChar(1) === '/') {
                this.nextChar(); // consume *
                this.nextChar(); // consume /
                return this.emitToken(TokenType.TK_COMMENT, value, startPos);
            }
            
            const ch = this.nextChar();
            value += ch;
            this.updatePosition(ch);
        }
        
        return this.emitToken(TokenType.TK_ERROR, 'Unterminated comment', startPos);
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
                for (let i = 0; i < len; i++) {
                    this.nextChar();
                }
                const operatorType = Operators[substr];
                if (operatorType) {
                    return this.emitToken(operatorType, substr, startPos);
                }
            }
        }
        
        return null;
    }

    private placeholderStart(): Token | null {
        this.state = LexState.UC_LEX_IDENTIFY_TOKEN;
        return this.identifyToken();
    }

    private placeholderEnd(): Token | null {
        this.state = LexState.UC_LEX_IDENTIFY_TOKEN;
        return this.identifyToken();
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
        
        return {
            type,
            value: value || '',
            pos: startPos,
            end: endPos,
            line: this.line,
            column: this.column
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

    public getErrors(): string[] {
        return this.errors;
    }
}