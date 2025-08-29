import {
    Diagnostic,
    DiagnosticSeverity
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { TokenType, Token } from '../lexer';
import { UcodeErrorCode } from '../analysis/errorConstants';

export function validateIOFunctions(textDocument: TextDocument, tokens: Token[], diagnostics: Diagnostic[]): void {
    for (let i = 0; i < tokens.length - 2; i++) {
        const funcToken = tokens[i];
        const parenToken = tokens[i + 1];
        
        if (funcToken && parenToken &&
            funcToken.type === TokenType.TK_LABEL &&
            typeof funcToken.value === 'string' &&
            parenToken.type === TokenType.TK_LPAREN) {
            
            // Handle printf function: printf(format_string, ...args)
            if (funcToken.value === 'printf') {
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
                        message: `printf() first parameter should be a format string, not a number.`,
                        source: 'ucode'
                    };
                    diagnostics.push(diagnostic);
                }
            }
            
            // Handle sprintf function: sprintf(format_string, ...args)
            if (funcToken.value === 'sprintf') {
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
                        message: `sprintf() first parameter should be a format string.`,
                        source: 'ucode'
                    };
                    diagnostics.push(diagnostic);
                }
            }
            
            // Note: print() accepts any types, so no validation needed
            // print(...any) is intentionally flexible
        }
    }
}