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

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
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
                message: `substr() second parameter should be a number (start position), not a string.`,
                source: 'ucode'
            };
            diagnostics.push(diagnostic);
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

    // Pattern to match variable assignments (to detect const reassignment)
    const assignmentPattern = /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=/g;
    let assignMatch: RegExpExecArray | null;

    while ((assignMatch = assignmentPattern.exec(text)) !== null) {
        const variableName = assignMatch[1];
        
        if (!variableName) continue;
        
        // Skip if this is part of a declaration (has const/let/var before it)
        const beforeAssignment = text.substring(Math.max(0, assignMatch.index - 20), assignMatch.index);
        if (/\b(const|let|var)\s*$/.test(beforeAssignment)) {
            continue;
        }
        
        const varInfo = variableDeclarations.get(variableName);
        if (varInfo && varInfo.type === 'const') {
            const varStart = assignMatch.index;
            const diagnostic: Diagnostic = {
                severity: DiagnosticSeverity.Error,
                range: {
                    start: textDocument.positionAt(varStart),
                    end: textDocument.positionAt(varStart + variableName.length)
                },
                message: `Cannot assign to '${variableName}' because it is a constant declared on line ${varInfo.line + 1}.`,
                source: 'ucode'
            };
            diagnostics.push(diagnostic);
        }
    }

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
    
    // Find the word at the current position
    const wordRange = getWordRangeAtPosition(text, offset);
    if (!wordRange) {
        return undefined;
    }
    
    const word = text.substring(wordRange.start, wordRange.end);
    connection.console.log('Hover word: ' + word);
    
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
                start: document.positionAt(wordRange.start),
                end: document.positionAt(wordRange.end)
            }
        };
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

// Listen on the connection
connection.listen();
