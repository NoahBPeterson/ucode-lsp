import {
    createConnection,
    TextDocuments,
    Diagnostic,
    DiagnosticSeverity,
    ProposedFeatures,
    InitializeParams,
    DidChangeConfigurationNotification,
    CompletionItem,
    CompletionItemKind,
    TextDocumentPositionParams,
    TextDocumentSyncKind,
    InitializeResult,
    Hover,
    MarkupKind,
    WorkspaceFoldersChangeEvent,
    DidChangeWatchedFilesParams,
    TextDocumentChangeEvent
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';
import { UcodeLexer, TokenType, Token } from './lexer';

// Create a connection for the server
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;

connection.onInitialize((params: InitializeParams) => {
    connection.console.log('ucode language server initializing...');
    const capabilities = params.capabilities;

    // Does the client support the `workspace/configuration` request?
    hasConfigurationCapability = !!(
        capabilities.workspace && !!capabilities.workspace.configuration
    );
    hasWorkspaceFolderCapability = !!(
        capabilities.workspace && !!capabilities.workspace.workspaceFolders
    );

    const result: InitializeResult = {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,
            // Tell the client that this server supports code completion
            completionProvider: {
                resolveProvider: true
            },
            // Tell the client that this server supports hover
            hoverProvider: true
        }
    };
    if (hasWorkspaceFolderCapability) {
        result.capabilities.workspace = {
            workspaceFolders: {
                supported: true
            }
        };
    }
    return result;
});

connection.onInitialized(() => {
    if (hasConfigurationCapability) {
        // Register for all configuration changes
        connection.client.register(DidChangeConfigurationNotification.type, undefined);
    }
    if (hasWorkspaceFolderCapability) {
        connection.workspace.onDidChangeWorkspaceFolders((_event: WorkspaceFoldersChangeEvent) => {
            connection.console.log('Workspace folder change event received.');
        });
    }
});

// Only keep settings for open documents
documents.onDidClose((_e: TextDocumentChangeEvent<TextDocument>) => {
    // Document closed - could clean up any document-specific data here
});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent((change: TextDocumentChangeEvent<TextDocument>) => {
    validateTextDocument(change.document);
});

// Enhanced validation using the lexer
function validateWithLexer(textDocument: TextDocument): Diagnostic[] {
    const text = textDocument.getText();
    const diagnostics: Diagnostic[] = [];
    
    // Send visible messages to client
    connection.sendNotification('window/showMessage', {
        type: 1, // Info
        message: `DEBUG: validateWithLexer called - text contains substr: ${text.includes('substr')}`
    });
    
    try {
        const lexer = new UcodeLexer(text, { rawMode: true });
        const tokens = lexer.tokenize();
        
        connection.sendNotification('window/showMessage', {
            type: 1,
            message: `DEBUG: Lexer generated ${tokens.length} tokens`
        });
        
        // Log all LABEL tokens to see if substr is being tokenized
        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            if (token && token.type === TokenType.TK_LABEL) {
                connection.sendNotification('window/showMessage', {
                    type: 1,
                    message: `DEBUG: LABEL token ${i}: "${token.value}" at ${token.pos}-${token.end}`
                });
            }
        }
        
        for (const token of tokens) {
            // Check for lexer errors
            if (token.type === TokenType.TK_ERROR) {
                const diagnostic: Diagnostic = {
                    severity: DiagnosticSeverity.Error,
                    range: {
                        start: textDocument.positionAt(token.pos),
                        end: textDocument.positionAt(token.end)
                    },
                    message: `Syntax error: ${token.value || 'Invalid token'}`,
                    source: 'ucode-lexer'
                };
                diagnostics.push(diagnostic);
            }
        }
        
        // Check for method calls on built-ins using token-based analysis
        validateMethodCalls(textDocument, tokens, diagnostics);
        
        // Check for variable redeclarations using token-based analysis
        validateVariableDeclarations(textDocument, tokens, diagnostics);
        
        // Check for const reassignments using token-based analysis
        validateConstReassignments(textDocument, tokens, diagnostics);
        
        // Check for substr() parameter types using token-based analysis  
        connection.sendNotification('window/showMessage', {
            type: 1,
            message: `DEBUG: About to call validateSubstrParametersSimple`
        });
        validateSubstrParametersSimple(textDocument, tokens, diagnostics);
        connection.sendNotification('window/showMessage', {
            type: 1,
            message: `DEBUG: validateSubstrParametersSimple completed`
        });
        
    } catch (error) {
        connection.console.log(`Lexer failed with error: ${error}`);
        // Fallback to regex-based validation if lexer fails
        return validateWithRegex(textDocument);
    }
    
    return diagnostics;
}

