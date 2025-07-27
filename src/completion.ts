import {
    TextDocumentPositionParams,
    CompletionItem,
    CompletionItemKind,
    MarkupKind,
    InsertTextFormat
} from 'vscode-languageserver/node';
import { UcodeLexer, TokenType } from './lexer';
import { allBuiltinFunctions } from './builtins';
import { SemanticAnalysisResult } from './analysis';
import { fsTypeRegistry } from './analysis/fsTypes';
import { debugTypeRegistry } from './analysis/debugTypes';
import { digestTypeRegistry } from './analysis/digestTypes';
import { logTypeRegistry } from './analysis/logTypes';
import { mathTypeRegistry } from './analysis/mathTypes';
import { nl80211TypeRegistry } from './analysis/nl80211Types';
import { nl80211ObjectRegistry } from './analysis/nl80211Types';
import { resolvTypeRegistry } from './analysis/resolvTypes';
import { socketTypeRegistry } from './analysis/socketTypes';
import { structTypeRegistry } from './analysis/structTypes';

export function handleCompletion(
    textDocumentPositionParams: TextDocumentPositionParams,
    documents: any,
    connection: any,
    analysisResult?: SemanticAnalysisResult
): CompletionItem[] {
    const document = documents.get(textDocumentPositionParams.textDocument.uri);
    if (!document) {
        connection.console.log(`[COMPLETION] No document found for URI: ${textDocumentPositionParams.textDocument.uri}`);
        return createGeneralCompletions();
    }
    
    connection.console.log(`[COMPLETION] Document found, analysisResult: ${!!analysisResult}`);

    const position = textDocumentPositionParams.position;
    const text = document.getText();
    const offset = document.offsetAt(position);
    
    try {
        const lexer = new UcodeLexer(text, { rawMode: true });
        const tokens = lexer.tokenize();
        
        // Check if we're in a member expression context (e.g., "fs.")
        const memberContext = detectMemberCompletionContext(offset, tokens);
        if (memberContext) {
            // We're definitely in a member expression context (obj.something)
            // Never show builtin functions or keywords for member expressions
            const { objectName } = memberContext;
            connection.console.log(`Member expression detected for: ${objectName}`);
            
            // Check if this is an fs object with completions available
            const fsCompletions = getFsObjectCompletions(objectName, analysisResult);
            if (fsCompletions.length > 0) {
                connection.console.log(`Returning ${fsCompletions.length} fs object completions for ${objectName}`);
                return fsCompletions;
            }
            
            // Check if this is an nl80211 object with completions available
            const nl80211ObjectCompletions = getNl80211ObjectCompletions(objectName, analysisResult);
            if (nl80211ObjectCompletions.length > 0) {
                connection.console.log(`Returning ${nl80211ObjectCompletions.length} nl80211 object completions for ${objectName}`);
                return nl80211ObjectCompletions;
            }
            
            // Check if this is a debug module with completions available
            const debugCompletions = getDebugModuleCompletions(objectName, analysisResult);
            if (debugCompletions.length > 0) {
                connection.console.log(`Returning ${debugCompletions.length} debug module completions for ${objectName}`);
                return debugCompletions;
            }
            
            // Check if this is a digest module with completions available
            const digestCompletions = getDigestModuleCompletions(objectName, analysisResult);
            if (digestCompletions.length > 0) {
                connection.console.log(`Returning ${digestCompletions.length} digest module completions for ${objectName}`);
                return digestCompletions;
            }
            
            // Check if this is a log module with completions available
            const logCompletions = getLogModuleCompletions(objectName, analysisResult);
            if (logCompletions.length > 0) {
                connection.console.log(`Returning ${logCompletions.length} log module completions for ${objectName}`);
                return logCompletions;
            }
            
            // Check if this is a math module with completions available
            const mathCompletions = getMathModuleCompletions(objectName, analysisResult);
            if (mathCompletions.length > 0) {
                connection.console.log(`Returning ${mathCompletions.length} math module completions for ${objectName}`);
                return mathCompletions;
            }
            
            // Check if this is a nl80211 module with completions available
            const nl80211Completions = getNl80211ModuleCompletions(objectName, analysisResult);
            if (nl80211Completions.length > 0) {
                connection.console.log(`Returning ${nl80211Completions.length} nl80211 module completions for ${objectName}`);
                return nl80211Completions;
            }
            
            // Check if this is a resolv module with completions available
            const resolvCompletions = getResolvModuleCompletions(objectName, analysisResult);
            if (resolvCompletions.length > 0) {
                connection.console.log(`Returning ${resolvCompletions.length} resolv module completions for ${objectName}`);
                return resolvCompletions;
            }
            
            // Check if this is a socket module with completions available
            const socketCompletions = getSocketModuleCompletions(objectName, analysisResult);
            if (socketCompletions.length > 0) {
                connection.console.log(`Returning ${socketCompletions.length} socket module completions for ${objectName}`);
                return socketCompletions;
            }
            
            // Check if this is a struct module with completions available
            const structCompletions = getStructModuleCompletions(objectName, analysisResult);
            if (structCompletions.length > 0) {
                connection.console.log(`Returning ${structCompletions.length} struct module completions for ${objectName}`);
                return structCompletions;
            }
            
            // For member expressions, return empty array - never show builtin functions
            connection.console.log(`No specific completions for object: ${objectName}`);
            return [];
        }
        
        // Only show general completions when NOT in a member expression context
        return createGeneralCompletions();
        
    } catch (error) {
        connection.console.log('Completion error: ' + error);
        return createGeneralCompletions();
    }
}

