import {
    Diagnostic,
    DiagnosticSeverity
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { TokenType, Token } from '../lexer';

export function validateCharacterFunctions(textDocument: TextDocument, tokens: Token[], diagnostics: Diagnostic[]): void {
    // Functions that expect numbers
    const numberFunctions = ['chr', 'uchr'];
    // Functions that expect strings
    const stringFunctions = ['ord'];
    
    for (let i = 0; i < tokens.length - 2; i++) {
        const funcToken = tokens[i];
        const parenToken = tokens[i + 1];
        
        if (funcToken && parenToken &&
            funcToken.type === TokenType.TK_LABEL &&
            typeof funcToken.value === 'string' &&
            parenToken.type === TokenType.TK_LPAREN) {
            
            const firstParamToken = tokens[i + 2];
            
            // Check functions that should have number parameters
            if (numberFunctions.includes(funcToken.value)) {
                if (firstParamToken && firstParamToken.type === TokenType.TK_STRING) {
                    const diagnostic: Diagnostic = {
                        severity: DiagnosticSeverity.Error,
                        range: {
                            start: textDocument.positionAt(firstParamToken.pos),
                            end: textDocument.positionAt(firstParamToken.end)
                        },
                        message: `${funcToken.value}() parameter should be a number, not a string. Use ${funcToken.value}(number) instead.`,
                        source: 'ucode'
                    };
                    diagnostics.push(diagnostic);
                }
            }
            
            // Check functions that should have string parameters
            if (stringFunctions.includes(funcToken.value)) {
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
}