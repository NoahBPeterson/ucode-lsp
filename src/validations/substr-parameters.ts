import {
    Diagnostic,
    DiagnosticSeverity,
    TextDocument
} from 'vscode-languageserver/node';
import { TokenType, Token, UcodeLexer } from '../lexer';

export function validateSubstrParametersSimple(textDocument: TextDocument, tokens: Token[], diagnostics: Diagnostic[], connection: any): void {
    for (let i = 0; i < tokens.length - 6; i++) {
        const funcToken = tokens[i];
        const parenToken = tokens[i + 1];
        
        if (funcToken && parenToken &&
            funcToken.type === TokenType.TK_LABEL &&
            funcToken.value === 'substr' &&
            parenToken.type === TokenType.TK_LPAREN) {
            
            connection.sendNotification('window/showMessage', {
                type: 1,
                message: `DEBUG: Found substr at position ${funcToken.pos}-${funcToken.end}`
            });
            for (let j = i; j < Math.min(i + 10, tokens.length); j++) {
                const token = tokens[j];
                if (token) {
                    connection.sendNotification('window/showMessage', {
                        type: 1,
                        message: `DEBUG: Token ${j}: ${UcodeLexer.getTokenName(token.type)} = "${token.value}" at ${token.pos}-${token.end}`
                    });
                }
            }
            
            const firstParamToken = tokens[i + 2];
            if (firstParamToken && firstParamToken.type === TokenType.TK_NUMBER) {
                connection.console.log(`First param token: pos=${firstParamToken.pos}, end=${firstParamToken.end}, value=${firstParamToken.value}`);
                
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
                
                connection.sendNotification('window/showMessage', {
                    type: 1,
                    message: `DEBUG: Second param token: pos=${secondParamToken.pos}, end=${secondParamToken.end}, value="${secondParamToken.value}"`
                });
                connection.sendNotification('window/showMessage', {
                    type: 1,
                    message: `DEBUG: Text length: ${textDocument.getText().length}`
                });

                const diagnostic: Diagnostic = {
                    severity: DiagnosticSeverity.Error,
                    range: {
                        start: textDocument.positionAt(secondParamToken.pos),
                        end: textDocument.positionAt(secondParamToken.end)
                    },
                    message: `substr() second parameter should be a number (start position), not a string. defg`,
                    source: 'ucode'
                };
                diagnostics.push(diagnostic);
            }
            
            const comma2Token = tokens[i + 5];
            const thirdParamToken = tokens[i + 6];
            if (comma2Token && thirdParamToken &&
                comma2Token.type === TokenType.TK_COMMA &&
                thirdParamToken.type === TokenType.TK_STRING) {
                
                connection.console.log(`Third param token: pos=${thirdParamToken.pos}, end=${thirdParamToken.end}, value="${thirdParamToken.value}"`);
                
                const diagnostic: Diagnostic = {
                    severity: DiagnosticSeverity.Error,
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