import {
    Diagnostic,
    DiagnosticSeverity
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { TokenType, Token } from '../lexer';

export function validateMethodCalls(textDocument: TextDocument, tokens: Token[], diagnostics: Diagnostic[]): void {
    const problematicMethods = [
        'trim', 'ltrim', 'rtrim', 'split', 'substr', 'replace', 'match', 
        'length', 'push', 'pop', 'shift', 'unshift', 'slice', 'splice',
        'sort', 'reverse', 'join', 'indexOf', 'toUpperCase', 'toLowerCase',
        'startsWith', 'endsWith', 'includes', 'charAt', 'charCodeAt', 'uc',
        'lc', 'index', 'rindex', 'chr', 'ord', 'filter', 'map', 'exists',
        'keys', 'values', 'hex', 'int', 'type', 'uchr', 'min', 'max',
        'b64dec', 'b64enc', 'hexdec', 'hexenc', 'uniq', 'localtime', 'gmtime',
        'timelocal', 'timegm', 'clock', 'iptoarr', 'arrtoip', 'wildcard',
        'regexp', 'sourcepath', 'assert', 'gc', 'loadstring', 'loadfile',
        'call', 'signal'
    ];

    for (let i = 0; i < tokens.length - 2; i++) {
        const dotToken = tokens[i];
        const methodToken = tokens[i + 1];
        const parenToken = tokens[i + 2];

        if (dotToken && methodToken && parenToken &&
            dotToken.type === TokenType.TK_DOT &&
            methodToken.type === TokenType.TK_LABEL &&
            parenToken.type === TokenType.TK_LPAREN &&
            typeof methodToken.value === 'string' &&
            problematicMethods.includes(methodToken.value)) {
            
            const diagnostic: Diagnostic = {
                severity: DiagnosticSeverity.Error,
                range: {
                    start: textDocument.positionAt(dotToken.pos),
                    end: textDocument.positionAt(parenToken.pos)
                },
                message: `ucode does not support .${methodToken.value}() method calls. Use ${methodToken.value}(value, ...) instead.`,
                source: 'ucode'
            };
            diagnostics.push(diagnostic);
        }
    }
}