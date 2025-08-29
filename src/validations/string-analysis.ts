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

export function validateStringAnalysisFunctions(textDocument: TextDocument, tokens: Token[], diagnostics: Diagnostic[]): void {
    for (let i = 0; i < tokens.length - 2; i++) {
        const funcToken = tokens[i];
        const parenToken = tokens[i + 1];
        
        if (funcToken && parenToken &&
            funcToken.type === TokenType.TK_LABEL &&
            typeof funcToken.value === 'string' &&
            parenToken.type === TokenType.TK_LPAREN) {
            
            // Handle length function (accepts string, array, or object)
            if (funcToken.value === 'length') {
                const firstParamToken = tokens[i + 2];
                if (firstParamToken && isNumericToken(firstParamToken)) {
                    const diagnostic: Diagnostic = {
                        severity: DiagnosticSeverity.Error,
                        code: UcodeErrorCode.INVALID_PARAMETER_TYPE,
                        range: {
                            start: textDocument.positionAt(firstParamToken.pos),
                            end: textDocument.positionAt(firstParamToken.end)
                        },
                        message: `length() parameter should be a string, array, or object, not a number.`,
                        source: 'ucode'
                    };
                    diagnostics.push(diagnostic);
                }
            }
            
            // Handle match function: match(string, regex)
            if (funcToken.value === 'match') {
                validateMatchFunction(textDocument, tokens, diagnostics, i);
            }
            
            // Handle index function: index(haystack, needle)
            if (funcToken.value === 'index') {
                const firstParamToken = tokens[i + 2];
                if (firstParamToken && isNumericToken(firstParamToken)) {
                    const diagnostic: Diagnostic = {
                        severity: DiagnosticSeverity.Error,
                        code: UcodeErrorCode.INVALID_PARAMETER_TYPE,
                        range: {
                            start: textDocument.positionAt(firstParamToken.pos),
                            end: textDocument.positionAt(firstParamToken.end)
                        },
                        message: `index() first parameter (haystack) should be a string or array, not a number.`,
                        source: 'ucode'
                    };
                    diagnostics.push(diagnostic);
                }
            }
            
            // Handle rindex function: rindex(string, needle)
            if (funcToken.value === 'rindex') {
                const firstParamToken = tokens[i + 2];
                if (firstParamToken &&
                    firstParamToken.type !== TokenType.TK_STRING &&
                    firstParamToken.type !== TokenType.TK_LABEL
                ) {
                    const diagnostic: Diagnostic = {
                        severity: DiagnosticSeverity.Error,
                        code: UcodeErrorCode.INVALID_PARAMETER_TYPE,
                        range: {
                            start: textDocument.positionAt(firstParamToken.pos),
                            end: textDocument.positionAt(firstParamToken.end)
                        },
                        message: `rindex() first parameter should be a string.`,
                        source: 'ucode'
                    };
                    diagnostics.push(diagnostic);
                }
            }
        }
    }
}

function validateMatchFunction(textDocument: TextDocument, tokens: Token[], diagnostics: Diagnostic[], startIndex: number): void {
    // match(string, regex) - first param should be string
    const firstParamToken = tokens[startIndex + 2];
    if (firstParamToken && 
        firstParamToken.type !== TokenType.TK_STRING &&
        firstParamToken.type !== TokenType.TK_LABEL
    ) {
        const diagnostic: Diagnostic = {
            severity: DiagnosticSeverity.Error,
            code: UcodeErrorCode.INVALID_PARAMETER_TYPE,
            range: {
                start: textDocument.positionAt(firstParamToken.pos),
                end: textDocument.positionAt(firstParamToken.end)
            },
            message: `match() first parameter should be a string.`,
            source: 'ucode'
        };
        diagnostics.push(diagnostic);
    }
    
    // Second parameter should be regex (we can't easily validate regex literals, but we can catch obvious errors)
    const commaToken = tokens[startIndex + 3];
    const secondParamToken = tokens[startIndex + 4];
    if (commaToken && secondParamToken &&
        commaToken.type === TokenType.TK_COMMA &&
        secondParamToken.type !== TokenType.TK_STRING &&
        secondParamToken.type !== TokenType.TK_REGEXP &&
        secondParamToken.type !== TokenType.TK_LABEL
    ) {
        
        const diagnostic: Diagnostic = {
            severity: DiagnosticSeverity.Error,
            code: UcodeErrorCode.INVALID_PARAMETER_TYPE,
            range: {
                start: textDocument.positionAt(secondParamToken.pos),
                end: textDocument.positionAt(secondParamToken.end)
            },
            message: `match() second parameter should be a regex or string pattern.`,
            source: 'ucode'
        };
        diagnostics.push(diagnostic);
    }
}