function detectMemberCompletionContext(offset: number, tokens: any[]): { objectName: string } | undefined {
    // Look for pattern: LABEL DOT (cursor position)
    // We want to find tokens that come just before the cursor position
    
    let dotTokenIndex = -1;
    
    // Find the most recent DOT token before or at the cursor
    for (let i = tokens.length - 1; i >= 0; i--) {
        const token = tokens[i];
        if (token.type === TokenType.TK_DOT && token.pos < offset) {
            dotTokenIndex = i;
            break;
        }
    }
    
    // If we found a dot, check if there's a LABEL token immediately before it
    if (dotTokenIndex > 0) {
        const dotToken = tokens[dotTokenIndex];
        const prevToken = tokens[dotTokenIndex - 1];
        
        // Check if previous token is a LABEL and it's immediately before the dot
        if (prevToken.type === TokenType.TK_LABEL && prevToken.end === dotToken.pos) {
            // Make sure the cursor is after or at the dot (for completion)
            if (offset >= dotToken.end) {
                return {
                    objectName: prevToken.value as string
                };
            }
        }
    }
    
    return undefined;
}

function getFsObjectCompletions(objectName: string, analysisResult?: SemanticAnalysisResult): CompletionItem[] {
    if (!analysisResult || !analysisResult.symbolTable) {
        console.log(`[FS_COMPLETION] No analysisResult or symbolTable for ${objectName}`);
        return [];
    }

    // Look up the symbol in the symbol table
    const symbol = analysisResult.symbolTable.lookup(objectName);
    if (!symbol) {
        console.log(`[FS_COMPLETION] Symbol not found: ${objectName}`);
        // Debug the symbol table to see what's available
        analysisResult.symbolTable.debugLookup(objectName);
        return [];
    }

    console.log(`[FS_COMPLETION] Symbol found: ${objectName}, dataType: ${JSON.stringify(symbol.dataType)}`);

    // Check if this is an fs object type
    const fsType = fsTypeRegistry.isVariableOfFsType(symbol.dataType);
    if (!fsType) {
        console.log(`[FS_COMPLETION] Not an fs type: ${objectName}`);
        return [];
    }

    console.log(`[FS_COMPLETION] FS type detected: ${fsType} for ${objectName}`);

    // Get the methods for this fs type
    const methods = fsTypeRegistry.getMethodsForType(fsType);
    const completions: CompletionItem[] = [];

    // Create completion items for each method
    for (const methodName of methods) {
        const methodSignature = fsTypeRegistry.getFsMethod(fsType, methodName);
        if (methodSignature) {
            completions.push({
                label: methodName,
                kind: CompletionItemKind.Method,
                detail: `${fsType} method`,
                documentation: {
                    kind: MarkupKind.Markdown,
                    value: methodSignature.description || `${methodName}() method for ${fsType}`
                },
                insertText: `${methodName}($1)`,
                insertTextFormat: InsertTextFormat.Snippet
            });
        }
    }

    return completions;
}

