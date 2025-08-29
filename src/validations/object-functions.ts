import {
    Diagnostic,
    DiagnosticSeverity
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { TokenType, Token } from '../lexer';
import { UcodeErrorCode } from '../analysis/errorConstants';

function isNumericToken(token: Token): boolean {
    return token.type === TokenType.TK_NUMBER || token.type === TokenType.TK_DOUBLE;
}

export function validateObjectFunctions(textDocument: TextDocument, tokens: Token[], diagnostics: Diagnostic[]): void {
    for (let i = 0; i < tokens.length - 2; i++) {
        const funcToken = tokens[i];
        const parenToken = tokens[i + 1];
        
        if (funcToken && parenToken &&
            funcToken.type === TokenType.TK_LABEL &&
            typeof funcToken.value === 'string' &&
            parenToken.type === TokenType.TK_LPAREN) {
            
            // Handle keys function: keys(object)
            if (funcToken.value === 'keys') {
                const firstParamToken = tokens[i + 2];
                if (firstParamToken && 
                    (isNumericToken(firstParamToken) || 
                     firstParamToken.type === TokenType.TK_STRING)) {
                    
                    const diagnostic: Diagnostic = {
                        severity: DiagnosticSeverity.Error,
                        code: UcodeErrorCode.INVALID_PARAMETER_TYPE,
                        range: {
                            start: textDocument.positionAt(firstParamToken.pos),
                            end: textDocument.positionAt(firstParamToken.end)
                        },
                        message: `keys() parameter should be an object, not a ${firstParamToken.type === TokenType.TK_NUMBER ? 'number' : 'string'}.`,
                        source: 'ucode'
                    };
                    diagnostics.push(diagnostic);
                }
            }
            
            // Handle values function: values(object)
            if (funcToken.value === 'values') {
                const firstParamToken = tokens[i + 2];
                if (firstParamToken && 
                    (isNumericToken(firstParamToken) || 
                     firstParamToken.type === TokenType.TK_STRING)) {
                    
                    const diagnostic: Diagnostic = {
                        severity: DiagnosticSeverity.Error,
                        code: UcodeErrorCode.INVALID_PARAMETER_TYPE,
                        range: {
                            start: textDocument.positionAt(firstParamToken.pos),
                            end: textDocument.positionAt(firstParamToken.end)
                        },
                        message: `values() parameter should be an object, not a ${firstParamToken.type === TokenType.TK_NUMBER ? 'number' : 'string'}.`,
                        source: 'ucode'
                    };
                    diagnostics.push(diagnostic);
                }
            }
            
            // Handle exists function: exists(object, key)
            if (funcToken.value === 'exists') {
                validateExistsFunction(textDocument, tokens, diagnostics, i);
            }
        }
    }
}

function validateExistsFunction(textDocument: TextDocument, tokens: Token[], diagnostics: Diagnostic[], startIndex: number): void {
    // exists(object, key) - first param should be object, second should be string
    const firstParamToken = tokens[startIndex + 2];
    if (firstParamToken && 
        (isNumericToken(firstParamToken) || 
         firstParamToken.type === TokenType.TK_STRING)) {
        
        const diagnostic: Diagnostic = {
            severity: DiagnosticSeverity.Error,
            code: UcodeErrorCode.INVALID_PARAMETER_TYPE,
            range: {
                start: textDocument.positionAt(firstParamToken.pos),
                end: textDocument.positionAt(firstParamToken.end)
            },
            message: `exists() first parameter should be an object, not a ${firstParamToken.type === TokenType.TK_NUMBER ? 'number' : 'string'}.`,
            source: 'ucode'
        };
        diagnostics.push(diagnostic);
    }
    
    // Check second parameter (should be string key)
    const commaToken = tokens[startIndex + 3];
    const secondParamToken = tokens[startIndex + 4];
    
    if (commaToken && secondParamToken &&
        commaToken.type === TokenType.TK_COMMA &&
        isNumericToken(secondParamToken)) {
        
        const diagnostic: Diagnostic = {
            severity: DiagnosticSeverity.Error,
            code: UcodeErrorCode.INVALID_PARAMETER_TYPE,
            range: {
                start: textDocument.positionAt(secondParamToken.pos),
                end: textDocument.positionAt(secondParamToken.end)
            },
            message: `exists() second parameter (key) should be a string, not a number.`,
            source: 'ucode'
        };
        diagnostics.push(diagnostic);
    }
}