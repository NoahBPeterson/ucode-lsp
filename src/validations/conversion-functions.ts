import {
    Diagnostic,
    DiagnosticSeverity
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { TokenType, Token } from '../lexer';
import { UcodeErrorCode } from '../analysis/errorConstants';

function isArrayToken(token: Token): boolean {
    return token.type === TokenType.TK_LBRACK;
}

function isObjectToken(token: Token): boolean {
    return token.type === TokenType.TK_LBRACE;
}

export function validateConversionFunctions(textDocument: TextDocument, tokens: Token[], diagnostics: Diagnostic[]): void {
    for (let i = 0; i < tokens.length - 2; i++) {
        const funcToken = tokens[i];
        const parenToken = tokens[i + 1];
        
        if (funcToken && parenToken &&
            funcToken.type === TokenType.TK_LABEL &&
            typeof funcToken.value === 'string' &&
            parenToken.type === TokenType.TK_LPAREN) {
            
            // Handle int function: int(string/number) - arrays and objects should error
            if (funcToken.value === 'int') {
                const firstParamToken = tokens[i + 2];
                if (firstParamToken && (isArrayToken(firstParamToken) || isObjectToken(firstParamToken))) {
                    const paramType = isArrayToken(firstParamToken) ? 'array' : 'object';
                    
                    // Find the matching closing bracket/brace for full range
                    let endToken = firstParamToken;
                    const isArray = isArrayToken(firstParamToken);
                    const openType = isArray ? TokenType.TK_LBRACK : TokenType.TK_LBRACE;
                    const closeType = isArray ? TokenType.TK_RBRACK : TokenType.TK_RBRACE;
                    
                    let depth = 1;
                    let j = i + 3;
                    while (j < tokens.length && depth > 0) {
                        const token = tokens[j];
                        if (token?.type === openType) {
                            depth++;
                        } else if (token?.type === closeType) {
                            depth--;
                            if (depth === 0) {
                                endToken = token;
                                break;
                            }
                        }
                        j++;
                    }
                    
                    const diagnostic: Diagnostic = {
                        severity: DiagnosticSeverity.Error,
                        code: UcodeErrorCode.INVALID_PARAMETER_TYPE,
                        range: {
                            start: textDocument.positionAt(firstParamToken.pos),
                            end: textDocument.positionAt(endToken.end)
                        },
                        message: `int() parameter should be a string or number, not an ${paramType}.`,
                        source: 'ucode'
                    };
                    diagnostics.push(diagnostic);
                }
            }
        }
    }
}