function getNl80211ObjectCompletions(objectName: string, analysisResult?: SemanticAnalysisResult): CompletionItem[] {
    if (!analysisResult || !analysisResult.symbolTable) {
        console.log(`[NL80211_COMPLETION] No analysisResult or symbolTable for ${objectName}`);
        return [];
    }

    // Look up the symbol in the symbol table
    const symbol = analysisResult.symbolTable.lookup(objectName);
    if (!symbol) {
        console.log(`[NL80211_COMPLETION] Symbol not found: ${objectName}`);
        return [];
    }

    console.log(`[NL80211_COMPLETION] Symbol found: ${objectName}, dataType: ${JSON.stringify(symbol.dataType)}`);

    // Check if this is an nl80211 object type
    const nl80211Type = nl80211ObjectRegistry.isVariableOfNl80211Type(symbol.dataType);
    if (!nl80211Type) {
        console.log(`[NL80211_COMPLETION] Not an nl80211 type: ${objectName}`);
        return [];
    }

    console.log(`[NL80211_COMPLETION] NL80211 type detected: ${nl80211Type} for ${objectName}`);

    // Get the methods for this nl80211 type
    const methods = nl80211ObjectRegistry.getMethodsForType(nl80211Type);
    const completions: CompletionItem[] = [];

    // Create completion items for each method
    for (const methodName of methods) {
        const methodSignature = nl80211ObjectRegistry.getNl80211Method(nl80211Type, methodName);
        if (methodSignature) {
            completions.push({
                label: methodName,
                kind: CompletionItemKind.Method,
                detail: `${nl80211Type} method`,
                documentation: {
                    kind: MarkupKind.Markdown,
                    value: methodSignature.description || `${methodName}() method for ${nl80211Type}`
                },
                insertText: `${methodName}($1)`,
                insertTextFormat: InsertTextFormat.Snippet
            });
        }
    }

    return completions;
}

function getDebugModuleCompletions(objectName: string, analysisResult?: SemanticAnalysisResult): CompletionItem[] {
    if (!analysisResult || !analysisResult.symbolTable) {
        console.log(`[DEBUG_COMPLETION] No analysisResult or symbolTable for ${objectName}`);
        return [];
    }

    // Look up the symbol in the symbol table
    const symbol = analysisResult.symbolTable.lookup(objectName);
    if (!symbol) {
        console.log(`[DEBUG_COMPLETION] Symbol not found: ${objectName}`);
        return [];
    }

    console.log(`[DEBUG_COMPLETION] Symbol found: ${objectName}, type: ${symbol.type}`);

    // Check if this is a debug module import (namespace import)
    if (symbol.type === 'imported' && symbol.importedFrom === 'debug') {
        console.log(`[DEBUG_COMPLETION] Debug module detected for ${objectName}`);
        
        // Get all debug function names
        const functionNames = debugTypeRegistry.getFunctionNames();
        const completions: CompletionItem[] = [];
        
        // Create completion items for each debug function
        for (const functionName of functionNames) {
            const signature = debugTypeRegistry.getFunction(functionName);
            if (signature) {
                completions.push({
                    label: functionName,
                    kind: CompletionItemKind.Function,
                    detail: 'debug module function',
                    documentation: {
                        kind: MarkupKind.Markdown,
                        value: debugTypeRegistry.getFunctionDocumentation(functionName)
                    },
                    insertText: `${functionName}($1)`,
                    insertTextFormat: InsertTextFormat.Snippet
                });
            }
        }
        
        return completions;
    }

    return [];
}

function getDigestModuleCompletions(objectName: string, analysisResult?: SemanticAnalysisResult): CompletionItem[] {
    if (!analysisResult || !analysisResult.symbolTable) {
        console.log(`[DIGEST_COMPLETION] No analysisResult or symbolTable for ${objectName}`);
        return [];
    }

    // Look up the symbol in the symbol table
    const symbol = analysisResult.symbolTable.lookup(objectName);
    if (!symbol) {
        console.log(`[DIGEST_COMPLETION] Symbol not found: ${objectName}`);
        return [];
    }

    console.log(`[DIGEST_COMPLETION] Symbol found: ${objectName}, type: ${symbol.type}`);

    // Check if this is a digest module import (namespace import)
    if (symbol.type === 'imported' && symbol.importedFrom === 'digest') {
        console.log(`[DIGEST_COMPLETION] Digest module detected for ${objectName}`);
        
        // Get all digest function names
        const functionNames = digestTypeRegistry.getFunctionNames();
        const completions: CompletionItem[] = [];
        
        // Create completion items for each digest function
        for (const functionName of functionNames) {
            const signature = digestTypeRegistry.getFunction(functionName);
            if (signature) {
                completions.push({
                    label: functionName,
                    kind: CompletionItemKind.Function,
                    detail: 'digest module function',
                    documentation: {
                        kind: MarkupKind.Markdown,
                        value: digestTypeRegistry.getFunctionDocumentation(functionName)
                    },
                    insertText: `${functionName}($1)`,
                    insertTextFormat: InsertTextFormat.Snippet
                });
            }
        }
        
        return completions;
    }

    return [];
}

