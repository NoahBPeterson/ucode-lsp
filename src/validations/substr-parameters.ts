import {
    Diagnostic,
    DiagnosticSeverity
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { TokenType, Token } from '../lexer';
import { UcodeErrorCode } from '../analysis/errorConstants';

export function validateSubstrParametersSimple(textDocument: TextDocument, tokens: Token[], diagnostics: Diagnostic[]): void {
    for (let i = 0; i < tokens.length - 6; i++) {
        const funcToken = tokens[i];
        const parenToken = tokens[i + 1];
        
        if (funcToken && parenToken &&
            funcToken.type === TokenType.TK_LABEL &&
            funcToken.value === 'substr' &&
            parenToken.type === TokenType.TK_LPAREN) {
            
            const firstParamToken = tokens[i + 2];
            if (firstParamToken && firstParamToken.type === TokenType.TK_NUMBER) {
                
                const diagnostic: Diagnostic = {
                    severity: DiagnosticSeverity.Error,
                    range: {
                        start: textDocument.positionAt(firstParamToken.pos),
                        end: textDocument.positionAt(firstParamToken.end)
                    },
                    message: `substr() first parameter should be a string, not a number. Use substr(string, ${firstParamToken.value}).`,
                    source: 'ucode'
                };
                diagnostics.push(diagnostic);
            }
            
            const commaToken = tokens[i + 3];
            const secondParamToken = tokens[i + 4];
            if (commaToken && secondParamToken &&
                commaToken.type === TokenType.TK_COMMA &&
                secondParamToken.type === TokenType.TK_STRING) {
                
                const diagnostic: Diagnostic = {
                    severity: DiagnosticSeverity.Error,
                    code: UcodeErrorCode.INVALID_PARAMETER_TYPE,
                    range: {
                        start: textDocument.positionAt(secondParamToken.pos),
                        end: textDocument.positionAt(secondParamToken.end)
                    },
                    message: `substr() second parameter should be a number (start position), not a string.`,
                    source: 'ucode'
                };
                diagnostics.push(diagnostic);
            }
            
            const comma2Token = tokens[i + 5];
            const thirdParamToken = tokens[i + 6];
            if (comma2Token && thirdParamToken &&
                comma2Token.type === TokenType.TK_COMMA &&
                thirdParamToken.type === TokenType.TK_STRING) {
                
                const diagnostic: Diagnostic = {
                    severity: DiagnosticSeverity.Error,
                    code: UcodeErrorCode.INVALID_PARAMETER_TYPE,
                    range: {
                        start: textDocument.positionAt(thirdParamToken.pos),
                        end: textDocument.positionAt(thirdParamToken.end)
                    },
                    message: `substr() third parameter should be a number (length), not a string.`,
                    source: 'ucode'
                };
                diagnostics.push(diagnostic);
            }
        }
    }
}