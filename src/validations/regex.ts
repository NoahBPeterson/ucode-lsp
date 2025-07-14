import {
    Diagnostic,
    DiagnosticSeverity,
    TextDocument
} from 'vscode-languageserver/node';

export function validateWithRegex(textDocument: TextDocument): Diagnostic[] {
    const text = textDocument.getText();
    const diagnostics: Diagnostic[] = [];

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

    const methodCallPattern = /\.([\w]+)\s*\(/g;
    let match: RegExpExecArray | null;

    while ((match = methodCallPattern.exec(text)) !== null) {
        const methodName = match[1];
        
        if (methodName && problematicMethods.includes(methodName)) {
            const diagnostic: Diagnostic = {
                severity: DiagnosticSeverity.Error,
                range: {
                    start: textDocument.positionAt(match.index),
                    end: textDocument.positionAt(match.index + match[0].length - 1)
                },
                message: `ucode does not support .${methodName}() method calls. Use ${methodName}(value, ...) instead.`,
                source: 'ucode'
            };
            diagnostics.push(diagnostic);
        }
    }

    const invalidDeclarationPattern = /(^|\s)([\w]+)\s+(let|var|const)\b/gm;
    let declarationMatch: RegExpExecArray | null;

    while ((declarationMatch = invalidDeclarationPattern.exec(text)) !== null) {
        const invalidToken = declarationMatch[2];
        const keyword = declarationMatch[3];
        
        if (invalidToken && keyword && declarationMatch[1] !== undefined) {
            const tokenStart = declarationMatch.index + declarationMatch[1].length;
            const diagnostic: Diagnostic = {
                severity: DiagnosticSeverity.Error,
                range: {
                    start: textDocument.positionAt(tokenStart),
                    end: textDocument.positionAt(tokenStart + invalidToken.length)
                },
                message: `Unexpected token '${invalidToken}' before '${keyword}' declaration. Remove '${invalidToken}'.`,
                source: 'ucode'
            };
            diagnostics.push(diagnostic);
        }
    }

    const substrPattern = /\bsubstr\s*\(\s*([^,\)]+)\s*,\s*([^,\)]+)(?:\s*,\s*([^,\)]+))?\s*\)/g;
    let substrMatch: RegExpExecArray | null;

    while ((substrMatch = substrPattern.exec(text)) !== null) {
        const firstArg = substrMatch[1]?.trim();
        const secondArg = substrMatch[2]?.trim();
        const thirdArg = substrMatch[3]?.trim();
        
        if (!firstArg || !secondArg) continue;
        
        if (/^\d+$/.test(firstArg)) {
            const argStart = substrMatch.index + substrMatch[0].indexOf(firstArg);
            const diagnostic: Diagnostic = {
                severity: DiagnosticSeverity.Error,
                range: {
                    start: textDocument.positionAt(argStart),
                    end: textDocument.positionAt(argStart + firstArg.length)
                },
                message: `substr() first parameter should be a string, not a number. Use substr(string, ${firstArg}).`,
                source: 'ucode'
            };
            diagnostics.push(diagnostic);
        }
        
        if (/^["']/.test(secondArg)) {
            const argStart = substrMatch.index + substrMatch[0].indexOf(secondArg);
            const diagnostic: Diagnostic = {
                severity: DiagnosticSeverity.Error,
                range: {
                    start: textDocument.positionAt(argStart),
                    end: textDocument.positionAt(argStart + secondArg.length)
                },
                message: `substr() second parameter should be a number (start position), not a string. abcd`,
                source: 'ucode'
            };
            diagnostics.push(diagnostic);
        }
        
        if (thirdArg && /^["']/.test(thirdArg)) {
            const argStart = substrMatch.index + substrMatch[0].indexOf(thirdArg);
            const diagnostic: Diagnostic = {
                severity: DiagnosticSeverity.Error,
                range: {
                    start: textDocument.positionAt(argStart),
                    end: textDocument.positionAt(argStart + thirdArg.length)
                },
                message: `substr() third parameter should be a number (length), not a string.`,
                source: 'ucode'
            };
            diagnostics.push(diagnostic);
        }
    }

    const variableDeclarations = new Map<string, { type: 'const' | 'let' | 'var', line: number }>();
    
    const declarationPattern = /\b(const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
    let declMatch: RegExpExecArray | null;

    while ((declMatch = declarationPattern.exec(text)) !== null) {
        const declarationType = declMatch[1] as 'const' | 'let' | 'var';
        const variableName = declMatch[2];
        
        if (!declarationType || !variableName) continue;
        
        const line = textDocument.positionAt(declMatch.index).line;
        
        if (variableDeclarations.has(variableName)) {
            const existing = variableDeclarations.get(variableName)!;
            const varStart = declMatch.index + declMatch[0].indexOf(variableName);
            const diagnostic: Diagnostic = {
                severity: DiagnosticSeverity.Error,
                range: {
                    start: textDocument.positionAt(varStart),
                    end: textDocument.positionAt(varStart + variableName.length)
                },
                message: `Variable '${variableName}' is already declared on line ${existing.line + 1}. Cannot redeclare variable.`,
                source: 'ucode'
            };
            diagnostics.push(diagnostic);
        } else {
            variableDeclarations.set(variableName, { type: declarationType, line });
        }
    }

    // Pattern to match ltrim(), rtrim(), and trim() calls with incorrect parameter types
    const trimPattern = /\b(ltrim|rtrim|trim)\s*\(\s*([^,\)]+)\s*\)/g;
    let trimMatch: RegExpExecArray | null;

    while ((trimMatch = trimPattern.exec(text)) !== null) {
        const functionName = trimMatch[1];
        const firstArg = trimMatch[2]?.trim();
        
        if (!firstArg) continue;
        
        // Check if argument is a number (should be string)
        if (/^\d+$/.test(firstArg)) {
            const argStart = trimMatch.index + trimMatch[0].indexOf(firstArg);
            const diagnostic: Diagnostic = {
                severity: DiagnosticSeverity.Error,
                range: {
                    start: textDocument.positionAt(argStart),
                    end: textDocument.positionAt(argStart + firstArg.length)
                },
                message: `${functionName}() parameter should be a string, not a number. Use ${functionName}(string) instead.`,
                source: 'ucode'
            };
            diagnostics.push(diagnostic);
        }
    }

    return diagnostics;
}