function getLogModuleCompletions(objectName: string, analysisResult?: SemanticAnalysisResult): CompletionItem[] {
    if (!analysisResult || !analysisResult.symbolTable) {
        return [];
    }

    const symbol = analysisResult.symbolTable.lookup(objectName);
    if (!symbol) {
        return [];
    }

    // Check if this is a log module import (namespace import)
    if (symbol.type === 'imported' && symbol.importedFrom === 'log') {
        const functionNames = logTypeRegistry.getFunctionNames();
        const completions: CompletionItem[] = [];
        
        for (const functionName of functionNames) {
            const signature = logTypeRegistry.getFunction(functionName);
            if (signature) {
                completions.push({
                    label: functionName,
                    kind: CompletionItemKind.Function,
                    detail: 'log module function',
                    documentation: {
                        kind: MarkupKind.Markdown,
                        value: logTypeRegistry.getFunctionDocumentation(functionName)
                    },
                    insertText: `${functionName}($1)`,
                    insertTextFormat: InsertTextFormat.Snippet
                });
            }
        }
        
        return completions;
    }

    return [];
}

function getMathModuleCompletions(objectName: string, analysisResult?: SemanticAnalysisResult): CompletionItem[] {
    if (!analysisResult || !analysisResult.symbolTable) {
        return [];
    }

    const symbol = analysisResult.symbolTable.lookup(objectName);
    if (!symbol) {
        return [];
    }

    // Check if this is a math module import (namespace import)
    if (symbol.type === 'imported' && symbol.importedFrom === 'math') {
        const functionNames = mathTypeRegistry.getFunctionNames();
        const completions: CompletionItem[] = [];
        
        for (const functionName of functionNames) {
            const signature = mathTypeRegistry.getFunction(functionName);
            if (signature) {
                completions.push({
                    label: functionName,
                    kind: CompletionItemKind.Function,
                    detail: 'math module function',
                    documentation: {
                        kind: MarkupKind.Markdown,
                        value: mathTypeRegistry.getFunctionDocumentation(functionName)
                    },
                    insertText: `${functionName}($1)`,
                    insertTextFormat: InsertTextFormat.Snippet
                });
            }
        }
        
        return completions;
    }

    return [];
}

function getNl80211ModuleCompletions(objectName: string, analysisResult?: SemanticAnalysisResult): CompletionItem[] {
    if (!analysisResult || !analysisResult.symbolTable) {
        return [];
    }

    const symbol = analysisResult.symbolTable.lookup(objectName);
    if (!symbol) {
        return [];
    }

    // Check if this is a nl80211 module import (namespace import)
    if (symbol.type === 'imported' && symbol.importedFrom === 'nl80211') {
        const functionNames = nl80211TypeRegistry.getFunctionNames();
        const constantNames = nl80211TypeRegistry.getConstantNames();
        const completions: CompletionItem[] = [];
        
        // Add function completions
        for (const functionName of functionNames) {
            const signature = nl80211TypeRegistry.getFunction(functionName);
            if (signature) {
                completions.push({
                    label: functionName,
                    kind: CompletionItemKind.Function,
                    detail: 'nl80211 module function',
                    documentation: {
                        kind: MarkupKind.Markdown,
                        value: nl80211TypeRegistry.getFunctionDocumentation(functionName)
                    },
                    insertText: `${functionName}($1)`,
                    insertTextFormat: InsertTextFormat.Snippet
                });
            }
        }
        
        // Add constant completions
        for (const constantName of constantNames) {
            const constant = nl80211TypeRegistry.getConstant(constantName);
            if (constant) {
                completions.push({
                    label: constantName,
                    kind: CompletionItemKind.Constant,
                    detail: 'nl80211 module constant',
                    documentation: {
                        kind: MarkupKind.Markdown,
                        value: nl80211TypeRegistry.getConstantDocumentation(constantName)
                    },
                    insertText: constantName,
                    insertTextFormat: InsertTextFormat.PlainText
                });
            }
        }
        
        return completions;
    }

    return [];
}

