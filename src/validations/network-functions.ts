import {
    Diagnostic,
    DiagnosticSeverity
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { TokenType, Token } from '../lexer';
import { UcodeErrorCode } from '../analysis/errorConstants';

function isStringToken(token: Token): boolean {
    return token.type === TokenType.TK_STRING;
}

function isNumericToken(token: Token): boolean {
    return token.type === TokenType.TK_NUMBER || token.type === TokenType.TK_DOUBLE;
}

export function validateNetworkFunctions(textDocument: TextDocument, tokens: Token[], diagnostics: Diagnostic[]): void {
    for (let i = 0; i < tokens.length - 2; i++) {
        const funcToken = tokens[i];
        const parenToken = tokens[i + 1];
        
        if (funcToken && parenToken &&
            funcToken.type === TokenType.TK_LABEL &&
            typeof funcToken.value === 'string' &&
            parenToken.type === TokenType.TK_LPAREN) {
            
            // Handle iptoarr function: iptoarr(ip_string)
            if (funcToken.value === 'iptoarr') {
                const firstParamToken = tokens[i + 2];
                if (firstParamToken && isNumericToken(firstParamToken)) {
                    const diagnostic: Diagnostic = {
                        severity: DiagnosticSeverity.Error,
                        code: UcodeErrorCode.INVALID_PARAMETER_TYPE,
                        range: {
                            start: textDocument.positionAt(firstParamToken.pos),
                            end: textDocument.positionAt(firstParamToken.end)
                        },
                        message: `iptoarr() parameter should be an IP address string, not a number.`,
                        source: 'ucode'
                    };
                    diagnostics.push(diagnostic);
                }
            }
            
            // Handle arrtoip function: arrtoip(array)
            if (funcToken.value === 'arrtoip') {
                const firstParamToken = tokens[i + 2];
                if (firstParamToken && (isStringToken(firstParamToken) || isNumericToken(firstParamToken))) {
                    const diagnostic: Diagnostic = {
                        severity: DiagnosticSeverity.Error,
                        code: UcodeErrorCode.INVALID_PARAMETER_TYPE,
                        range: {
                            start: textDocument.positionAt(firstParamToken.pos),
                            end: textDocument.positionAt(firstParamToken.end)
                        },
                        message: `arrtoip() parameter should be an array of IP components, not a ${isStringToken(firstParamToken) ? 'string' : 'number'}.`,
                        source: 'ucode'
                    };
                    diagnostics.push(diagnostic);
                }
            }
        }
    }
}