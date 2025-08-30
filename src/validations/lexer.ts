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
import { validateSystemFunctions } from './system-functions';
import { validateUtilityFunctions } from './utility-functions';
import { validateNetworkFunctions } from './network-functions';
import { validateConversionFunctions } from './conversion-functions';
import { validateModuleFunctions } from './module-functions';
import { validateRemainingUtilityFunctions } from './remaining-utility-functions';
import { validateJSONUtilityFunctions } from './json-utility-functions';
import { validateSystemUtilityFunctions } from './system-utility-functions';
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
        validateSystemFunctions(textDocument, tokens, diagnostics);
        validateUtilityFunctions(textDocument, tokens, diagnostics);
        validateNetworkFunctions(textDocument, tokens, diagnostics);
        validateConversionFunctions(textDocument, tokens, diagnostics);
        validateModuleFunctions(textDocument, tokens, diagnostics);
        validateRemainingUtilityFunctions(textDocument, tokens, diagnostics);
        validateJSONUtilityFunctions(textDocument, tokens, diagnostics);
        validateSystemUtilityFunctions(textDocument, tokens, diagnostics);
        
    } catch (error) {
        connection.console.log(`Lexer failed with error: ${error}`);
        // If lexer fails, return empty diagnostics - let the parser/semantic analyzer handle it
        return [];
    }
    
    return diagnostics;
}