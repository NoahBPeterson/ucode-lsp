import {
    Diagnostic,
    DiagnosticSeverity
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { TokenType, Token } from '../lexer';

function isNumericToken(token: Token): boolean {
    return token.type === TokenType.TK_NUMBER || token.type === TokenType.TK_DOUBLE;
}

export function validateNumberConversions(textDocument: TextDocument, tokens: Token[], diagnostics: Diagnostic[]): void {
    for (let i = 0; i < tokens.length - 2; i++) {
        const funcToken = tokens[i];
        const parenToken = tokens[i + 1];
        
        if (funcToken && parenToken &&
            funcToken.type === TokenType.TK_LABEL &&
            typeof funcToken.value === 'string' &&
            parenToken.type === TokenType.TK_LPAREN) {
            
            // Handle hex function: hex(number)
            if (funcToken.value === 'hex') {
                const firstParamToken = tokens[i + 2];
                if (firstParamToken && firstParamToken.type === TokenType.TK_STRING) {
                    const diagnostic: Diagnostic = {
                        severity: DiagnosticSeverity.Error,
                        range: {
                            start: textDocument.positionAt(firstParamToken.pos),
                            end: textDocument.positionAt(firstParamToken.end)
                        },
                        message: `hex() parameter should be a number, not a string.`,
                        source: 'ucode'
                    };
                    diagnostics.push(diagnostic);
                }
            }
            
            // Handle int function: int(string/number) - accepts both, but we can warn about obvious errors
            // For now, we won't validate int() since it legitimately accepts multiple types
            
            // Handle hexdec function: hexdec(string)
            if (funcToken.value === 'hexdec') {
                const firstParamToken = tokens[i + 2];
                if (firstParamToken && isNumericToken(firstParamToken)) {
                    const diagnostic: Diagnostic = {
                        severity: DiagnosticSeverity.Error,
                        range: {
                            start: textDocument.positionAt(firstParamToken.pos),
                            end: textDocument.positionAt(firstParamToken.end)
                        },
                        message: `hexdec() parameter should be a hex string, not a number.`,
                        source: 'ucode'
                    };
                    diagnostics.push(diagnostic);
                }
            }
            
            // Handle hexenc function: hexenc(string)
            if (funcToken.value === 'hexenc') {
                const firstParamToken = tokens[i + 2];
                if (firstParamToken && isNumericToken(firstParamToken)) {
                    const diagnostic: Diagnostic = {
                        severity: DiagnosticSeverity.Error,
                        range: {
                            start: textDocument.positionAt(firstParamToken.pos),
                            end: textDocument.positionAt(firstParamToken.end)
                        },
                        message: `hexenc() parameter should be a string, not a number.`,
                        source: 'ucode'
                    };
                    diagnostics.push(diagnostic);
                }
            }
            
            // Handle b64enc function: b64enc(string)
            if (funcToken.value === 'b64enc') {
                const firstParamToken = tokens[i + 2];
                if (firstParamToken && isNumericToken(firstParamToken)) {
                    const diagnostic: Diagnostic = {
                        severity: DiagnosticSeverity.Error,
                        range: {
                            start: textDocument.positionAt(firstParamToken.pos),
                            end: textDocument.positionAt(firstParamToken.end)
                        },
                        message: `b64enc() parameter should be a string, not a number.`,
                        source: 'ucode'
                    };
                    diagnostics.push(diagnostic);
                }
            }
            
            // Handle b64dec function: b64dec(string)
            if (funcToken.value === 'b64dec') {
                const firstParamToken = tokens[i + 2];
                if (firstParamToken && isNumericToken(firstParamToken)) {
                    const diagnostic: Diagnostic = {
                        severity: DiagnosticSeverity.Error,
                        range: {
                            start: textDocument.positionAt(firstParamToken.pos),
                            end: textDocument.positionAt(firstParamToken.end)
                        },
                        message: `b64dec() parameter should be a base64 string, not a number.`,
                        source: 'ucode'
                    };
                    diagnostics.push(diagnostic);
                }
            }
        }
    }
}