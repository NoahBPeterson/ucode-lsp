import {
    Diagnostic,
    DiagnosticSeverity,
    TextDocument
} from 'vscode-languageserver/node';
import { TokenType, Token } from '../lexer';

export function validateSplitFunction(textDocument: TextDocument, tokens: Token[], diagnostics: Diagnostic[]): void {
    for (let i = 0; i < tokens.length - 4; i++) {
        const funcToken = tokens[i];
        const parenToken = tokens[i + 1];
        
        if (funcToken && parenToken &&
            funcToken.type === TokenType.TK_LABEL &&
            funcToken.value === 'split' &&
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
                    message: `split() first parameter should be a string, not a number. Use split(string, separator).`,
                    source: 'ucode'
                };
                diagnostics.push(diagnostic);
            }
            
            // Check second parameter (should be string or regex)
            const commaToken = tokens[i + 3];
            const secondParamToken = tokens[i + 4];
            if (commaToken && secondParamToken &&
                commaToken.type === TokenType.TK_COMMA &&
                secondParamToken.type === TokenType.TK_NUMBER) {
                
                const diagnostic: Diagnostic = {
                    severity: DiagnosticSeverity.Error,
                    range: {
                        start: textDocument.positionAt(secondParamToken.pos),
                        end: textDocument.positionAt(secondParamToken.end)
                    },
                    message: `split() second parameter should be a string or regex, not a number.`,
                    source: 'ucode'
                };
                diagnostics.push(diagnostic);
            }
        }
    }
}