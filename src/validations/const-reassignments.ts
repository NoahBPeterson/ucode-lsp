import {
    Diagnostic,
    DiagnosticSeverity,
    TextDocument
} from 'vscode-languageserver/node';
import { TokenType, Token } from '../lexer';

export function validateConstReassignments(textDocument: TextDocument, tokens: Token[], diagnostics: Diagnostic[]): void {
    const constDeclarations = new Set<string>();
    const constDeclarationPositions = new Set<number>();
    
    for (let i = 0; i < tokens.length - 1; i++) {
        const declToken = tokens[i];
        const nameToken = tokens[i + 1];
        
        if (declToken && nameToken &&
            declToken.type === TokenType.TK_CONST &&
            nameToken.type === TokenType.TK_LABEL &&
            typeof nameToken.value === 'string') {
            
            constDeclarations.add(nameToken.value);
            constDeclarationPositions.add(nameToken.pos);
        }
    }
    
    for (let i = 0; i < tokens.length - 2; i++) {
        const varToken = tokens[i];
        const assignToken = tokens[i + 1];
        
        if (varToken && assignToken &&
            varToken.type === TokenType.TK_LABEL &&
            typeof varToken.value === 'string' &&
            constDeclarations.has(varToken.value) &&
            !constDeclarationPositions.has(varToken.pos) &&
            (assignToken.type === TokenType.TK_ASSIGN ||
             assignToken.type === TokenType.TK_ASADD ||
             assignToken.type === TokenType.TK_ASSUB ||
             assignToken.type === TokenType.TK_ASMUL ||
             assignToken.type === TokenType.TK_ASDIV ||
             assignToken.type === TokenType.TK_ASMOD ||
             assignToken.type === TokenType.TK_ASLEFT ||
             assignToken.type === TokenType.TK_ASRIGHT ||
             assignToken.type === TokenType.TK_ASBAND ||
             assignToken.type === TokenType.TK_ASBXOR ||
             assignToken.type === TokenType.TK_ASBOR ||
             assignToken.type === TokenType.TK_ASEXP ||
             assignToken.type === TokenType.TK_ASAND ||
             assignToken.type === TokenType.TK_ASOR ||
             assignToken.type === TokenType.TK_ASNULLISH)) {
            
            const diagnostic: Diagnostic = {
                severity: DiagnosticSeverity.Error,
                range: {
                    start: textDocument.positionAt(varToken.pos),
                    end: textDocument.positionAt(varToken.end)
                },
                message: `Cannot assign to '${varToken.value}' because it is a constant.`,
                source: 'ucode'
            };
            diagnostics.push(diagnostic);
        }
    }
}