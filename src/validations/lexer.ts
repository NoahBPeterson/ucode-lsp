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
import { validateTrimParameters } from './trim-parameters';
import { validateStringFunctions } from './string-functions';
import { validateCharacterFunctions } from './character-functions';
import { validateSplitFunction } from './split-function';
import { validateReplaceFunction } from './replace-function';
import { validateArrayFunctions } from './array-functions';
import { validateStringAnalysisFunctions } from './string-analysis';
import { validateObjectFunctions } from './object-functions';
import { validateNumberConversions } from './number-conversions';
import { validateIOFunctions } from './io-functions';
import { validateWithRegex } from './regex';

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
        validateTrimParameters(textDocument, tokens, diagnostics);
        validateStringFunctions(textDocument, tokens, diagnostics);
        validateCharacterFunctions(textDocument, tokens, diagnostics);
        validateSplitFunction(textDocument, tokens, diagnostics);
        validateReplaceFunction(textDocument, tokens, diagnostics);
        validateArrayFunctions(textDocument, tokens, diagnostics);
        validateStringAnalysisFunctions(textDocument, tokens, diagnostics);
        validateObjectFunctions(textDocument, tokens, diagnostics);
        validateNumberConversions(textDocument, tokens, diagnostics);
        validateIOFunctions(textDocument, tokens, diagnostics);
        
    } catch (error) {
        connection.console.log(`Lexer failed with error: ${error}`);
        return validateWithRegex(textDocument);
    }
    
    return diagnostics;
}