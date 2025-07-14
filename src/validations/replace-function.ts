import {
    Diagnostic,
    DiagnosticSeverity,
    TextDocument
} from 'vscode-languageserver/node';
import { TokenType, Token } from '../lexer';

export function validateReplaceFunction(textDocument: TextDocument, tokens: Token[], diagnostics: Diagnostic[]): void {
    for (let i = 0; i < tokens.length - 6; i++) {
        const funcToken = tokens[i];
        const parenToken = tokens[i + 1];
        
        if (funcToken && parenToken &&
            funcToken.type === TokenType.TK_LABEL &&
            funcToken.value === 'replace' &&
            parenToken.type === TokenType.TK_LPAREN) {
            
            // Check first parameter (should be string)
            const firstParamToken = tokens[i + 2];
            if (firstParamToken && firstParamToken.type === TokenType.TK_NUMBER) {
                const diagnostic: Diagnostic = {
                    severity: DiagnosticSeverity.Error,
                    range: {
                        start: textDocument.positionAt(firstParamToken.pos),
                        end: textDocument.positionAt(firstParamToken.end)
                    },
                    message: `replace() first parameter should be a string, not a number. Use replace(string, search, replacement).`,
                    source: 'ucode'
                };
                diagnostics.push(diagnostic);
            }
            
            // Check second parameter (should be string or regex)
            const commaToken1 = tokens[i + 3];
            const secondParamToken = tokens[i + 4];
            if (commaToken1 && secondParamToken &&
                commaToken1.type === TokenType.TK_COMMA &&
                secondParamToken.type === TokenType.TK_NUMBER) {
                
                const diagnostic: Diagnostic = {
                    severity: DiagnosticSeverity.Error,
                    range: {
                        start: textDocument.positionAt(secondParamToken.pos),
                        end: textDocument.positionAt(secondParamToken.end)
                    },
                    message: `replace() second parameter should be a string or regex, not a number.`,
                    source: 'ucode'
                };
                diagnostics.push(diagnostic);
            }
            
            // Check third parameter (should be string)
            const commaToken2 = tokens[i + 5];
            const thirdParamToken = tokens[i + 6];
            if (commaToken2 && thirdParamToken &&
                commaToken2.type === TokenType.TK_COMMA &&
                thirdParamToken.type === TokenType.TK_NUMBER) {
                
                const diagnostic: Diagnostic = {
                    severity: DiagnosticSeverity.Error,
                    range: {
                        start: textDocument.positionAt(thirdParamToken.pos),
                        end: textDocument.positionAt(thirdParamToken.end)
                    },
                    message: `replace() third parameter should be a string, not a number.`,
                    source: 'ucode'
                };
                diagnostics.push(diagnostic);
            }
        }
    }
}