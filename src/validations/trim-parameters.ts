import {
    Diagnostic,
    DiagnosticSeverity
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { TokenType, Token } from '../lexer';

export function validateTrimParameters(textDocument: TextDocument, tokens: Token[], diagnostics: Diagnostic[]): void {
    const trimFunctions = ['ltrim', 'rtrim', 'trim'];
    
    for (let i = 0; i < tokens.length - 2; i++) {
        const funcToken = tokens[i];
        const parenToken = tokens[i + 1];
        
        if (funcToken && parenToken &&
            funcToken.type === TokenType.TK_LABEL &&
            typeof funcToken.value === 'string' &&
            trimFunctions.includes(funcToken.value) &&
            parenToken.type === TokenType.TK_LPAREN) {
            
            const firstParamToken = tokens[i + 2];
            if (firstParamToken && firstParamToken.type === TokenType.TK_NUMBER) {
                const diagnostic: Diagnostic = {
                    severity: DiagnosticSeverity.Error,
                    range: {
                        start: textDocument.positionAt(firstParamToken.pos),
                        end: textDocument.positionAt(firstParamToken.end)
                    },
                    message: `${funcToken.value}() parameter should be a string, not a number. Use ${funcToken.value}(string) instead.`,
                    source: 'ucode'
                };
                diagnostics.push(diagnostic);
            }
        }
    }
}