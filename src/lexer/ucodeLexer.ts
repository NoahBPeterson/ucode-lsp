/*
 * Main ucode lexer implementation
 * Based on the original C implementation from the ucode project
 */

import { TokenType, Token, Keywords, Operators, 
         isKeyword, isIdentifierStart, isIdentifierPart, isDigit, 
         isHexDigit, isWhitespace, isLineBreak, 
         isBinaryDigit} from './tokenTypes';

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
        // Handle shebang line if it's the first line and we're at the beginning
        if (this.line === 1 && this.column === 1 && this.peekChar() === '#' && this.peekChar(1) === '!') {
            return this.parseShebang();
        }
        
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
            const statementKeywords = ['export', 'import', 'function', 'let', 'const', 'var', 'if', 'while', 'for', 'return', 'break', 'continue', 'try', 'switch', 'class'];
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

        // Handle binary numbers
        if (this.peekChar() === '0' && (this.peekChar(1) === 'b' || this.peekChar(1) === 'B')) {
            value += this.nextChar(); // '0'
            value += this.nextChar(); // 'x' or 'X'
            
            while (isBinaryDigit(this.peekChar())) {
                value += this.nextChar();
            }
            
            return this.emitToken(TokenType.TK_NUMBER, parseInt(value, 2), startPos);
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
                this.nextChar(); // consume backslash
                const escaped = this.nextChar();
                
                switch (escaped) {
                    case 'n': value += '\n'; break;
                    case 't': value += '\t'; break;
                    case 'r': value += '\r'; break;
                    case '\\': value += '\\'; break;
                    case '`': value += '`'; break;
                    case '$': value += '$'; break;
                    default: value += escaped; break;
                }
            } 
            // Handle template interpolations ${...}
            else if (ch === '$' && this.peekChar(1) === '{') {
                // For now, include the ${...} as literal text
                // TODO: Implement proper template interpolation tokenizing
                value += this.nextChar(); // consume '$'
                value += this.nextChar(); // consume '{'
                
                // Find the matching closing brace
                let braceCount = 1;
                while (this.pos < this.source.length && braceCount > 0) {
                    const braceCh = this.nextChar();
                    value += braceCh;
                    if (braceCh === '{') braceCount++;
                    else if (braceCh === '}') braceCount--;
                }
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
        
        // Update noRegexp flag based on the token type
        this.updateNoRegexpFlag(type);
        
        // Update noKeyword flag based on the token type
        this.updateNoKeywordFlag(type);
        
        return {
            type,
            value: value || '',
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
                 tokenType === TokenType.TK_COLON) {     // :
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
        // After TK_DOT, the next identifier should be treated as TK_LABEL (member access)
        if (tokenType === TokenType.TK_DOT) {
            this.noKeyword = true;
        } 
        // Reset flag after consuming one identifier following a dot
        else if (tokenType === TokenType.TK_LABEL && this.noKeyword) {
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

    public getErrors(): string[] {
        return this.errors;
    }
}