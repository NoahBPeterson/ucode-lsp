import {
    Diagnostic,
    DiagnosticSeverity,
    TextDocument
} from 'vscode-languageserver/node';
import { TokenType, Token } from '../lexer';

function isNumericToken(token: Token): boolean {
    return token.type === TokenType.TK_NUMBER || token.type === TokenType.TK_DOUBLE;
}

function isArrayToken(token: Token): boolean {
    return token.type === TokenType.TK_LBRACK;
}

function isObjectToken(token: Token): boolean {
    return token.type === TokenType.TK_LBRACE;
}

export function validateRemainingUtilityFunctions(textDocument: TextDocument, tokens: Token[], diagnostics: Diagnostic[]): void {
    for (let i = 0; i < tokens.length - 2; i++) {
        const funcToken = tokens[i];
        const parenToken = tokens[i + 1];
        
        if (funcToken && parenToken &&
            funcToken.type === TokenType.TK_LABEL &&
            typeof funcToken.value === 'string' &&
            parenToken.type === TokenType.TK_LPAREN) {
            
            // Handle wildcard function: wildcard(pattern, string)
            if (funcToken.value === 'wildcard') {
                const firstParamToken = tokens[i + 2];
                if (firstParamToken && (isNumericToken(firstParamToken) || isArrayToken(firstParamToken) || isObjectToken(firstParamToken))) {
                    let paramType = getParamType(firstParamToken);
                    let endToken = getFullTokenRange(tokens, i + 2, firstParamToken);
                    
                    const diagnostic: Diagnostic = {
                        severity: DiagnosticSeverity.Error,
                        range: {
                            start: textDocument.positionAt(firstParamToken.pos),
                            end: textDocument.positionAt(endToken.end)
                        },
                        message: `wildcard() first parameter should be a pattern string, not a ${paramType}.`,
                        source: 'ucode'
                    };
                    diagnostics.push(diagnostic);
                }
                
                // Check second parameter if there's a comma
                const commaToken = tokens[i + 3];
                if (commaToken?.type === TokenType.TK_COMMA) {
                    const secondParamToken = tokens[i + 4];
                    if (secondParamToken && (isNumericToken(secondParamToken) || isArrayToken(secondParamToken) || isObjectToken(secondParamToken))) {
                        let paramType = getParamType(secondParamToken);
                        let endToken = getFullTokenRange(tokens, i + 4, secondParamToken);
                        
                        const diagnostic: Diagnostic = {
                            severity: DiagnosticSeverity.Error,
                            range: {
                                start: textDocument.positionAt(secondParamToken.pos),
                                end: textDocument.positionAt(endToken.end)
                            },
                            message: `wildcard() second parameter should be a string, not a ${paramType}.`,
                            source: 'ucode'
                        };
                        diagnostics.push(diagnostic);
                    }
                }
            }
            
            // Handle regexp function: regexp(pattern, flags?)
            if (funcToken.value === 'regexp') {
                const firstParamToken = tokens[i + 2];
                if (firstParamToken && (isNumericToken(firstParamToken) || isArrayToken(firstParamToken) || isObjectToken(firstParamToken))) {
                    let paramType = getParamType(firstParamToken);
                    let endToken = getFullTokenRange(tokens, i + 2, firstParamToken);
                    
                    const diagnostic: Diagnostic = {
                        severity: DiagnosticSeverity.Error,
                        range: {
                            start: textDocument.positionAt(firstParamToken.pos),
                            end: textDocument.positionAt(endToken.end)
                        },
                        message: `regexp() first parameter should be a pattern string, not a ${paramType}.`,
                        source: 'ucode'
                    };
                    diagnostics.push(diagnostic);
                }
                
                // Check second parameter if there's a comma  
                const commaToken = tokens[i + 3];
                if (commaToken?.type === TokenType.TK_COMMA) {
                    const secondParamToken = tokens[i + 4];
                    if (secondParamToken && (isNumericToken(secondParamToken) || isArrayToken(secondParamToken) || isObjectToken(secondParamToken))) {
                        let paramType = getParamType(secondParamToken);
                        let endToken = getFullTokenRange(tokens, i + 4, secondParamToken);
                        
                        const diagnostic: Diagnostic = {
                            severity: DiagnosticSeverity.Error,
                            range: {
                                start: textDocument.positionAt(secondParamToken.pos),
                                end: textDocument.positionAt(endToken.end)
                            },
                            message: `regexp() second parameter should be a flags string, not a ${paramType}.`,
                            source: 'ucode'
                        };
                        diagnostics.push(diagnostic);
                    }
                }
            }
            
            // Handle assert function: assert(condition, message?) - accepts any type for condition
            // No validation needed as assert accepts any type for first parameter
        }
    }
}

function getParamType(token: Token): string {
    if (isNumericToken(token)) return 'number';
    if (isArrayToken(token)) return 'array';
    if (isObjectToken(token)) return 'object';
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