function validateMethodCalls(textDocument: TextDocument, tokens: Token[], diagnostics: Diagnostic[]): void {
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

function validateVariableDeclarations(textDocument: TextDocument, tokens: Token[], diagnostics: Diagnostic[]): void {
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

function validateConstReassignments(textDocument: TextDocument, tokens: Token[], diagnostics: Diagnostic[]): void {
    const constDeclarations = new Set<string>();
    const constDeclarationPositions = new Set<number>();
    
    // First pass: collect all const declarations and their positions
    for (let i = 0; i < tokens.length - 1; i++) {
        const declToken = tokens[i];
        const nameToken = tokens[i + 1];
        
        if (declToken && nameToken &&
            declToken.type === TokenType.TK_CONST &&
            nameToken.type === TokenType.TK_LABEL &&
            typeof nameToken.value === 'string') {
            
            constDeclarations.add(nameToken.value);
            constDeclarationPositions.add(nameToken.pos); // Track declaration positions
        }
    }
    
    // Second pass: check for reassignments (excluding initial declarations)
    for (let i = 0; i < tokens.length - 2; i++) {
        const varToken = tokens[i];
        const assignToken = tokens[i + 1];
        
        if (varToken && assignToken &&
            varToken.type === TokenType.TK_LABEL &&
            typeof varToken.value === 'string' &&
            constDeclarations.has(varToken.value) &&
            !constDeclarationPositions.has(varToken.pos) && // Exclude initial declarations
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

function validateSubstrParametersSimple(textDocument: TextDocument, tokens: Token[], diagnostics: Diagnostic[]): void {
    for (let i = 0; i < tokens.length - 6; i++) {
        const funcToken = tokens[i];
        const parenToken = tokens[i + 1];
        
        if (funcToken && parenToken &&
            funcToken.type === TokenType.TK_LABEL &&
            funcToken.value === 'substr' &&
            parenToken.type === TokenType.TK_LPAREN) {
            
            // Debug: print all tokens after substr(
            connection.sendNotification('window/showMessage', {
                type: 1,
                message: `DEBUG: Found substr at position ${funcToken.pos}-${funcToken.end}`
            });
            for (let j = i; j < Math.min(i + 10, tokens.length); j++) {
                const token = tokens[j];
                if (token) {
                    connection.sendNotification('window/showMessage', {
                        type: 1,
                        message: `DEBUG: Token ${j}: ${UcodeLexer.getTokenName(token.type)} = "${token.value}" at ${token.pos}-${token.end}`
                    });
                }
            }
            
            // Look for specific bad patterns
            // Pattern: substr(number, ...)
            const firstParamToken = tokens[i + 2];
            if (firstParamToken && firstParamToken.type === TokenType.TK_NUMBER) {
                connection.console.log(`First param token: pos=${firstParamToken.pos}, end=${firstParamToken.end}, value=${firstParamToken.value}`);
                
                const diagnostic: Diagnostic = {
                    severity: DiagnosticSeverity.Error,
                    range: {
                        start: textDocument.positionAt(firstParamToken.pos),
                        end: textDocument.positionAt(firstParamToken.end)
                    },
                    message: `substr() first parameter should be a string, not a number. Use substr(string, ${firstParamToken.value}).`,
                    source: 'ucode'
                };
                diagnostics.push(diagnostic);
            }
            
            // Pattern: substr(string, "string", ...)  
            const commaToken = tokens[i + 3];
            const secondParamToken = tokens[i + 4];
            if (commaToken && secondParamToken &&
                commaToken.type === TokenType.TK_COMMA &&
                secondParamToken.type === TokenType.TK_STRING) {
                
                connection.sendNotification('window/showMessage', {
                    type: 1,
                    message: `DEBUG: Second param token: pos=${secondParamToken.pos}, end=${secondParamToken.end}, value="${secondParamToken.value}"`
                });
                connection.sendNotification('window/showMessage', {
                    type: 1,
                    message: `DEBUG: Text length: ${textDocument.getText().length}`
                });

                const diagnostic: Diagnostic = {
                    severity: DiagnosticSeverity.Error,
                    range: {
                        start: textDocument.positionAt(secondParamToken.pos),
                        end: textDocument.positionAt(secondParamToken.end)
                    },
                    message: `substr() second parameter should be a number (start position), not a string. defg`,
                    source: 'ucode'
                };
                diagnostics.push(diagnostic);
            }
            
            // Pattern: substr(string, number, "string")
            const comma2Token = tokens[i + 5];
            const thirdParamToken = tokens[i + 6];
            if (comma2Token && thirdParamToken &&
                comma2Token.type === TokenType.TK_COMMA &&
                thirdParamToken.type === TokenType.TK_STRING) {
                
                connection.console.log(`Third param token: pos=${thirdParamToken.pos}, end=${thirdParamToken.end}, value="${thirdParamToken.value}"`);
                
                const diagnostic: Diagnostic = {
                    severity: DiagnosticSeverity.Error,
                    range: {
                        start: textDocument.positionAt(thirdParamToken.pos),
                        end: textDocument.positionAt(thirdParamToken.end)
                    },
                    message: `substr() third parameter should be a number (length), not a string.`,
                    source: 'ucode'
                };
                diagnostics.push(diagnostic);
            }
        }
    }
}

// Fallback regex-based validation (original implementation)
function validateWithRegex(textDocument: TextDocument): Diagnostic[] {
    const text = textDocument.getText();
    const diagnostics: Diagnostic[] = [];

    // Built-in functions that should NOT be called as methods
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

    // Pattern to match .methodName( calls
    const methodCallPattern = /\.(\w+)\s*\(/g;
    let match: RegExpExecArray | null;

    while ((match = methodCallPattern.exec(text)) !== null) {
        const methodName = match[1];
        
        // Check if this is a problematic built-in method call
        if (methodName && problematicMethods.includes(methodName)) {
            const diagnostic: Diagnostic = {
                severity: DiagnosticSeverity.Error,
                range: {
                    start: textDocument.positionAt(match.index),
                    end: textDocument.positionAt(match.index + match[0].length - 1) // Don't include the '('
                },
                message: `ucode does not support .${methodName}() method calls. Use ${methodName}(value, ...) instead.`,
                source: 'ucode'
            };
            diagnostics.push(diagnostic);
        }
    }

    // Pattern to match invalid syntax before declaration keywords
    const invalidDeclarationPattern = /(^|\s)(\w+)\s+(let|var|const)\b/gm;
    let declarationMatch: RegExpExecArray | null;

    while ((declarationMatch = invalidDeclarationPattern.exec(text)) !== null) {
        const invalidToken = declarationMatch[2]; // Now group 2 is the invalid token
        const keyword = declarationMatch[3]; // Now group 3 is the keyword
        
        if (invalidToken && keyword && declarationMatch[1] !== undefined) {
            // Calculate position of the invalid token (skip the whitespace/start match)
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

    // Pattern to match substr() calls with incorrect parameter types
    const substrPattern = /\bsubstr\s*\(\s*([^,\)]+)\s*,\s*([^,\)]+)(?:\s*,\s*([^,\)]+))?\s*\)/g;
    let substrMatch: RegExpExecArray | null;

    while ((substrMatch = substrPattern.exec(text)) !== null) {
        const firstArg = substrMatch[1]?.trim();
        const secondArg = substrMatch[2]?.trim();
        const thirdArg = substrMatch[3]?.trim();
        
        if (!firstArg || !secondArg) continue;
        
        // Check if first argument is a number (should be string)
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
        
        // Check if second argument is a string literal (should be number)
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
            connection.console.log(`Text length: ${textDocument.getText().length}`);

        }
        
        // Check if third argument is a string literal (should be number)
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

    // Track variable declarations to detect redeclarations
    const variableDeclarations = new Map<string, { type: 'const' | 'let' | 'var', line: number }>();
    
    // Pattern to match variable declarations
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

    // TODO: Implement token-based const reassignment validation
    // For now, disabled due to complexity - will implement in future version

    return diagnostics;
}

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
    // Use the new lexer-based validation
    const diagnostics = validateWithLexer(textDocument);
    
    // Send the computed diagnostics to VS Code
    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

connection.onDidChangeWatchedFiles((_change: DidChangeWatchedFilesParams) => {
    // Monitored files have changed in VS Code
    connection.console.log('We received an file change event');
});

// Built-in functions and their documentation
const builtinFunctions = new Map<string, string>([
    ['print', 'Print any of the given values to stdout.\n\n**Parameters:**\n- `...values` - Arbitrary values to print\n\n**Returns:** `number` - The amount of bytes written'],
    ['printf', 'Print formatted string to stdout.\n\n**Parameters:**\n- `format` - Format string\n- `...args` - Arguments for formatting\n\n**Returns:** `number` - The amount of bytes written'],
    ['sprintf', 'Return formatted string.\n\n**Parameters:**\n- `format` - Format string\n- `...args` - Arguments for formatting\n\n**Returns:** `string` - The formatted string'],
    ['length', 'Determine the length of the given object, array or string.\n\n**Parameters:**\n- `x` - The input object, array, or string\n\n**Returns:** `number|null` - The length of the input\n\n**Example:**\n```ucode\nlength("test")                             // 4\nlength([true, false, null, 123, "test"])   // 5\n```'],
    ['substr', 'Extract substring from string.\n\n**Parameters:**\n- `string` - The input string\n- `start` - Start position\n- `length` - Length of substring (optional)\n\n**Returns:** `string` - The extracted substring'],
    ['split', 'Split string into array of substrings.\n\n**Parameters:**\n- `string` - The input string\n- `separator` - String or regex to split on\n- `limit` - Maximum number of splits (optional)\n\n**Returns:** `array` - Array of substrings'],
    ['join', 'Join array elements into string.\n\n**Parameters:**\n- `separator` - String to join with\n- `array` - Array to join\n\n**Returns:** `string` - The joined string\n\n**Note:** Parameter order is `join(separator, array)` - different from JavaScript!'],
    ['trim', 'Remove whitespace from both ends of string.\n\n**Parameters:**\n- `string` - The input string\n\n**Returns:** `string` - The trimmed string'],
    ['ltrim', 'Remove whitespace from left end of string.\n\n**Parameters:**\n- `string` - The input string\n\n**Returns:** `string` - The left-trimmed string'],
    ['rtrim', 'Remove whitespace from right end of string.\n\n**Parameters:**\n- `string` - The input string\n\n**Returns:** `string` - The right-trimmed string'],
    ['chr', 'Convert ASCII code to character.\n\n**Parameters:**\n- `code` - ASCII code number\n\n**Returns:** `string` - The character'],
    ['ord', 'Get ASCII code of character.\n\n**Parameters:**\n- `char` - The character\n\n**Returns:** `number` - The ASCII code'],
    ['uc', 'Convert string to uppercase.\n\n**Parameters:**\n- `string` - The string to convert\n\n**Returns:** `string` - Uppercase string'],
    ['lc', 'Convert string to lowercase.\n\n**Parameters:**\n- `string` - The string to convert\n\n**Returns:** `string` - Lowercase string'],
    ['type', 'Get type of value.\n\n**Parameters:**\n- `value` - The value to check\n\n**Returns:** `string` - Type name ("object", "array", "string", "number", "boolean", "function", "null")'],
    ['keys', 'Get array of object keys.\n\n**Parameters:**\n- `object` - The object\n\n**Returns:** `array|null` - Array of property names, or null if not an object'],
    ['values', 'Get array of object values.\n\n**Parameters:**\n- `object` - The object\n\n**Returns:** `array|null` - Array of property values, or null if not an object'],
    ['push', 'Add elements to end of array.\n\n**Parameters:**\n- `array` - The array\n- `...values` - Values to add\n\n**Returns:** `number` - New length of array'],
    ['pop', 'Remove and return last element from array.\n\n**Parameters:**\n- `array` - The array\n\n**Returns:** `*` - The removed element'],
    ['shift', 'Remove and return first element from array.\n\n**Parameters:**\n- `array` - The array\n\n**Returns:** `*` - The removed element'],
    ['unshift', 'Add elements to beginning of array.\n\n**Parameters:**\n- `array` - The array\n- `...values` - Values to add\n\n**Returns:** `number` - New length of array'],
    ['index', 'Find index of substring or element.\n\n**Parameters:**\n- `haystack` - String or array to search in\n- `needle` - Value to search for\n\n**Returns:** `number` - Index of first occurrence, or -1 if not found\n\n**Note:** Parameter order is `index(haystack, needle)`'],
    ['require', 'Load and return module.\n\n**Parameters:**\n- `module` - Module name or path\n\n**Returns:** `*` - The loaded module'],
    ['include', 'Include file contents inline.\n\n**Parameters:**\n- `path` - Path to file\n\n**Returns:** `*` - Result of included file'],
    ['json', 'Parse JSON string or stringify value.\n\n**Parameters:**\n- `value` - String to parse or value to stringify\n\n**Returns:** `*` - Parsed object or JSON string'],
    ['match', 'Match string against regex.\n\n**Parameters:**\n- `string` - The string to match\n- `regex` - Regular expression\n\n**Returns:** `array|null` - Match results or null'],
    ['replace', 'Replace occurrences in string.\n\n**Parameters:**\n- `string` - The string\n- `search` - String or regex to search for\n- `replacement` - Replacement string\n\n**Returns:** `string` - String with replacements'],
    ['system', 'Execute shell command.\n\n**Parameters:**\n- `command` - Command to execute\n\n**Returns:** `number` - Exit code of command'],
    ['time', 'Get current Unix timestamp.\n\n**Returns:** `number` - Current time in seconds since epoch'],
    ['sleep', 'Pause execution for specified seconds.\n\n**Parameters:**\n- `seconds` - Number of seconds to sleep\n\n**Returns:** `null`']
]);

// This handler provides hover information
connection.onHover((_textDocumentPositionParams: TextDocumentPositionParams): Hover | undefined => {
    connection.console.log('Hover request received for: ' + _textDocumentPositionParams.textDocument.uri);
    const document = documents.get(_textDocumentPositionParams.textDocument.uri);
    if (!document) {
        connection.console.log('Document not found');
        return undefined;
    }

    const position = _textDocumentPositionParams.position;
    const text = document.getText();
    const offset = document.offsetAt(position);
    
    try {
        // Use lexer to get precise token information
        const lexer = new UcodeLexer(text, { rawMode: true });
        const tokens = lexer.tokenize();
        
        // Find the token at the hover position
        const token = tokens.find(t => t.pos <= offset && offset <= t.end);
        
        if (token && token.type === TokenType.TK_LABEL && typeof token.value === 'string') {
            const word = token.value;
            connection.console.log('Hover word (from lexer): ' + word);
            
            // Check if it's a built-in function
            const documentation = builtinFunctions.get(word);
            if (documentation) {
                connection.console.log('Found documentation for: ' + word);
                return {
                    contents: {
                        kind: MarkupKind.Markdown,
                        value: `**${word}** (built-in function)\n\n${documentation}`
                    },
                    range: {
                        start: document.positionAt(token.pos),
                        end: document.positionAt(token.end)
                    }
                };
            }
            
            // Check if it's a keyword
            if (UcodeLexer.isKeyword(word)) {
                return {
                    contents: {
                        kind: MarkupKind.Markdown,
                        value: `**${word}** (ucode keyword)`
                    },
                    range: {
                        start: document.positionAt(token.pos),
                        end: document.positionAt(token.end)
                    }
                };
            }
        }
    } catch (error) {
        // Fallback to regex-based word detection
        const wordRange = getWordRangeAtPosition(text, offset);
        if (!wordRange) {
            return undefined;
        }
        
        const word = text.substring(wordRange.start, wordRange.end);
        connection.console.log('Hover word (fallback): ' + word);
        
        const documentation = builtinFunctions.get(word);
        if (documentation) {
            return {
                contents: {
                    kind: MarkupKind.Markdown,
                    value: `**${word}** (built-in function)\n\n${documentation}`
                },
                range: {
                    start: document.positionAt(wordRange.start),
                    end: document.positionAt(wordRange.end)
                }
            };
        }
    }
    
    return undefined;
});

// Helper function to get word range at position
function getWordRangeAtPosition(text: string, offset: number): { start: number; end: number } | undefined {
    const wordRegex = /[a-zA-Z_$][a-zA-Z0-9_$]*/g;
    let match;
    
    while ((match = wordRegex.exec(text)) !== null) {
        if (match.index <= offset && offset <= match.index + match[0].length) {
            return {
                start: match.index,
                end: match.index + match[0].length
            };
        }
    }
    
    return undefined;
}

// This handler provides completion items
connection.onCompletion((_textDocumentPositionParams: TextDocumentPositionParams): CompletionItem[] => {
    // Return built-in functions as completion items
    const completionItems: CompletionItem[] = [];
    
    builtinFunctions.forEach((documentation, functionName) => {
        completionItems.push({
            label: functionName,
            kind: CompletionItemKind.Function,
            documentation: {
                kind: MarkupKind.Markdown,
                value: documentation
            },
            insertText: functionName + '()'
        });
    });
    
    return completionItems;
});

// This handler resolves additional information for completion items
connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
    return item;
});

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// TODO: Token-based parsing will be implemented in a future version
// Currently disabled due to TypeScript complexity

// Listen on the connection
connection.listen();