function getResolvModuleCompletions(objectName: string, analysisResult?: SemanticAnalysisResult): CompletionItem[] {
    if (!analysisResult || !analysisResult.symbolTable) {
        return [];
    }

    const symbol = analysisResult.symbolTable.lookup(objectName);
    if (!symbol) {
        return [];
    }

    // Check if this is a resolv module import (namespace import)
    if (symbol.type === 'imported' && symbol.importedFrom === 'resolv') {
        const functionNames = resolvTypeRegistry.getFunctionNames();
        const completions: CompletionItem[] = [];
        
        for (const functionName of functionNames) {
            const signature = resolvTypeRegistry.getFunction(functionName);
            if (signature) {
                completions.push({
                    label: functionName,
                    kind: CompletionItemKind.Function,
                    detail: 'resolv module function',
                    documentation: {
                        kind: MarkupKind.Markdown,
                        value: resolvTypeRegistry.getFunctionDocumentation(functionName)
                    },
                    insertText: `${functionName}($1)`,
                    insertTextFormat: InsertTextFormat.Snippet
                });
            }
        }
        
        return completions;
    }

    return [];
}

function getSocketModuleCompletions(objectName: string, analysisResult?: SemanticAnalysisResult): CompletionItem[] {
    if (!analysisResult || !analysisResult.symbolTable) {
        return [];
    }

    const symbol = analysisResult.symbolTable.lookup(objectName);
    if (!symbol) {
        return [];
    }

    // Check if this is a socket module import (namespace import)
    if (symbol.type === 'imported' && symbol.importedFrom === 'socket') {
        const functionNames = socketTypeRegistry.getFunctionNames();
        const constantNames = socketTypeRegistry.getConstantNames();
        const completions: CompletionItem[] = [];
        
        // Add function completions
        for (const functionName of functionNames) {
            const signature = socketTypeRegistry.getFunction(functionName);
            if (signature) {
                completions.push({
                    label: functionName,
                    kind: CompletionItemKind.Function,
                    detail: 'socket module function',
                    documentation: {
                        kind: MarkupKind.Markdown,
                        value: socketTypeRegistry.getFunctionDocumentation(functionName)
                    },
                    insertText: `${functionName}($1)`,
                    insertTextFormat: InsertTextFormat.Snippet
                });
            }
        }
        
        // Add constant completions
        for (const constantName of constantNames) {
            const constant = socketTypeRegistry.getConstant(constantName);
            if (constant) {
                completions.push({
                    label: constantName,
                    kind: CompletionItemKind.Constant,
                    detail: 'socket module constant',
                    documentation: {
                        kind: MarkupKind.Markdown,
                        value: socketTypeRegistry.getConstantDocumentation(constantName)
                    },
                    insertText: constantName,
                    insertTextFormat: InsertTextFormat.PlainText
                });
            }
        }
        
        return completions;
    }

    return [];
}

function getStructModuleCompletions(objectName: string, analysisResult?: SemanticAnalysisResult): CompletionItem[] {
    if (!analysisResult || !analysisResult.symbolTable) {
        return [];
    }

    const symbol = analysisResult.symbolTable.lookup(objectName);
    if (!symbol) {
        return [];
    }

    // Check if this is a struct module import (namespace import)
    if (symbol.type === 'imported' && symbol.importedFrom === 'struct') {
        const functionNames = structTypeRegistry.getFunctionNames();
        const completions: CompletionItem[] = [];
        
        // Add function completions
        for (const functionName of functionNames) {
            const signature = structTypeRegistry.getFunction(functionName);
            if (signature) {
                completions.push({
                    label: functionName,
                    kind: CompletionItemKind.Function,
                    detail: 'struct module function',
                    documentation: {
                        kind: MarkupKind.Markdown,
                        value: structTypeRegistry.getFunctionDocumentation(functionName)
                    },
                    insertText: `${functionName}($1)`,
                    insertTextFormat: InsertTextFormat.Snippet
                });
            }
        }
        
        return completions;
    }

    return [];
}

function createGeneralCompletions(): CompletionItem[] {
    const completions: CompletionItem[] = [];
    
    // Add built-in functions (including fs functions)
    for (const [functionName, documentation] of allBuiltinFunctions.entries()) {
        completions.push({
            label: functionName,
            kind: CompletionItemKind.Function,
            detail: 'built-in function',
            documentation: {
                kind: MarkupKind.Markdown,
                value: documentation
            },
            insertText: `${functionName}($1)`,
            insertTextFormat: InsertTextFormat.Snippet
        });
    }
    
    // Add common keywords
    const keywords = ['let', 'const', 'function', 'if', 'else', 'for', 'while', 'return', 'break', 'continue', 'try', 'catch', 'throw'];
    for (const keyword of keywords) {
        completions.push({
            label: keyword,
            kind: CompletionItemKind.Keyword,
            detail: 'ucode keyword',
            insertText: keyword
        });
    }
    
    return completions;
}

export function handleCompletionResolve(item: CompletionItem): CompletionItem {
    return item;
}