import {
    Diagnostic,
    DiagnosticSeverity
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { TokenType, Token } from '../lexer';

function isStringToken(token: Token): boolean {
    return token.type === TokenType.TK_STRING;
}

function isNumericToken(token: Token): boolean {
    return token.type === TokenType.TK_NUMBER || token.type === TokenType.TK_DOUBLE;
}

export function validateDateTimeFunctions(textDocument: TextDocument, tokens: Token[], diagnostics: Diagnostic[]): void {
    for (let i = 0; i < tokens.length - 2; i++) {
        const funcToken = tokens[i];
        const parenToken = tokens[i + 1];
        
        if (funcToken && parenToken &&
            funcToken.type === TokenType.TK_LABEL &&
            typeof funcToken.value === 'string' &&
            parenToken.type === TokenType.TK_LPAREN) {
            
            // Handle localtime function: localtime(timestamp?)
            if (funcToken.value === 'localtime') {
                const firstParamToken = tokens[i + 2];
                // Only validate if there's a parameter and it's a string (should be number or empty)
                if (firstParamToken && 
                    firstParamToken.type !== TokenType.TK_RPAREN && 
                    isStringToken(firstParamToken)) {
                    const diagnostic: Diagnostic = {
                        severity: DiagnosticSeverity.Error,
                        range: {
                            start: textDocument.positionAt(firstParamToken.pos),
                            end: textDocument.positionAt(firstParamToken.end)
                        },
                        message: `localtime() parameter should be a timestamp (number), not a string.`,
                        source: 'ucode'
                    };
                    diagnostics.push(diagnostic);
                }
            }
            
            // Handle gmtime function: gmtime(timestamp?)
            if (funcToken.value === 'gmtime') {
                const firstParamToken = tokens[i + 2];
                // Only validate if there's a parameter and it's a string (should be number or empty)
                if (firstParamToken && 
                    firstParamToken.type !== TokenType.TK_RPAREN && 
                    isStringToken(firstParamToken)) {
                    const diagnostic: Diagnostic = {
                        severity: DiagnosticSeverity.Error,
                        range: {
                            start: textDocument.positionAt(firstParamToken.pos),
                            end: textDocument.positionAt(firstParamToken.end)
                        },
                        message: `gmtime() parameter should be a timestamp (number), not a string.`,
                        source: 'ucode'
                    };
                    diagnostics.push(diagnostic);
                }
            }
            
            // Handle timelocal function: timelocal(array)
            if (funcToken.value === 'timelocal') {
                const firstParamToken = tokens[i + 2];
                if (firstParamToken && (isStringToken(firstParamToken) || isNumericToken(firstParamToken))) {
                    const diagnostic: Diagnostic = {
                        severity: DiagnosticSeverity.Error,
                        range: {
                            start: textDocument.positionAt(firstParamToken.pos),
                            end: textDocument.positionAt(firstParamToken.end)
                        },
                        message: `timelocal() parameter should be an array of time components, not a ${isStringToken(firstParamToken) ? 'string' : 'number'}.`,
                        source: 'ucode'
                    };
                    diagnostics.push(diagnostic);
                }
            }
            
            // Handle timegm function: timegm(array)
            if (funcToken.value === 'timegm') {
                const firstParamToken = tokens[i + 2];
                if (firstParamToken && (isStringToken(firstParamToken) || isNumericToken(firstParamToken))) {
                    const diagnostic: Diagnostic = {
                        severity: DiagnosticSeverity.Error,
                        range: {
                            start: textDocument.positionAt(firstParamToken.pos),
                            end: textDocument.positionAt(firstParamToken.end)
                        },
                        message: `timegm() parameter should be an array of time components, not a ${isStringToken(firstParamToken) ? 'string' : 'number'}.`,
                        source: 'ucode'
                    };
                    diagnostics.push(diagnostic);
                }
            }
        }
    }
}