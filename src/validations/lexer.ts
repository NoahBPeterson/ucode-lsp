import {
    Diagnostic,
    DiagnosticSeverity
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { UcodeLexer, TokenType } from '../lexer';
import { validateMethodCalls } from './method-calls';
import { validateVariableDeclarations } from './variable-declarations';
import { validateConstReassignments } from './const-reassignments';
import { validateSubstrParametersSimple } from './substr-parameters';
import { validateConversionFunctions } from './conversion-functions';
import { UcodeErrorCode } from '../analysis/errorConstants';

export function validateWithLexer(textDocument: TextDocument, connection: any): Diagnostic[] {
    const text = textDocument.getText();
    const diagnostics: Diagnostic[] = [];
    
    try {
        const lexer = new UcodeLexer(text, { rawMode: true });
        const tokens = lexer.tokenize();
        
        for (const token of tokens) {
            if (token.type === TokenType.TK_ERROR) {
                const diagnostic: Diagnostic = {
                    severity: DiagnosticSeverity.Error,
                    code: UcodeErrorCode.UNEXPECTED_TOKEN,
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
        validateSubstrParametersSimple(textDocument, tokens, diagnostics);
        
        validateConversionFunctions(textDocument, tokens, diagnostics);
        
    } catch (error) {
        connection.console.log(`Lexer failed with error: ${error}`);
        // If lexer fails, return empty diagnostics - let the parser/semantic analyzer handle it
        return [];
    }
    
    return diagnostics;
}