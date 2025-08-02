/*
 * Token types for the ucode lexer
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
    TK_EXPORT,        // 'export'
    TK_IMPORT,        // 'import'
    TK_FROM,          // 'from'
    TK_TEMPLATE,      // Template literal
    TK_COMMENT,       // Comment
    TK_NEWLINE,       // New line
    TK_LET,           // 'let'
    TK_VAR,           // 'var'
    TK_EOF,           // End of file
    TK_ERROR,         // Error token
    TK_UNKNOWN,       // Unknown token
}

export interface Token {
    type: TokenType;
    value: string | number | boolean;
    pos: number;
    end: number;
    line?: number;
    column?: number;
}

export interface LexerState {
    source: string;
    position: number;
    line: number;
    column: number;
    length: number;
    tokens: Token[];
    errors: string[];
}

// Keyword mapping
export const Keywords: Record<string, TokenType> = {
    'if': TokenType.TK_IF,
    'else': TokenType.TK_ELSE,
    'elif': TokenType.TK_ELIF,
    'endif': TokenType.TK_ENDIF,
    'while': TokenType.TK_WHILE,
    'endwhile': TokenType.TK_ENDWHILE,
    'for': TokenType.TK_FOR,
    'endfor': TokenType.TK_ENDFOR,
    'in': TokenType.TK_IN,
    'function': TokenType.TK_FUNC,
    'endfunction': TokenType.TK_ENDFUNC,
    'return': TokenType.TK_RETURN,
    'break': TokenType.TK_BREAK,
    'continue': TokenType.TK_CONTINUE,
    'let': TokenType.TK_LOCAL,
    'const': TokenType.TK_CONST,
    'var': TokenType.TK_VAR,
    'true': TokenType.TK_TRUE,
    'false': TokenType.TK_FALSE,
    'null': TokenType.TK_NULL,
    'this': TokenType.TK_THIS,
    'delete': TokenType.TK_DELETE,
    'try': TokenType.TK_TRY,
    'catch': TokenType.TK_CATCH,
    'switch': TokenType.TK_SWITCH,
    'case': TokenType.TK_CASE,
    'default': TokenType.TK_DEFAULT,
    'export': TokenType.TK_EXPORT,
    'import': TokenType.TK_IMPORT,
    'from': TokenType.TK_FROM,
};

// Operator mapping
export const Operators: Record<string, TokenType> = {
    '{{': TokenType.TK_LEXP,
    '}}': TokenType.TK_REXP,
    '{%': TokenType.TK_LSTM,
    '%}': TokenType.TK_RSTM,
    ',': TokenType.TK_COMMA,
    '=': TokenType.TK_ASSIGN,
    '+=': TokenType.TK_ASADD,
    '-=': TokenType.TK_ASSUB,
    '*=': TokenType.TK_ASMUL,
    '/=': TokenType.TK_ASDIV,
    '%=': TokenType.TK_ASMOD,
    '<<=': TokenType.TK_ASLEFT,
    '>>=': TokenType.TK_ASRIGHT,
    '&=': TokenType.TK_ASBAND,
    '^=': TokenType.TK_ASBXOR,
    '|=': TokenType.TK_ASBOR,
    '**=': TokenType.TK_ASEXP,
    '&&=': TokenType.TK_ASAND,
    '||=': TokenType.TK_ASOR,
    '??=': TokenType.TK_ASNULLISH,
    '?': TokenType.TK_QMARK,
    ':': TokenType.TK_COLON,
    '||': TokenType.TK_OR,
    '&&': TokenType.TK_AND,
    '|': TokenType.TK_BOR,
    '^': TokenType.TK_BXOR,
    '&': TokenType.TK_BAND,
    '===': TokenType.TK_EQS,
    '!==': TokenType.TK_NES,
    '==': TokenType.TK_EQ,
    '!=': TokenType.TK_NE,
    '<': TokenType.TK_LT,
    '<=': TokenType.TK_LE,
    '>': TokenType.TK_GT,
    '>=': TokenType.TK_GE,
    '<<': TokenType.TK_LSHIFT,
    '>>': TokenType.TK_RSHIFT,
    '+': TokenType.TK_ADD,
    '-': TokenType.TK_SUB,
    '*': TokenType.TK_MUL,
    '/': TokenType.TK_DIV,
    '%': TokenType.TK_MOD,
    '**': TokenType.TK_EXP,
    '!': TokenType.TK_NOT,
    '~': TokenType.TK_COMPL,
    '++': TokenType.TK_INC,
    '--': TokenType.TK_DEC,
    '.': TokenType.TK_DOT,
    '[': TokenType.TK_LBRACK,
    ']': TokenType.TK_RBRACK,
    '(': TokenType.TK_LPAREN,
    ')': TokenType.TK_RPAREN,
    '{': TokenType.TK_LBRACE,
    '}': TokenType.TK_RBRACE,
    ';': TokenType.TK_SCOL,
    '...': TokenType.TK_ELLIP,
    '=>': TokenType.TK_ARROW,
    '?.[': TokenType.TK_QLBRACK,
    '?.(': TokenType.TK_QLPAREN,
    '?.': TokenType.TK_QDOT,
    '??': TokenType.TK_NULLISH,
    '${': TokenType.TK_PLACEH,
};

// Helper functions
export function isKeyword(text: string): boolean {
    return text in Keywords;
}

export function isOperator(text: string): boolean {
    return text in Operators;
}

export function getTokenTypeName(type: TokenType): string {
    return TokenType[type] || 'UNKNOWN';
}

export function isIdentifierStart(char: string): boolean {
    return /[a-zA-Z_$]/.test(char);
}

export function isIdentifierPart(char: string): boolean {
    return /[a-zA-Z0-9_$]/.test(char);
}

export function isDigit(char: string): boolean {
    return /[0-9]/.test(char);
}

export function isHexDigit(char: string): boolean {
    return /[0-9a-fA-F]/.test(char);
}

export function isOctalDigit(char: string): boolean {
    return /[0-7]/.test(char);
}

export function isBinaryDigit(char: string): boolean {
    return /[01]/.test(char);
}

export function isWhitespace(char: string): boolean {
    return /[ \t\r\n\f\v]/.test(char);
}

export function isLineBreak(char: string): boolean {
    return char === '\n' || char === '\r';
}