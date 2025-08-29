import {
    Diagnostic,
    DiagnosticSeverity
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { TokenType, Token } from '../lexer';
import { UcodeErrorCode } from '../analysis/errorConstants';

export function validateVariableDeclarations(textDocument: TextDocument, tokens: Token[], diagnostics: Diagnostic[]): void {
    const declarations = new Map<string, { type: 'const' | 'let' | 'var', line: number, pos: number }>();
    
    for (let i = 0; i < tokens.length - 1; i++) {
        const declToken = tokens[i];
        const nameToken = tokens[i + 1];
        
        if (declToken && nameToken &&
            (declToken.type === TokenType.TK_CONST || 
             declToken.type === TokenType.TK_LOCAL ||
             (declToken.type === TokenType.TK_LABEL && declToken.value === 'var')) &&
            nameToken.type === TokenType.TK_LABEL &&
            typeof nameToken.value === 'string') {
            
            const varType = declToken.type === TokenType.TK_CONST ? 'const' : 
                           declToken.type === TokenType.TK_LOCAL ? 'let' : 'var';
            
            const currentLine = textDocument.positionAt(nameToken.pos).line;
            
            if (declarations.has(nameToken.value)) {
                const existing = declarations.get(nameToken.value)!;
                
                const diagnostic: Diagnostic = {
                    severity: DiagnosticSeverity.Error,
                    code: UcodeErrorCode.VARIABLE_REDECLARATION,
                    range: {
                        start: textDocument.positionAt(nameToken.pos),
                        end: textDocument.positionAt(Math.min(nameToken.end, nameToken.pos + nameToken.value.length))
                    },
                    message: `Variable '${nameToken.value}' is already declared on line ${existing.line + 1}. Cannot redeclare variable.`,
                    source: 'ucode'
                };
                diagnostics.push(diagnostic);
            } else {
                declarations.set(nameToken.value, { 
                    type: varType, 
                    line: currentLine, 
                    pos: nameToken.pos 
                });
            }
        }
    }
}