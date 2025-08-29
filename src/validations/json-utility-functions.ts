import {
    Diagnostic,
    DiagnosticSeverity
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { TokenType, Token } from '../lexer';
import { UcodeErrorCode } from '../analysis/errorConstants';

function isNumericToken(token: Token): boolean {
    return token.type === TokenType.TK_NUMBER || token.type === TokenType.TK_DOUBLE;
}

function isArrayToken(token: Token): boolean {
    return token.type === TokenType.TK_LBRACK;
}

function isObjectToken(token: Token): boolean {
    return token.type === TokenType.TK_LBRACE;
}

function isStringToken(token: Token): boolean {
    return token.type === TokenType.TK_STRING;
}

export function validateJSONUtilityFunctions(textDocument: TextDocument, tokens: Token[], diagnostics: Diagnostic[]): void {
    for (let i = 0; i < tokens.length - 2; i++) {
        const funcToken = tokens[i];
        const parenToken = tokens[i + 1];
        
        if (funcToken && parenToken &&
            funcToken.type === TokenType.TK_LABEL &&
            typeof funcToken.value === 'string' &&
            parenToken.type === TokenType.TK_LPAREN) {
            
            // Handle json function: json(any) - accepts any type, no validation needed
            // The json function is multi-purpose and accepts any data type
            
            // Handle call function: call(function, ...args)
            if (funcToken.value === 'call') {
                const firstParamToken = tokens[i + 2];
                if (firstParamToken && (isNumericToken(firstParamToken) || isArrayToken(firstParamToken) || isObjectToken(firstParamToken) || isStringToken(firstParamToken))) {
                    let paramType = getParamType(firstParamToken);
                    let endToken = getFullTokenRange(tokens, i + 2, firstParamToken);
                    
                    const diagnostic: Diagnostic = {
                        severity: DiagnosticSeverity.Error,
                        code: UcodeErrorCode.INVALID_PARAMETER_TYPE,
                        range: {
                            start: textDocument.positionAt(firstParamToken.pos),
                            end: textDocument.positionAt(endToken.end)
                        },
                        message: `call() first parameter should be a function, not a ${paramType}.`,
                        source: 'ucode'
                    };
                    diagnostics.push(diagnostic);
                }
            }
            
            // Handle signal function: signal(number, function?)
            if (funcToken.value === 'signal') {
                const firstParamToken = tokens[i + 2];
                if (firstParamToken && (isArrayToken(firstParamToken) || isObjectToken(firstParamToken) || isStringToken(firstParamToken))) {
                    let paramType = getParamType(firstParamToken);
                    let endToken = getFullTokenRange(tokens, i + 2, firstParamToken);
                    
                    const diagnostic: Diagnostic = {
                        severity: DiagnosticSeverity.Error,
                        code: UcodeErrorCode.INVALID_PARAMETER_TYPE,
                        range: {
                            start: textDocument.positionAt(firstParamToken.pos),
                            end: textDocument.positionAt(endToken.end)
                        },
                        message: `signal() first parameter should be a signal number, not a ${paramType}.`,
                        source: 'ucode'
                    };
                    diagnostics.push(diagnostic);
                }
                
                // Check second parameter if there's a comma
                const commaToken = tokens[i + 3];
                if (commaToken?.type === TokenType.TK_COMMA) {
                    const secondParamToken = tokens[i + 4];
                    if (secondParamToken && (isNumericToken(secondParamToken) || isArrayToken(secondParamToken) || isObjectToken(secondParamToken) || isStringToken(secondParamToken))) {
                        let paramType = getParamType(secondParamToken);
                        let endToken = getFullTokenRange(tokens, i + 4, secondParamToken);
                        
                        const diagnostic: Diagnostic = {
                            severity: DiagnosticSeverity.Error,
                            code: UcodeErrorCode.INVALID_PARAMETER_TYPE,
                            range: {
                                start: textDocument.positionAt(secondParamToken.pos),
                                end: textDocument.positionAt(endToken.end)
                            },
                            message: `signal() second parameter should be a handler function, not a ${paramType}.`,
                            source: 'ucode'
                        };
                        diagnostics.push(diagnostic);
                    }
                }
            }
        }
    }
}

function getParamType(token: Token): string {
    if (isNumericToken(token)) return 'number';
    if (isArrayToken(token)) return 'array';
    if (isObjectToken(token)) return 'object';
    if (isStringToken(token)) return 'string';
    return 'unknown';
}

function getFullTokenRange(tokens: Token[], startIndex: number, firstToken: Token): Token {
    let endToken = firstToken;
    
    if (isArrayToken(firstToken)) {
        // Find matching closing bracket
        let depth = 1;
        let j = startIndex + 1;
        while (j < tokens.length && depth > 0) {
            const token = tokens[j];
            if (token?.type === TokenType.TK_LBRACK) {
                depth++;
            } else if (token?.type === TokenType.TK_RBRACK) {
                depth--;
                if (depth === 0) {
                    endToken = token;
                    break;
                }
            }
            j++;
        }
    } else if (isObjectToken(firstToken)) {
        // Find matching closing brace
        let depth = 1;
        let j = startIndex + 1;
        while (j < tokens.length && depth > 0) {
            const token = tokens[j];
            if (token?.type === TokenType.TK_LBRACE) {
                depth++;
            } else if (token?.type === TokenType.TK_RBRACE) {
                depth--; 
                if (depth === 0) {
                    endToken = token;
                    break;
                }
            }
            j++;
        }
    }
    
    return endToken;
}