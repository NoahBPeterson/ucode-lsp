import {
    TextDocumentPositionParams,
    Hover,
    MarkupKind
} from 'vscode-languageserver/node';
import { UcodeLexer, TokenType, isKeyword } from './lexer';
import { allBuiltinFunctions } from './builtins';
import { SemanticAnalysisResult, SymbolType } from './analysis';
import { typeToString } from './analysis/symbolTable';
import { debugTypeRegistry } from './analysis/debugTypes';
import { digestTypeRegistry } from './analysis/digestTypes';

export function handleHover(
    textDocumentPositionParams: TextDocumentPositionParams,
    documents: any,
    analysisResult?: SemanticAnalysisResult
): Hover | undefined {
    const document = documents.get(textDocumentPositionParams.textDocument.uri);
    if (!document) {
        return undefined;
    }

    const position = textDocumentPositionParams.position;
    const text = document.getText();
    const offset = document.offsetAt(position);
    
    try {
        const lexer = new UcodeLexer(text, { rawMode: true });
        const tokens = lexer.tokenize();
        
        const token = tokens.find(t => t.pos <= offset && offset <= t.end);
        
        if (token && token.type === TokenType.TK_LABEL && typeof token.value === 'string') {
            const word = token.value;
            
            // Check if this is part of a member expression (e.g., fs.open)
            const memberExpressionInfo = detectMemberExpression(offset, tokens);
            if (memberExpressionInfo && analysisResult) {
                // For member expressions, we could add object-specific hover here
                // For now, fall through to regular symbol analysis
            }
            
            // 0. Check if this is a digest module function FIRST (before symbol table)
            if (digestTypeRegistry.isDigestFunction(word)) {
                return {
                    contents: {
                        kind: MarkupKind.Markdown,
                        value: digestTypeRegistry.getFunctionDocumentation(word)
                    },
                    range: {
                        start: document.positionAt(token.pos),
                        end: document.positionAt(token.end)
                    }
                };
            }
            
            // 1. Check if this is a debug module function FIRST (before symbol table)
            if (debugTypeRegistry.isDebugFunction(word)) {
                return {
                    contents: {
                        kind: MarkupKind.Markdown,
                        value: debugTypeRegistry.getFunctionDocumentation(word)
                    },
                    range: {
                        start: document.positionAt(token.pos),
                        end: document.positionAt(token.end)
                    }
                };
            }
            
            // 1. Check for user-defined symbols using the analysis cache
            if (analysisResult) {
                const symbol = analysisResult.symbolTable.lookup(word);
                if (symbol) {
                    let hoverText = '';
                    switch (symbol.type) {
                        case SymbolType.VARIABLE:
                        case SymbolType.PARAMETER:
                            hoverText = `(${symbol.type}) **${symbol.name}**: \`${typeToString(symbol.dataType)}\``;
                            break;
                        case SymbolType.FUNCTION:
                            // NOTE: Parameter types are not yet tracked in this example.
                            hoverText = `(function) **${symbol.name}**(): \`${typeToString(symbol.dataType)}\``;
                            break;
                        case SymbolType.MODULE:
                            hoverText = `(module) **${symbol.name}**: \`${typeToString(symbol.dataType)}\``;
                            break;
                        case SymbolType.IMPORTED:
                            // Special handling for module imports
                            if (symbol.importedFrom === 'debug') {
                                hoverText = getDebugModuleDocumentation();
                            } else if (symbol.importedFrom === 'digest') {
                                hoverText = getDigestModuleDocumentation();
                            } else {
                                hoverText = `(imported) **${symbol.name}**: \`${typeToString(symbol.dataType)}\``;
                            }
                            break;
                    }
                    
                    if (hoverText) {
                        return {
                            contents: { kind: MarkupKind.Markdown, value: hoverText },
                            range: {
                                start: document.positionAt(token.pos),
                                end: document.positionAt(token.end)
                            }
                        };
                    }
                }
            }
            
            // 3. Fallback to built-in functions and keywords
            const documentation = allBuiltinFunctions.get(word);
            if (documentation) {
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
            
            if (isKeyword(word)) {
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
        const wordRange = getWordRangeAtPosition(text, offset);
        if (!wordRange) {
            return undefined;
        }
        
        const word = text.substring(wordRange.start, wordRange.end);
        
        // Check if this is a digest module function
        if (digestTypeRegistry.isDigestFunction(word)) {
            return {
                contents: {
                    kind: MarkupKind.Markdown,
                    value: digestTypeRegistry.getFunctionDocumentation(word)
                },
                range: {
                    start: document.positionAt(wordRange.start),
                    end: document.positionAt(wordRange.end)
                }
            };
        }
        
        // Check if this is a debug module function
        if (debugTypeRegistry.isDebugFunction(word)) {
            return {
                contents: {
                    kind: MarkupKind.Markdown,
                    value: debugTypeRegistry.getFunctionDocumentation(word)
                },
                range: {
                    start: document.positionAt(wordRange.start),
                    end: document.positionAt(wordRange.end)
                }
            };
        }
        
        const documentation = allBuiltinFunctions.get(word);
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
}

function detectMemberExpression(offset: number, tokens: any[]): { objectName: string; propertyName: string } | undefined {
    // Find the token at the current position
    const currentTokenIndex = tokens.findIndex(t => t.pos <= offset && offset <= t.end);
    if (currentTokenIndex === -1) return undefined;
    
    const currentToken = tokens[currentTokenIndex];
    
    // Look for pattern: LABEL DOT LABEL or LABEL DOT current_position
    // Check if current token is part of a member expression
    
    // Case 1: Hovering over object name in "object.property"
    if (currentTokenIndex + 2 < tokens.length) {
        const nextToken = tokens[currentTokenIndex + 1];
        const afterNextToken = tokens[currentTokenIndex + 2];
        
        if (nextToken.type === TokenType.TK_DOT && 
            afterNextToken.type === TokenType.TK_LABEL &&
            currentToken.type === TokenType.TK_LABEL) {
            return {
                objectName: currentToken.value as string,
                propertyName: afterNextToken.value as string
            };
        }
    }
    
    // Case 2: Hovering over property name in "object.property"
    if (currentTokenIndex >= 2) {
        const prevToken = tokens[currentTokenIndex - 1];
        const beforePrevToken = tokens[currentTokenIndex - 2];
        
        if (prevToken.type === TokenType.TK_DOT && 
            beforePrevToken.type === TokenType.TK_LABEL &&
            currentToken.type === TokenType.TK_LABEL) {
            return {
                objectName: beforePrevToken.value as string,
                propertyName: currentToken.value as string
            };
        }
    }
    
    return undefined;
}

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

function getDebugModuleDocumentation(): string {
    return `## Debug Module

**Runtime debug functionality for ucode scripts**

The debug module provides comprehensive debugging and introspection capabilities for ucode applications.

### Usage

**Named import syntax:**
\`\`\`ucode
import { memdump, traceback } from 'debug';

let stacktrace = traceback(1);
memdump("/tmp/dump.txt");
\`\`\`

**Namespace import syntax:**
\`\`\`ucode
import * as debug from 'debug';

let stacktrace = debug.traceback(1);
debug.memdump("/tmp/dump.txt");
\`\`\`

### Available Functions

- **\`memdump()\`** - Write memory dump report to file
- **\`traceback()\`** - Generate stack trace from execution point  
- **\`sourcepos()\`** - Get current source position information
- **\`getinfo()\`** - Get detailed information about a value
- **\`getlocal()\`** - Get the value of a local variable
- **\`setlocal()\`** - Set the value of a local variable
- **\`getupval()\`** - Get the value of an upvalue (closure variable)
- **\`setupval()\`** - Set the value of an upvalue (closure variable)

### Environment Variables

- **\`UCODE_DEBUG_MEMDUMP_ENABLED\`** - Enable/disable automatic memory dumps (default: enabled)
- **\`UCODE_DEBUG_MEMDUMP_SIGNAL\`** - Signal for triggering memory dumps (default: SIGUSR2)
- **\`UCODE_DEBUG_MEMDUMP_PATH\`** - Output directory for memory dumps (default: /tmp)

*Hover over individual function names for detailed parameter and return type information.*`;
}

function getDigestModuleDocumentation(): string {
    return `## Digest Module

**Cryptographic hash functions for ucode scripts**

The digest module provides secure hashing functionality using industry-standard algorithms.

### Usage

**Named import syntax:**
\`\`\`ucode
import { md5, sha256, sha1_file } from 'digest';

let hash = md5("Hello World");
let fileHash = sha256_file("/path/to/file.txt");
\`\`\`

**Namespace import syntax:**
\`\`\`ucode
import * as digest from 'digest';

let hash = digest.md5("Hello World");
let fileHash = digest.sha256_file("/path/to/file.txt");
\`\`\`

### Available Functions

**String hashing functions:**
- **\`md5()\`** - Calculate MD5 hash of string
- **\`sha1()\`** - Calculate SHA1 hash of string
- **\`sha256()\`** - Calculate SHA256 hash of string
- **\`sha384()\`** - Calculate SHA384 hash of string (extended)
- **\`sha512()\`** - Calculate SHA512 hash of string (extended)
- **\`md2()\`** - Calculate MD2 hash of string (extended)
- **\`md4()\`** - Calculate MD4 hash of string (extended)

**File hashing functions:**
- **\`md5_file()\`** - Calculate MD5 hash of file
- **\`sha1_file()\`** - Calculate SHA1 hash of file
- **\`sha256_file()\`** - Calculate SHA256 hash of file
- **\`sha384_file()\`** - Calculate SHA384 hash of file (extended)
- **\`sha512_file()\`** - Calculate SHA512 hash of file (extended)
- **\`md2_file()\`** - Calculate MD2 hash of file (extended)
- **\`md4_file()\`** - Calculate MD4 hash of file (extended)

### Notes

- Extended algorithms (MD2, MD4, SHA384, SHA512) may not be available on all systems
- All functions return \`null\` on error or invalid input
- File functions return \`null\` if the file cannot be read

*Hover over individual function names for detailed parameter and return type information.*`;
}