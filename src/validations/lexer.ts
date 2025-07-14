import {
    Diagnostic,
    DiagnosticSeverity,
    TextDocument
} from 'vscode-languageserver/node';
import { UcodeLexer, TokenType } from '../lexer';
import { validateMethodCalls } from './method-calls';
import { validateVariableDeclarations } from './variable-declarations';
import { validateConstReassignments } from './const-reassignments';
import { validateSubstrParametersSimple } from './substr-parameters';
import { validateWithRegex } from './regex';

export function validateWithLexer(textDocument: TextDocument, connection: any): Diagnostic[] {
    const text = textDocument.getText();
    const diagnostics: Diagnostic[] = [];
    
    connection.sendNotification('window/showMessage', {
        type: 1,
        message: `DEBUG: validateWithLexer called - text contains substr: ${text.includes('substr')}`
    });
    
    try {
        const lexer = new UcodeLexer(text, { rawMode: true });
        const tokens = lexer.tokenize();
        
        connection.sendNotification('window/showMessage', {
            type: 1,
            message: `DEBUG: Lexer generated ${tokens.length} tokens`
        });
        
        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            if (token && token.type === TokenType.TK_LABEL) {
                connection.sendNotification('window/showMessage', {
                    type: 1,
                    message: `DEBUG: LABEL token ${i}: "${token.value}" at ${token.pos}-${token.end}`
                });
            }
        }
        
        for (const token of tokens) {
            if (token.type === TokenType.TK_ERROR) {
                const diagnostic: Diagnostic = {
                    severity: DiagnosticSeverity.Error,
                    range: {
                        start: textDocument.positionAt(token.pos),
                        end: textDocument.positionAt(token.end)
                    },
                    message: `Syntax error: ${token.value || 'Invalid token'}`,
                    source: 'ucode-lexer'
                };
                diagnostics.push(diagnostic);
            }
        }
        
        validateMethodCalls(textDocument, tokens, diagnostics);
        validateVariableDeclarations(textDocument, tokens, diagnostics);
        validateConstReassignments(textDocument, tokens, diagnostics);
        
        connection.sendNotification('window/showMessage', {
            type: 1,
            message: `DEBUG: About to call validateSubstrParametersSimple`
        });
        validateSubstrParametersSimple(textDocument, tokens, diagnostics, connection);
        connection.sendNotification('window/showMessage', {
            type: 1,
            message: `DEBUG: validateSubstrParametersSimple completed`
        });
        
    } catch (error) {
        connection.console.log(`Lexer failed with error: ${error}`);
        return validateWithRegex(textDocument, connection);
    }
    
    return diagnostics;
}