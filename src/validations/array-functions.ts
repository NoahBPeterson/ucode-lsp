import {
    Diagnostic,
    DiagnosticSeverity,
    TextDocument
} from 'vscode-languageserver/node';
import { TokenType, Token } from '../lexer';

export function validateArrayFunctions(textDocument: TextDocument, tokens: Token[], diagnostics: Diagnostic[]): void {
    // Functions that expect arrays as first parameter
    const arrayFunctions = ['push', 'pop', 'shift', 'unshift', 'slice', 'splice', 'sort', 'reverse'];
    
    // Special case: join has reversed parameters: join(separator, array)
    const joinFunction = 'join';
    
    for (let i = 0; i < tokens.length - 2; i++) {
        const funcToken = tokens[i];
        const parenToken = tokens[i + 1];
        
        if (funcToken && parenToken &&
            funcToken.type === TokenType.TK_LABEL &&
            typeof funcToken.value === 'string' &&
            parenToken.type === TokenType.TK_LPAREN) {
            
            // Handle regular array functions (array as first parameter)
            if (arrayFunctions.includes(funcToken.value)) {
                const firstParamToken = tokens[i + 2];
                if (firstParamToken && 
                    (firstParamToken.type === TokenType.TK_NUMBER || 
                     firstParamToken.type === TokenType.TK_STRING)) {
                    
                    const diagnostic: Diagnostic = {
                        severity: DiagnosticSeverity.Error,
                        range: {
                            start: textDocument.positionAt(firstParamToken.pos),
                            end: textDocument.positionAt(firstParamToken.end)
                        },
                        message: `${funcToken.value}() first parameter should be an array, not a ${firstParamToken.type === TokenType.TK_NUMBER ? 'number' : 'string'}.`,
                        source: 'ucode'
                    };
                    diagnostics.push(diagnostic);
                }
            }
            
            // Handle join function: join(separator, array)
            if (funcToken.value === joinFunction) {
                // Check second parameter (should be array)
                const commaToken = tokens[i + 3];
                const secondParamToken = tokens[i + 4];
                if (commaToken && secondParamToken &&
                    commaToken.type === TokenType.TK_COMMA &&
                    (secondParamToken.type === TokenType.TK_NUMBER || 
                     secondParamToken.type === TokenType.TK_STRING)) {
                    
                    const diagnostic: Diagnostic = {
                        severity: DiagnosticSeverity.Error,
                        range: {
                            start: textDocument.positionAt(secondParamToken.pos),
                            end: textDocument.positionAt(secondParamToken.end)
                        },
                        message: `join() second parameter should be an array, not a ${secondParamToken.type === TokenType.TK_NUMBER ? 'number' : 'string'}. Note: uCode uses join(separator, array).`,
                        source: 'ucode'
                    };
                    diagnostics.push(diagnostic);
                }
            }
            
            // Special validations for specific functions
            if (funcToken.value === 'slice') {
                validateSliceParameters(textDocument, tokens, diagnostics, i);
            } else if (funcToken.value === 'splice') {
                validateSpliceParameters(textDocument, tokens, diagnostics, i);
            }
        }
    }
}

function validateSliceParameters(textDocument: TextDocument, tokens: Token[], diagnostics: Diagnostic[], startIndex: number): void {
    // slice(array, start, end?) - start and end should be numbers
    const commaToken1 = tokens[startIndex + 3];
    const secondParamToken = tokens[startIndex + 4];
    
    if (commaToken1 && secondParamToken &&
        commaToken1.type === TokenType.TK_COMMA &&
        secondParamToken.type === TokenType.TK_STRING) {
        
        const diagnostic: Diagnostic = {
            severity: DiagnosticSeverity.Error,
            range: {
                start: textDocument.positionAt(secondParamToken.pos),
                end: textDocument.positionAt(secondParamToken.end)
            },
            message: `slice() second parameter (start index) should be a number, not a string.`,
            source: 'ucode'
        };
        diagnostics.push(diagnostic);
    }
    
    // Check third parameter if it exists
    const commaToken2 = tokens[startIndex + 5];
    const thirdParamToken = tokens[startIndex + 6];
    
    if (commaToken2 && thirdParamToken &&
        commaToken2.type === TokenType.TK_COMMA &&
        thirdParamToken.type === TokenType.TK_STRING) {
        
        const diagnostic: Diagnostic = {
            severity: DiagnosticSeverity.Error,
            range: {
                start: textDocument.positionAt(thirdParamToken.pos),
                end: textDocument.positionAt(thirdParamToken.end)
            },
            message: `slice() third parameter (end index) should be a number, not a string.`,
            source: 'ucode'
        };
        diagnostics.push(diagnostic);
    }
}

function validateSpliceParameters(textDocument: TextDocument, tokens: Token[], diagnostics: Diagnostic[], startIndex: number): void {
    // splice(array, start, deleteCount?, ...items) - start and deleteCount should be numbers
    const commaToken1 = tokens[startIndex + 3];
    const secondParamToken = tokens[startIndex + 4];
    
    if (commaToken1 && secondParamToken &&
        commaToken1.type === TokenType.TK_COMMA &&
        secondParamToken.type === TokenType.TK_STRING) {
        
        const diagnostic: Diagnostic = {
            severity: DiagnosticSeverity.Error,
            range: {
                start: textDocument.positionAt(secondParamToken.pos),
                end: textDocument.positionAt(secondParamToken.end)
            },
            message: `splice() second parameter (start index) should be a number, not a string.`,
            source: 'ucode'
        };
        diagnostics.push(diagnostic);
    }
    
    // Check third parameter (deleteCount) if it exists
    const commaToken2 = tokens[startIndex + 5];
    const thirdParamToken = tokens[startIndex + 6];
    
    if (commaToken2 && thirdParamToken &&
        commaToken2.type === TokenType.TK_COMMA &&
        thirdParamToken.type === TokenType.TK_STRING) {
        
        const diagnostic: Diagnostic = {
            severity: DiagnosticSeverity.Error,
            range: {
                start: textDocument.positionAt(thirdParamToken.pos),
                end: textDocument.positionAt(thirdParamToken.end)
            },
            message: `splice() third parameter (delete count) should be a number, not a string.`,
            source: 'ucode'
        };
        diagnostics.push(diagnostic);
    }
}