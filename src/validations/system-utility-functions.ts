import {
    Diagnostic
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Token } from '../lexer';

export function validateSystemUtilityFunctions(_textDocument: TextDocument, _tokens: Token[], _diagnostics: Diagnostic[]): void {
    // Note: All system utility functions either accept any type or have no parameters,
    // so no type validation is actually needed. This function exists for completeness
    // and future extensibility if these functions gain parameter validation requirements.
    
    // Functions covered:
    // - type(any) - accepts any type, no validation needed
    // - print(...any) - accepts any types, no validation needed  
    // - time() - no parameters, no validation needed
    // - clock() - no parameters, no validation needed
    // - sourcepath() - no parameters, no validation needed
    // - gc() - no parameters, no validation needed
}