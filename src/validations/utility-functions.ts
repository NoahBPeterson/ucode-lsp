import {
    Diagnostic,
    DiagnosticSeverity,
    TextDocument
} from 'vscode-languageserver/node';
import { TokenType, Token } from '../lexer';

function isStringToken(token: Token): boolean {
    return token.type === TokenType.TK_STRING;
}

export function validateUtilityFunctions(textDocument: TextDocument, tokens: Token[], diagnostics: Diagnostic[]): void {
    for (let i = 0; i < tokens.length - 2; i++) {
        const funcToken = tokens[i];
        const parenToken = tokens[i + 1];
        
        if (funcToken && parenToken &&
            funcToken.type === TokenType.TK_LABEL &&
            typeof funcToken.value === 'string' &&
            parenToken.type === TokenType.TK_LPAREN) {
            
            // Handle min function: min(...numbers)
            if (funcToken.value === 'min') {
                // Check all parameters from i+2 until we hit RPAREN
                let paramIndex = i + 2;
                while (paramIndex < tokens.length && tokens[paramIndex]?.type !== TokenType.TK_RPAREN) {
                    const paramToken = tokens[paramIndex];
                    if (paramToken && isStringToken(paramToken)) {
                        const diagnostic: Diagnostic = {
                            severity: DiagnosticSeverity.Error,
                            range: {
                                start: textDocument.positionAt(paramToken.pos),
                                end: textDocument.positionAt(paramToken.end)
                            },
                            message: `min() parameters should be numbers, not strings.`,
                            source: 'ucode'
                        };
                        diagnostics.push(diagnostic);
                    }
                    paramIndex++;
                    // Skip comma tokens
                    if (paramIndex < tokens.length && tokens[paramIndex]?.type === TokenType.TK_COMMA) {
                        paramIndex++;
                    }
                }
            }
            
            // Handle max function: max(...numbers)
            if (funcToken.value === 'max') {
                // Check all parameters from i+2 until we hit RPAREN
                let paramIndex = i + 2;
                while (paramIndex < tokens.length && tokens[paramIndex]?.type !== TokenType.TK_RPAREN) {
                    const paramToken = tokens[paramIndex];
                    if (paramToken && isStringToken(paramToken)) {
                        const diagnostic: Diagnostic = {
                            severity: DiagnosticSeverity.Error,
                            range: {
                                start: textDocument.positionAt(paramToken.pos),
                                end: textDocument.positionAt(paramToken.end)
                            },
                            message: `max() parameters should be numbers, not strings.`,
                            source: 'ucode'
                        };
                        diagnostics.push(diagnostic);
                    }
                    paramIndex++;
                    // Skip comma tokens
                    if (paramIndex < tokens.length && tokens[paramIndex]?.type === TokenType.TK_COMMA) {
                        paramIndex++;
                    }
                }
            }
            
            // Handle uniq function: uniq(array)
            if (funcToken.value === 'uniq') {
                const firstParamToken = tokens[i + 2];
                if (firstParamToken && isStringToken(firstParamToken)) {
                    const diagnostic: Diagnostic = {
                        severity: DiagnosticSeverity.Error,
                        range: {
                            start: textDocument.positionAt(firstParamToken.pos),
                            end: textDocument.positionAt(firstParamToken.end)
                        },
                        message: `uniq() parameter should be an array, not a string.`,
                        source: 'ucode'
                    };
                    diagnostics.push(diagnostic);
                }
            }
        }
    }
}