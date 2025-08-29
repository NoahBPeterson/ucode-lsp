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

function isArrayToken(token: Token): boolean {
    return token.type === TokenType.TK_LBRACK;
}

function isObjectToken(token: Token): boolean {
    return token.type === TokenType.TK_LBRACE;
}

export function validateModuleFunctions(textDocument: TextDocument, tokens: Token[], diagnostics: Diagnostic[]): void {
    for (let i = 0; i < tokens.length - 2; i++) {
        const funcToken = tokens[i];
        const parenToken = tokens[i + 1];
        
        if (funcToken && parenToken &&
            funcToken.type === TokenType.TK_LABEL &&
            typeof funcToken.value === 'string' &&
            parenToken.type === TokenType.TK_LPAREN) {
            
            const moduleFunctions = ['require', 'include', 'loadstring', 'loadfile'];
            
            if (moduleFunctions.includes(funcToken.value)) {
                const firstParamToken = tokens[i + 2];
                
                if (firstParamToken && (isNumericToken(firstParamToken) || isArrayToken(firstParamToken) || isObjectToken(firstParamToken))) {
                    let paramType = 'number';
                    let endToken = firstParamToken;
                    
                    if (isArrayToken(firstParamToken)) {
                        paramType = 'array';
                        // Find the matching closing bracket for full range
                        let depth = 1;
                        let j = i + 3;
                        while (j < tokens.length && depth > 0) {
                            const token = tokens[j];
                            if (token?.type === TokenType.TK_LBRACK) {
                                depth++;
                            } else if (token?.type === TokenType.TK_RBRACK) {
                                depth--;
                                if (depth === 0) {
                                    endToken = token;
                                    break;
                                }
                            }
                            j++;
                        }
                    } else if (isObjectToken(firstParamToken)) {
                        paramType = 'object';
                        // Find the matching closing brace for full range
                        let depth = 1;
                        let j = i + 3;
                        while (j < tokens.length && depth > 0) {
                            const token = tokens[j];
                            if (token?.type === TokenType.TK_LBRACE) {
                                depth++;
                            } else if (token?.type === TokenType.TK_RBRACE) {
                                depth--;
                                if (depth === 0) {
                                    endToken = token;
                                    break;
                                }
                            }
                            j++;
                        }
                    }
                    
                    const diagnostic: Diagnostic = {
                        severity: DiagnosticSeverity.Error,
                        code: UcodeErrorCode.INVALID_PARAMETER_TYPE,
                        range: {
                            start: textDocument.positionAt(firstParamToken.pos),
                            end: textDocument.positionAt(endToken.end)
                        },
                        message: `${funcToken.value}() parameter should be a string path, not a ${paramType}.`,
                        source: 'ucode'
                    };
                    diagnostics.push(diagnostic);
                }
            }
        }
    }
}