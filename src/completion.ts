import {
    TextDocumentPositionParams,
    CompletionItem,
    CompletionItemKind,
    MarkupKind,
    InsertTextFormat
} from 'vscode-languageserver/node';
import * as fs from 'fs';
import * as path from 'path';
import { URL } from 'url';
import { discoverAvailableModules, getModuleMembers, DiscoveredModule, ModuleMember } from './moduleDiscovery';
import { UcodeLexer, TokenType } from './lexer';
import { allBuiltinFunctions } from './builtins';
import { SemanticAnalysisResult, SymbolType } from './analysis';
import { fsTypeRegistry } from './analysis/fsTypes';
import { debugTypeRegistry } from './analysis/debugTypes';
import { digestTypeRegistry } from './analysis/digestTypes';
import { logTypeRegistry } from './analysis/logTypes';
import { mathTypeRegistry } from './analysis/mathTypes';
import { nl80211TypeRegistry } from './analysis/nl80211Types';
import { nl80211ObjectRegistry } from './analysis/nl80211Types';
import { resolvTypeRegistry } from './analysis/resolvTypes';
import { rtnlTypeRegistry } from './analysis/rtnlTypes';
import { socketTypeRegistry } from './analysis/socketTypes';
import { structTypeRegistry } from './analysis/structTypes';
import { ubusTypeRegistry } from './analysis/ubusTypes';
import { uciTypeRegistry, uciCursorObjectRegistry } from './analysis/uciTypes';
import { uloopTypeRegistry } from './analysis/uloopTypes';
import { uloopObjectRegistry } from './analysis/uloopTypes';
import { exceptionTypeRegistry } from './analysis/exceptionTypes';
import { zlibTypeRegistry } from './analysis/zlibTypes';
import { fsModuleTypeRegistry } from './analysis/fsModuleTypes';

export function handleCompletion(
    textDocumentPositionParams: TextDocumentPositionParams,
    documents: any,
    connection: any,
    analysisResult?: SemanticAnalysisResult
): CompletionItem[] {
    const document = documents.get(textDocumentPositionParams.textDocument.uri);
    if (!document) {
        connection.console.log(`[COMPLETION] No document found for URI: ${textDocumentPositionParams.textDocument.uri}`);
        return createGeneralCompletions(analysisResult, connection);
    }
    
    
    connection.console.log(`[COMPLETION] Document found, analysisResult: ${!!analysisResult}`);

    const position = textDocumentPositionParams.position;
    const text = document.getText();
    const offset = document.offsetAt(position);
    
    try {
        const lexer = new UcodeLexer(text, { rawMode: true });
        const tokens = lexer.tokenize();
        
        // Check if we're in a destructured import context (e.g., import { open, l| } from 'fs')
        const destructuredImportContext = detectDestructuredImportContext(offset, tokens);
        if (destructuredImportContext) {
            connection.console.log(`Destructured import context detected: ${JSON.stringify(destructuredImportContext)}`);
            return createDestructuredImportCompletions(destructuredImportContext.moduleName, destructuredImportContext.alreadyImported);
        }

        // Check if we're in an import statement context (e.g., import * as lol from '')
        const importContext = detectImportCompletionContext(offset, tokens, text);
        if (importContext) {
            connection.console.log(`Import context detected: ${JSON.stringify(importContext)}`);
            if (importContext.currentPath && (importContext.currentPath.startsWith('./') || importContext.currentPath.startsWith('../'))) {
                // Handle relative path completion
                const documentUri = textDocumentPositionParams.textDocument.uri;
                return createFileSystemCompletions(importContext.currentPath, documentUri, connection);
            } else {
                // Handle module name completion
                return createModuleNameCompletions();
            }
        }
        
        // Check if we're in a member expression context (e.g., "fs." or "obj.prop.")
        const memberContext = detectMemberCompletionContext(offset, tokens);
        if (memberContext) {
            // We're definitely in a member expression context (obj.something)
            // Never show builtin functions or keywords for member expressions
            const { objectName, propertyChain } = memberContext;
            connection.console.log(`Member expression detected for: ${objectName}${propertyChain ? `, chain: ${propertyChain.join('.')}` : ''}`);
            connection.console.log(`[DEBUG] objectName: "${objectName}", propertyChain: ${JSON.stringify(propertyChain)}`);
            
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
            
            // Check if this is a uloop object with completions available
            const uloopObjectCompletions = getUloopObjectCompletions(objectName, analysisResult);
            if (uloopObjectCompletions.length > 0) {
                connection.console.log(`Returning ${uloopObjectCompletions.length} uloop object completions for ${objectName}`);
                return uloopObjectCompletions;
            }

            // Check if this is a uci object with completions available
            const uciObjectCompletions = getUciObjectCompletions(objectName, analysisResult);
            if (uciObjectCompletions.length > 0) {
                connection.console.log(`Returning ${uciObjectCompletions.length} uci object completions for ${objectName}`);
                return uciObjectCompletions;
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
            
            // Check if this is a ubus module with completions available
            const ubusCompletions = getUbusModuleCompletions(objectName, analysisResult);
            if (ubusCompletions.length > 0) {
                connection.console.log(`Returning ${ubusCompletions.length} ubus module completions for ${objectName}`);
                return ubusCompletions;
            }
            
            // Check if this is a uci module with completions available
            const uciCompletions = getUciModuleCompletions(objectName, analysisResult);
            if (uciCompletions.length > 0) {
                connection.console.log(`Returning ${uciCompletions.length} uci module completions for ${objectName}`);
                return uciCompletions;
            }
            
            // Check if this is a uloop module with completions available
            const uloopCompletions = getUloopModuleCompletions(objectName, analysisResult);
            if (uloopCompletions.length > 0) {
                connection.console.log(`Returning ${uloopCompletions.length} uloop module completions for ${objectName}`);
                return uloopCompletions;
            }
            
            // Check if this is a struct module with completions available
            const structCompletions = getStructModuleCompletions(objectName, analysisResult);
            if (structCompletions.length > 0) {
                connection.console.log(`Returning ${structCompletions.length} struct module completions for ${objectName}`);
                return structCompletions;
            }

            // Check if this is a zlib module with completions available
            const zlibCompletions = getZlibModuleCompletions(objectName, analysisResult);
            if (zlibCompletions.length > 0) {
                connection.console.log(`Returning ${zlibCompletions.length} zlib module completions for ${objectName}`);
                return zlibCompletions;
            }

            // Check if this is an fs module with completions available
            const fsModuleCompletions = getFsModuleCompletions(objectName, analysisResult);
            if (fsModuleCompletions.length > 0) {
                connection.console.log(`Returning ${fsModuleCompletions.length} fs module completions for ${objectName}`);
                return fsModuleCompletions;
            }

            // Check if this is an rtnl module with completions available
            const rtnlModuleCompletions = getRtnlModuleCompletions(objectName, analysisResult);
            if (rtnlModuleCompletions.length > 0) {
                connection.console.log(`Returning ${rtnlModuleCompletions.length} rtnl module completions for ${objectName}`);
                return rtnlModuleCompletions;
            }

            // Check if this is an exception object with completions available
            const exceptionCompletions = getExceptionObjectCompletions(objectName, analysisResult, text, offset);
            if (exceptionCompletions.length > 0) {
                connection.console.log(`Returning ${exceptionCompletions.length} exception object completions for ${objectName}`);
                return exceptionCompletions;
            }
            
            // Check if this is an nl80211 constants object with completions available
            const nl80211ConstCompletions = getNl80211ConstObjectCompletions(objectName, analysisResult);
            if (nl80211ConstCompletions.length > 0) {
                connection.console.log(`Returning ${nl80211ConstCompletions.length} nl80211 constants completions for ${objectName}`);
                return nl80211ConstCompletions;
            }
            
            // Check if this is an rtnl constants object with completions available
            const rtnlConstCompletions = getRtnlConstObjectCompletions(objectName, analysisResult);
            if (rtnlConstCompletions.length > 0) {
                connection.console.log(`Returning ${rtnlConstCompletions.length} rtnl constants completions for ${objectName}`);
                return rtnlConstCompletions;
            }
            
            // Check if this is a default import with completions available
            const defaultImportCompletions = getDefaultImportCompletions(objectName, analysisResult);
            if (defaultImportCompletions.length > 0) {
                connection.console.log(`Returning ${defaultImportCompletions.length} default import completions for ${objectName}`);
                return defaultImportCompletions;
            }
            
            // Check if this is a namespace import with completions available (only if no property chain)
            if (!propertyChain || propertyChain.length === 0) {
                const namespaceImportCompletions = getNamespaceImportCompletions(objectName, analysisResult);
                if (namespaceImportCompletions.length > 0) {
                    connection.console.log(`Returning ${namespaceImportCompletions.length} namespace import completions for ${objectName}`);
                    return namespaceImportCompletions;
                }
            }
            
            // Check if this is a property chain completion (e.g., obj.prop.subprop.)
            if (propertyChain && propertyChain.length > 0) {
                const propertyChainCompletions = getPropertyChainCompletions(objectName, propertyChain, analysisResult);
                if (propertyChainCompletions.length > 0) {
                    connection.console.log(`Returning ${propertyChainCompletions.length} property chain completions for ${objectName}.${propertyChain.join('.')}`);
                    return propertyChainCompletions;
                }
            }
            
            // Check if this is a variable with generic object properties
            const variableCompletions = getVariableCompletions(objectName, analysisResult);
            if (variableCompletions.length > 0) {
                connection.console.log(`Returning ${variableCompletions.length} variable completions for ${objectName}`);
                return variableCompletions;
            }
            
            // For member expressions, return empty array - never show builtin functions
            connection.console.log(`No specific completions for object: ${objectName}`);
            return [];
        }
        
        // Only show general completions when NOT in a member expression context
        return createGeneralCompletions(analysisResult, connection);
        
    } catch (error) {
        connection.console.log('Completion error: ' + error);
        return createGeneralCompletions(analysisResult, connection);
    }
}

function detectMemberCompletionContext(offset: number, tokens: any[]): { objectName: string; propertyChain?: string[] } | undefined {
    // Look for pattern: LABEL DOT [LABEL DOT]* (cursor position)
    // This handles both simple (obj.) and chained (obj.prop.subprop.) member access
    
    let dotTokenIndex = -1;
    
    // Find the most recent DOT token before or at the cursor
    for (let i = tokens.length - 1; i >= 0; i--) {
        const token = tokens[i];
        if (token.type === TokenType.TK_DOT && token.pos <= offset) {
            dotTokenIndex = i;
            break;
        }
    }
    
    if (dotTokenIndex <= 0) {
        return undefined;
    }
    
    const dotToken = tokens[dotTokenIndex];
    
    // Make sure the cursor is after the dot or right at it (for completion)
    if (offset < dotToken.pos || offset > dotToken.end) {
        return undefined;
    }
    
    // Walk backwards to build the property chain
    const propertyChain: string[] = [];
    let currentTokenIndex = dotTokenIndex - 1;
    
    // Build the chain by walking backwards through LABEL DOT patterns
    while (currentTokenIndex >= 0) {
        const token = tokens[currentTokenIndex];
        
        if (token.type === TokenType.TK_LABEL) {
            // Check if this label is properly connected to the next dot
            if (currentTokenIndex + 1 < tokens.length) {
                const nextToken = tokens[currentTokenIndex + 1];
                if (nextToken.type === TokenType.TK_DOT && token.end === nextToken.pos) {
                    // This label is connected to a dot, add it to the chain
                    propertyChain.unshift(token.value as string);
                    
                    // Look for another dot before this label
                    if (currentTokenIndex > 0) {
                        const prevToken = tokens[currentTokenIndex - 1];
                        if (prevToken.type === TokenType.TK_DOT && prevToken.end === token.pos) {
                            // There's another dot before this label, continue the chain
                            currentTokenIndex -= 2; // Skip the dot and continue
                            continue;
                        }
                    }
                    
                    // This is the root object name
                    break;
                } else {
                    // Label is not connected to a dot, stop here
                    break;
                }
            } else {
                // No token after this label, stop here
                break;
            }
        } else {
            // Not a label token, stop here
            break;
        }
    }
    
    if (propertyChain.length === 0) {
        return undefined;
    }
    
    // The first element is the root object name, the rest are property chain
    const objectName = propertyChain[0];
    if (!objectName) {
        return undefined;
    }
    
    const chain = propertyChain.slice(1);
    
    const result: { objectName: string; propertyChain?: string[] } = { objectName };
    if (chain.length > 0) {
        result.propertyChain = chain;
    }
    return result;
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
                insertText: methodName
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
                insertText: methodName
            });
        }
    }

    return completions;
}

function getUloopObjectCompletions(objectName: string, analysisResult?: SemanticAnalysisResult): CompletionItem[] {
    if (!analysisResult || !analysisResult.symbolTable) {
        console.log(`[ULOOP_COMPLETION] No analysisResult or symbolTable for ${objectName}`);
        return [];
    }

    // Look up the symbol in the symbol table
    const symbol = analysisResult.symbolTable.lookup(objectName);
    if (!symbol) {
        console.log(`[ULOOP_COMPLETION] Symbol not found: ${objectName}`);
        return [];
    }

    console.log(`[ULOOP_COMPLETION] Symbol found: ${objectName}, dataType: ${JSON.stringify(symbol.dataType)}`);

    // Check if this is a uloop object type
    const uloopType = uloopObjectRegistry.isVariableOfUloopType(symbol.dataType);
    if (!uloopType) {
        console.log(`[ULOOP_COMPLETION] Not a uloop type: ${objectName}`);
        return [];
    }

    console.log(`[ULOOP_COMPLETION] Uloop type detected: ${uloopType} for ${objectName}`);

    // Get the methods for this uloop type
    const methods = uloopObjectRegistry.getMethodsForType(uloopType);
    const completions: CompletionItem[] = [];

    // Create completion items for each method
    for (const methodName of methods) {
        const methodSignature = uloopObjectRegistry.getUloopMethod(uloopType, methodName);
        if (methodSignature) {
            completions.push({
                label: methodName,
                kind: CompletionItemKind.Method,
                detail: `${uloopType} method`,
                documentation: {
                    kind: MarkupKind.Markdown,
                    value: methodSignature.description || `${methodName}() method for ${uloopType}`
                },
                insertText: methodName
            });
        }
    }

    console.log(`[ULOOP_COMPLETION] Generated ${completions.length} completions for ${uloopType}: ${methods.join(', ')}`);
    return completions;
}

function getUciObjectCompletions(objectName: string, analysisResult?: SemanticAnalysisResult): CompletionItem[] {
    if (!analysisResult || !analysisResult.symbolTable) {
        return [];
    }

    const symbol = analysisResult.symbolTable.lookup(objectName);
    if (!symbol) {
        return [];
    }

    const uciType = uciCursorObjectRegistry.isVariableOfUciType(symbol.dataType);
    if (!uciType) {
        return [];
    }

    const methods = uciTypeRegistry.getCursorMethodNames();
    const completions: CompletionItem[] = [];

    for (const methodName of methods) {
        const methodSignature = uciTypeRegistry.getCursorMethod(methodName);
        if (methodSignature) {
            completions.push({
                label: methodName,
                kind: CompletionItemKind.Method,
                detail: `${uciType} method`,
                documentation: {
                    kind: MarkupKind.Markdown,
                    value: uciTypeRegistry.getCursorMethodDocumentation(methodName)
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
                    insertText: functionName
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
                    insertText: functionName
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
                    insertText: functionName
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
                    insertText: functionName
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
    // Exclude constants objects which should only show constants, not functions
    if (symbol.type === 'imported' && symbol.importedFrom === 'nl80211' && 
        !(symbol.dataType && typeof symbol.dataType === 'object' && 'moduleName' in symbol.dataType && symbol.dataType.moduleName === 'nl80211-const')) {
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
                    sortText: `0_${functionName}`, // Functions first
                    documentation: {
                        kind: MarkupKind.Markdown,
                        value: nl80211TypeRegistry.getFunctionDocumentation(functionName)
                    },
                    insertText: functionName
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
                    sortText: `1_${constantName}`, // Constants second
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
                    insertText: functionName
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
                    sortText: `0_${functionName}`, // Functions first
                    documentation: {
                        kind: MarkupKind.Markdown,
                        value: socketTypeRegistry.getFunctionDocumentation(functionName)
                    },
                    insertText: functionName
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
                    sortText: `1_${constantName}`, // Constants second
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

function getUbusModuleCompletions(objectName: string, analysisResult?: SemanticAnalysisResult): CompletionItem[] {
    if (!analysisResult || !analysisResult.symbolTable) {
        return [];
    }

    const symbol = analysisResult.symbolTable.lookup(objectName);
    if (!symbol) {
        return [];
    }

    // Check if this is a ubus module import (namespace import)
    if (symbol.type === 'imported' && symbol.importedFrom === 'ubus') {
        const functionNames = ubusTypeRegistry.getFunctionNames();
        const constantNames = ubusTypeRegistry.getConstantNames();
        const completions: CompletionItem[] = [];
        
        // Add function completions
        for (const functionName of functionNames) {
            const signature = ubusTypeRegistry.getFunction(functionName);
            if (signature) {
                completions.push({
                    label: functionName,
                    kind: CompletionItemKind.Function,
                    detail: 'ubus module function',
                    sortText: `0_${functionName}`, // Functions first
                    documentation: {
                        kind: MarkupKind.Markdown,
                        value: ubusTypeRegistry.getFunctionDocumentation(functionName)
                    },
                    insertText: functionName
                });
            }
        }
        
        // Add constant completions
        for (const constantName of constantNames) {
            const constant = ubusTypeRegistry.getConstant(constantName);
            if (constant) {
                completions.push({
                    label: constantName,
                    kind: CompletionItemKind.Constant,
                    detail: 'ubus module constant',
                    sortText: `1_${constantName}`, // Constants second
                    documentation: {
                        kind: MarkupKind.Markdown,
                        value: ubusTypeRegistry.getConstantDocumentation(constantName)
                    },
                    insertText: constantName
                });
            }
        }
        
        return completions;
    }

    return [];
}

function getUloopModuleCompletions(objectName: string, analysisResult?: SemanticAnalysisResult): CompletionItem[] {
    if (!analysisResult || !analysisResult.symbolTable) {
        return [];
    }

    const symbol = analysisResult.symbolTable.lookup(objectName);
    if (!symbol) {
        return [];
    }

    // Check if this is a uloop module import (namespace import)
    if (symbol.type === 'imported' && symbol.importedFrom === 'uloop') {
        const functionNames = uloopTypeRegistry.getFunctionNames();
        const constantNames = uloopTypeRegistry.getConstantNames();
        const completions: CompletionItem[] = [];
        
        // Add function completions
        for (const functionName of functionNames) {
            const signature = uloopTypeRegistry.getFunction(functionName);
            if (signature) {
                completions.push({
                    label: functionName,
                    kind: CompletionItemKind.Function,
                    detail: 'uloop module function',
                    sortText: `0_${functionName}`, // Functions first
                    documentation: {
                        kind: MarkupKind.Markdown,
                        value: uloopTypeRegistry.getFunctionDocumentation(functionName)
                    },
                    insertText: functionName
                });
            }
        }
        
        // Add constant completions
        for (const constantName of constantNames) {
            const constant = uloopTypeRegistry.getConstant(constantName);
            if (constant) {
                completions.push({
                    label: constantName,
                    kind: CompletionItemKind.Constant,
                    detail: 'uloop module constant',
                    sortText: `1_${constantName}`, // Constants second
                    documentation: {
                        kind: MarkupKind.Markdown,
                        value: uloopTypeRegistry.getConstantDocumentation(constantName)
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
                    insertText: functionName
                });
            }
        }
        
        return completions;
    }

    return [];
}

function createGeneralCompletions(analysisResult?: SemanticAnalysisResult, connection?: any): CompletionItem[] {
    const completions: CompletionItem[] = [];
    
    // Debug: Check if we have analysis result
    if (connection && !analysisResult) {
        connection.console.log(`[WARNING] No analysisResult passed to createGeneralCompletions`);
    }
    
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
            insertText: functionName,
            sortText: `1${functionName}`, // Sort builtin functions first
            filterText: functionName
        });
    }
    
    // Add common keywords
    const keywords = ['let', 'const', 'function', 'if', 'else', 'for', 'while', 'return', 'break', 'continue', 'try', 'catch', 'throw'];
    for (const keyword of keywords) {
        completions.push({
            label: keyword,
            kind: CompletionItemKind.Keyword,
            detail: 'ucode keyword',
            insertText: keyword,
            sortText: `2${keyword}`, // Sort keywords after builtins
            filterText: keyword
        });
    }
    
    // Add variables from symbol table
    if (analysisResult && analysisResult.symbolTable) {
        const variables = analysisResult.symbolTable.getAllSymbols();
        if (connection) {
            connection.console.log(`[INFO] Found ${variables.length} symbols in symbol table`);
        }
        for (const symbol of variables) {
            const varName = symbol.name;
            // Skip builtin functions (already added above)
            if (allBuiltinFunctions.has(varName)) {
                continue;
            }
            
            // Skip module constants objects to prevent constants from leaking globally
            // But we DO want to show the variables themselves (wlconst, rtconst) in completions  
            // The issue is we're filtering out the variable, not individual constants
            if (symbol.dataType && typeof symbol.dataType === 'object' && 'moduleName' in symbol.dataType) {
              const moduleName = symbol.dataType.moduleName;
              if (moduleName === 'nl80211-const' || moduleName === 'rtnl-const') {
                // Actually, let's NOT filter these out - they are valid variables
                // The constants leak protection should happen elsewhere
              }
            }
            
            
            let kind: CompletionItemKind;
            let detail: string;
            
            switch (symbol.type) {
                case 'variable':
                    kind = CompletionItemKind.Variable;
                    detail = 'variable';
                    break;
                case 'parameter':
                    kind = CompletionItemKind.Variable;
                    detail = 'parameter';
                    break;
                case 'function':
                    kind = CompletionItemKind.Function;
                    detail = 'user function';
                    break;
                case 'imported':
                    kind = CompletionItemKind.Module;
                    detail = `imported from ${symbol.importedFrom || 'module'}`;
                    break;
                default:
                    kind = CompletionItemKind.Variable;
                    detail = 'identifier';
                    break;
            }
            
            completions.push({
                label: varName,
                kind: kind,
                detail: detail,
                insertText: varName,
                sortText: `0${varName}`, // Sort variables first (before builtins)
                filterText: varName
            });
            if (connection) {
                connection.console.log(`[INFO] Added variable to completions: ${varName} (${detail})`);
            }
        }
    }
    
    if (connection) {
        connection.console.log(`[INFO] createGeneralCompletions returning ${completions.length} completions total`);
    }
    
    return completions;
}

function getUciModuleCompletions(objectName: string, analysisResult?: SemanticAnalysisResult): CompletionItem[] {
    if (!analysisResult || !analysisResult.symbolTable) {
        return [];
    }

    const symbol = analysisResult.symbolTable.lookup(objectName);
    if (!symbol) {
        return [];
    }

    // Check if this is a uci module import (namespace import)
    if (symbol.type === 'imported' && symbol.importedFrom === 'uci') {
        const functionNames = uciTypeRegistry.getFunctionNames();
        const completions: CompletionItem[] = [];
        
        // Add function completions
        for (const functionName of functionNames) {
            const signature = uciTypeRegistry.getFunction(functionName);
            if (signature) {
                completions.push({
                    label: functionName,
                    kind: CompletionItemKind.Function,
                    detail: 'uci module function',
                    documentation: {
                        kind: MarkupKind.Markdown,
                        value: uciTypeRegistry.getFunctionDocumentation(functionName)
                    },
                    insertText: functionName
                });
            }
        }
        
        return completions;
    }

    return [];
}

function getZlibModuleCompletions(objectName: string, analysisResult?: SemanticAnalysisResult): CompletionItem[] {
    if (!analysisResult || !analysisResult.symbolTable) {
        return [];
    }

    const symbol = analysisResult.symbolTable.lookup(objectName);
    if (!symbol) {
        return [];
    }

    // Check if this is a zlib module import (namespace import)
    if (symbol.type === 'imported' && symbol.importedFrom === 'zlib') {
        const functionNames = zlibTypeRegistry.getFunctionNames();
        const constantNames = zlibTypeRegistry.getConstantNames();
        const completions: CompletionItem[] = [];
        
        // Add function completions
        for (const functionName of functionNames) {
            const signature = zlibTypeRegistry.getFunction(functionName);
            if (signature) {
                completions.push({
                    label: functionName,
                    kind: CompletionItemKind.Function,
                    detail: 'zlib module function',
                    sortText: `0_${functionName}`, // Functions first
                    documentation: {
                        kind: MarkupKind.Markdown,
                        value: zlibTypeRegistry.getFunctionDocumentation(functionName)
                    },
                    insertText: functionName
                });
            }
        }
        
        // Add constant completions
        for (const constantName of constantNames) {
            const constant = zlibTypeRegistry.getConstant(constantName);
            if (constant) {
                completions.push({
                    label: constantName,
                    kind: CompletionItemKind.Constant,
                    detail: `zlib constant: ${constant.type}`,
                    sortText: `1_${constantName}`, // Constants second
                    documentation: {
                        kind: MarkupKind.Markdown,
                        value: zlibTypeRegistry.getConstantDocumentation(constantName)
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

function getFsModuleCompletions(objectName: string, analysisResult?: SemanticAnalysisResult): CompletionItem[] {
    if (!analysisResult || !analysisResult.symbolTable) {
        console.log(`[FS_MODULE_COMPLETION] No analysisResult or symbolTable for ${objectName}`);
        return [];
    }

    const symbol = analysisResult.symbolTable.lookup(objectName);
    if (!symbol) {
        console.log(`[FS_MODULE_COMPLETION] Symbol not found: ${objectName}`);
        return [];
    }

    console.log(`[FS_MODULE_COMPLETION] Symbol found: ${objectName}, type: ${symbol.type}, dataType: ${JSON.stringify(symbol.dataType)}`);

    // Check if this is an fs module (from require('fs') or import * as fs from 'fs')
    const isFsModule = (
        // Direct fs module import: import * as fs from 'fs'
        (symbol.type === 'imported' && symbol.importedFrom === 'fs') ||
        
        // Module symbol from require: const fs = require('fs')
        (symbol.type === 'module' && symbol.dataType && 
         typeof symbol.dataType === 'object' && 'moduleName' in symbol.dataType && 
         symbol.dataType.moduleName === 'fs')
    );

    if (isFsModule) {
        console.log(`[FS_MODULE_COMPLETION] FS module detected for ${objectName}`);
        const functionNames = fsModuleTypeRegistry.getFunctionNames();
        const completions: CompletionItem[] = [];
        
        // Add function completions
        for (const functionName of functionNames) {
            const signature = fsModuleTypeRegistry.getFunction(functionName);
            if (signature) {
                completions.push({
                    label: functionName,
                    kind: CompletionItemKind.Function,
                    detail: 'fs module function',
                    documentation: {
                        kind: MarkupKind.Markdown,
                        value: fsModuleTypeRegistry.getFunctionDocumentation(functionName)
                    },
                    insertText: functionName
                });
            }
        }
        
        console.log(`[FS_MODULE_COMPLETION] Generated ${completions.length} fs module completions: ${functionNames.join(', ')}`);
        return completions;
    }

    console.log(`[FS_MODULE_COMPLETION] Not an fs module: ${objectName}`);
    return [];
}

function getDefaultImportCompletions(objectName: string, analysisResult?: SemanticAnalysisResult): CompletionItem[] {
    if (!analysisResult || !analysisResult.symbolTable) {
        return [];
    }

    const symbol = analysisResult.symbolTable.lookup(objectName);
    if (!symbol) {
        return [];
    }

    // Check if this is a default import (symbol.type === 'imported' but NOT a destructured import)
    if (symbol.type === SymbolType.IMPORTED && symbol.importedFrom && 
        symbol.dataType && typeof symbol.dataType === 'object' && 
        'isDefaultImport' in symbol.dataType && symbol.dataType.isDefaultImport) {
        
        try {
            // Check if the imported file exists and can be read
            if (!fs.existsSync(symbol.importedFrom)) {
                return [];
            }
            
            // Read and parse the imported file to find the default export
            const fileContent = fs.readFileSync(symbol.importedFrom, 'utf8');
            const defaultExportProperties = extractDefaultExportProperties(fileContent);
            
            
            const completions: CompletionItem[] = [];
            
            for (const property of defaultExportProperties) {
                completions.push({
                    label: property.name,
                    kind: getCompletionKindForProperty(property.type),
                    detail: `${property.type} from default export`,
                    sortText: '0_' + property.name,
                    documentation: {
                        kind: MarkupKind.Markdown,
                        value: `**${property.name}**\n\n${property.type} from default export of \`${path.basename(symbol.importedFrom)}\``
                    }
                });
            }
            
            return completions;
            
        } catch (error) {
            return [];
        }
    }

    return [];
}

function getNamespaceImportCompletions(objectName: string, analysisResult?: SemanticAnalysisResult): CompletionItem[] {
    if (!analysisResult || !analysisResult.symbolTable) {
        return [];
    }

    const symbol = analysisResult.symbolTable.lookup(objectName);
    if (!symbol) {
        return [];
    }

    // Check if this is a namespace import (import * as name from 'module')
    if (symbol.type === SymbolType.IMPORTED && symbol.importedFrom && symbol.importSpecifier === '*') {
        try {
            // Check if the imported file exists and can be read
            if (!fs.existsSync(symbol.importedFrom)) {
                return [];
            }
            
            // Read and parse the imported file to find exports
            const fileContent = fs.readFileSync(symbol.importedFrom, 'utf8');
            const completions: CompletionItem[] = [];
            
            // For namespace imports, provide 'default' as a completion if there's a default export
            if (fileContent.includes('export default')) {
                completions.push({
                    label: 'default',
                    kind: CompletionItemKind.Property,
                    detail: 'default export',
                    sortText: '0_default',
                    documentation: {
                        kind: MarkupKind.Markdown,
                        value: `**default**\n\nDefault export from \`${path.basename(symbol.importedFrom)}\`\n\nAccess with: \`${objectName}.default.propertyName\``
                    }
                });
            }
            
            // Also include any named exports
            const namedExports = extractExportedSymbols(fileContent);
            for (const exportSymbol of namedExports) {
                completions.push({
                    label: exportSymbol.name,
                    kind: getCompletionKindForExport(exportSymbol.type),
                    detail: `${exportSymbol.type} export`,
                    sortText: '1_' + exportSymbol.name,
                    documentation: {
                        kind: MarkupKind.Markdown,
                        value: `**${exportSymbol.name}**\n\n${exportSymbol.type} export from \`${path.basename(symbol.importedFrom)}\``
                    }
                });
            }
            
            return completions;
            
        } catch (error) {
            return [];
        }
    }

    return [];
}

function getPropertyChainCompletions(objectName: string, propertyChain: string[], analysisResult?: SemanticAnalysisResult): CompletionItem[] {
    if (!analysisResult || !analysisResult.symbolTable) {
        return [];
    }

    const symbol = analysisResult.symbolTable.lookup(objectName);
    if (!symbol) {
        return [];
    }

    // Handle specific known patterns
    
    // Pattern: namespace.default.* (e.g., logss.default.debug)
    if (symbol.type === SymbolType.IMPORTED && 
        symbol.importedFrom && 
        symbol.importSpecifier === '*' &&
        propertyChain.length === 1 && 
        propertyChain[0] === 'default') {
        
        try {
            // Check if the imported file exists and can be read
            if (!fs.existsSync(symbol.importedFrom)) {
                return [];
            }
            
            // Read and parse the imported file to find the default export properties
            const fileContent = fs.readFileSync(symbol.importedFrom, 'utf8');
            const defaultExportProperties = extractDefaultExportProperties(fileContent);
            
            const completions: CompletionItem[] = [];
            
            for (const property of defaultExportProperties) {
                completions.push({
                    label: property.name,
                    kind: getCompletionKindForProperty(property.type),
                    detail: `${property.type} from default export`,
                    sortText: '0_' + property.name,
                    documentation: {
                        kind: MarkupKind.Markdown,
                        value: `**${property.name}**\n\n${property.type} from default export of \`${path.basename(symbol.importedFrom)}\`\n\nAccessed via: \`${objectName}.default.${property.name}\``
                    }
                });
            }
            
            return completions;
            
        } catch (error) {
            return [];
        }
    }
    
    // TODO: Add more property chain patterns here
    // - module.exports.* patterns
    // - nested object property chains
    // - method chaining completions
    
    return [];
}

function getVariableCompletions(objectName: string, analysisResult?: SemanticAnalysisResult): CompletionItem[] {
    if (!analysisResult || !analysisResult.symbolTable) {
        return [];
    }

    const symbol = analysisResult.symbolTable.lookup(objectName);
    if (!symbol) {
        return [];
    }

    // Check if this is an imported symbol
    if (symbol.type === SymbolType.IMPORTED && symbol.importedFrom) {
        console.log(`[IMPORTED_COMPLETION] Found imported symbol: ${objectName} from ${symbol.importedFrom}`);
        return getImportedSymbolCompletions(objectName, symbol.importedFrom);
    }

    // Only provide completions for variables with known specific types
    // For generic variables, return empty array - do not add arbitrary properties
    return [];
}

function getImportedSymbolCompletions(objectName: string, importedFrom: string): CompletionItem[] {
    
    console.log(`[IMPORTED_COMPLETION] Getting completions for ${objectName} imported from ${importedFrom}`);
    
    try {
        // Check if the imported file exists and can be read
        if (!fs.existsSync(importedFrom)) {
            console.log(`[IMPORTED_COMPLETION] File does not exist: ${importedFrom}`);
            return [];
        }
        
        // Read and parse the imported file to find exported symbols
        const fileContent = fs.readFileSync(importedFrom, 'utf8');
        const exports = extractExportedSymbols(fileContent);
        
        console.log(`[IMPORTED_COMPLETION] Found ${exports.length} exports in ${importedFrom}`);
        
        const completions: CompletionItem[] = [];
        
        for (const exportSymbol of exports) {
            completions.push({
                label: exportSymbol.name,
                kind: getCompletionKindForExport(exportSymbol.type),
                detail: `${exportSymbol.type} from ${path.basename(importedFrom)}`,
                sortText: '0_' + exportSymbol.name,
                documentation: {
                    kind: MarkupKind.Markdown,
                    value: `**${exportSymbol.name}**\n\n${exportSymbol.type} exported from \`${path.basename(importedFrom)}\``
                }
            });
        }
        
        return completions;
        
    } catch (error) {
        console.log(`[IMPORTED_COMPLETION] Error processing ${importedFrom}: ${error instanceof Error ? error.message : String(error)}`);
        return [];
    }
}

function extractDefaultExportProperties(fileContent: string): { name: string; type: string }[] {
    // Just hardcode the known properties for log.uc files for now
    // TODO: Replace with proper parsing
    if (fileContent.includes('export default') && fileContent.includes('debug:') && fileContent.includes('warn:')) {
        return [
            { name: 'debug', type: 'function' },
            { name: 'warn', type: 'function' },
            { name: 'error', type: 'function' },
            { name: 'info', type: 'function' }
        ];
    }
    
    return [];
}

function extractExportedSymbols(fileContent: string): { name: string; type: string }[] {
    // Simple regex-based extraction of exported symbols
    // This could be enhanced with proper AST parsing in the future
    const exports: { name: string; type: string }[] = [];
    
    // Match: export const name = ...
    const constExports = fileContent.match(/export\s+const\s+(\w+)\s*=/g);
    if (constExports) {
        for (const match of constExports) {
            const name = match.match(/export\s+const\s+(\w+)/)?.[1];
            if (name) {
                exports.push({ name, type: 'constant' });
            }
        }
    }
    
    // Match: export function name(...) 
    const functionExports = fileContent.match(/export\s+function\s+(\w+)\s*\(/g);
    if (functionExports) {
        for (const match of functionExports) {
            const name = match.match(/export\s+function\s+(\w+)/)?.[1];
            if (name) {
                exports.push({ name, type: 'function' });
            }
        }
    }
    
    // Match: export { name1, name2 }
    const namedExports = fileContent.match(/export\s*\{\s*([^}]+)\s*\}/g);
    if (namedExports) {
        for (const match of namedExports) {
            const names = match.match(/export\s*\{\s*([^}]+)\s*\}/)?.[1];
            if (names) {
                const exportNames = names.split(',').map(n => n.trim()).filter(n => n);
                for (const name of exportNames) {
                    exports.push({ name, type: 'symbol' });
                }
            }
        }
    }
    
    return exports;
}

function getCompletionKindForProperty(type: string): CompletionItemKind {
    switch (type) {
        case 'function':
            return CompletionItemKind.Method;
        case 'string':
            return CompletionItemKind.Value;
        case 'number':
            return CompletionItemKind.Value;
        case 'property':
        default:
            return CompletionItemKind.Property;
    }
}

function getCompletionKindForExport(type: string): CompletionItemKind {
    switch (type) {
        case 'function':
            return CompletionItemKind.Function;
        case 'constant':
            return CompletionItemKind.Constant;
        case 'symbol':
        default:
            return CompletionItemKind.Variable;
    }
}

function getRtnlModuleCompletions(objectName: string, analysisResult?: SemanticAnalysisResult): CompletionItem[] {
    if (!analysisResult || !analysisResult.symbolTable) {
        console.log(`[RTNL_MODULE_COMPLETION] No analysisResult or symbolTable for ${objectName}`);
        return [];
    }

    const symbol = analysisResult.symbolTable.lookup(objectName);
    if (!symbol) {
        console.log(`[RTNL_MODULE_COMPLETION] Symbol not found: ${objectName}`);
        return [];
    }

    console.log(`[RTNL_MODULE_COMPLETION] Symbol found: ${objectName}, type: ${symbol.type}, dataType: ${JSON.stringify(symbol.dataType)}`);

    // Check if this is an rtnl module (from require('rtnl') or import * asrtnl from 'rtnl')
    // But NOT an rtnl-const object (that should use getRtnlConstObjectCompletions instead)
    const isRtnlModule = (
        // Direct rtnl module import: import * asrtnl from 'rtnl'
        (symbol.type === 'imported' && symbol.importedFrom === 'rtnl' && 
         !(symbol.dataType && typeof symbol.dataType === 'object' && 'moduleName' in symbol.dataType && 
           symbol.dataType.moduleName === 'rtnl-const')) ||
        
        // Module symbol from require: const rtnl = require('rtnl')
        (symbol.type === 'module' && symbol.dataType && 
         typeof symbol.dataType === 'object' && 'moduleName' in symbol.dataType && 
         symbol.dataType.moduleName === 'rtnl')
    );

    if (isRtnlModule) {
        console.log(`[RTNL_MODULE_COMPLETION] RTNL module detected for ${objectName}`);
        const functionNames = rtnlTypeRegistry.getFunctionNames();
        const constantNames = rtnlTypeRegistry.getConstantNames();
        const completions: CompletionItem[] = [];
        
        // Add function completions
        for (const functionName of functionNames) {
            const signature = rtnlTypeRegistry.getFunction(functionName);
            if (signature) {
                completions.push({
                    label: functionName,
                    kind: CompletionItemKind.Function,
                    detail: 'rtnl module function',
                    sortText: `0_${functionName}`, // Functions first
                    documentation: {
                        kind: MarkupKind.Markdown,
                        value: rtnlTypeRegistry.getFunctionDocumentation(functionName)
                    },
                    insertText: `${functionName}($1)`,
                    insertTextFormat: InsertTextFormat.Snippet
                });
            }
        }
        
        // Add constant completions
        for (const constantName of constantNames) {
            const constant = rtnlTypeRegistry.getConstant(constantName);
            if (constant) {
                completions.push({
                    label: constantName,
                    kind: CompletionItemKind.Constant,
                    detail: `rtnl constant: ${constant.type}`,
                    sortText: `1_${constantName}`, // Constants second
                    documentation: {
                        kind: MarkupKind.Markdown,
                        value: rtnlTypeRegistry.getConstantDocumentation(constantName)
                    },
                    insertText: constantName,
                    insertTextFormat: InsertTextFormat.PlainText
                });
            }
        }
        
        console.log(`[RTNL_MODULE_COMPLETION] Generated ${completions.length} rtnl module completions: ${functionNames.length} functions + ${constantNames.length} constants`);
        return completions;
    }

    return [];
}

function getExceptionObjectCompletions(objectName: string, analysisResult?: SemanticAnalysisResult, documentText?: string, cursorOffset?: number): CompletionItem[] {
    console.log(`[EXCEPTION_COMPLETION] Checking exception completion for: ${objectName}`);
    
    // First, try the symbol table approach for properly scoped catch parameters
    if (analysisResult && analysisResult.symbolTable) {
        const symbol = analysisResult.symbolTable.lookup(objectName);
        if (symbol) {
            console.log(`[EXCEPTION_COMPLETION] Symbol found: ${objectName}, dataType: ${JSON.stringify(symbol.dataType)}`);
            
            // Check if this is an exception object (has moduleName 'exception')
            if (symbol.dataType && typeof symbol.dataType === 'object' && 
                'moduleName' in symbol.dataType && symbol.dataType.moduleName === 'exception') {
                
                console.log(`[EXCEPTION_COMPLETION] Exception object detected via symbol table for ${objectName}`);
                return createExceptionPropertyCompletions();
            }
        } else {
            console.log(`[EXCEPTION_COMPLETION] Symbol not found in symbol table: ${objectName}`);
        }
    }
    
    // Fallback: Check if we're in a catch block context using context analysis
    if (documentText && cursorOffset !== undefined && isCatchParameterCompletion(objectName, documentText, cursorOffset)) {
        console.log(`[EXCEPTION_COMPLETION] Exception object detected via context analysis for ${objectName}`);
        return createExceptionPropertyCompletions();
    }
    
    console.log(`[EXCEPTION_COMPLETION] No exception completion found for ${objectName}`);
    return [];
}

function createExceptionPropertyCompletions(): CompletionItem[] {
    const propertyNames = exceptionTypeRegistry.getPropertyNames();
    const completions: CompletionItem[] = [];
    
    for (const propertyName of propertyNames) {
        const property = exceptionTypeRegistry.getProperty(propertyName);
        if (property) {
            completions.push({
                label: propertyName,
                kind: CompletionItemKind.Property,
                detail: `exception property: ${property.type}`,
                documentation: {
                    kind: MarkupKind.Markdown,
                    value: exceptionTypeRegistry.getPropertyDocumentation(propertyName)
                },
                insertText: propertyName
            });
        }
    }
    
    return completions;
}

/**
 * Check if we're trying to complete a catch parameter (exception object)
 * by analyzing the document context around the cursor position
 */
function isCatchParameterCompletion(objectName: string, documentText: string, cursorOffset: number): boolean {
    console.log(`[CATCH_CONTEXT] Analyzing context for '${objectName}' at offset ${cursorOffset}`);
    
    // Get text before cursor to analyze context
    const textBeforeCursor = documentText.substring(0, cursorOffset);
    
    // Simple heuristic: Look for catch block patterns before the current position
    // Look for catch (paramName) { ... and check if objectName matches paramName
    const catchPattern = /catch\s*\(\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\)\s*\{[^}]*$/;
    const match = textBeforeCursor.match(catchPattern);
    
    if (match) {
        const catchParameterName = match[1];
        console.log(`[CATCH_CONTEXT] Found catch parameter: '${catchParameterName}'`);
        
        if (catchParameterName === objectName) {
            console.log(`[CATCH_CONTEXT] Match! '${objectName}' is a catch parameter`);
            return true;
        }
    }
    
    // Alternative approach: Look for catch blocks and check if we're inside one
    // This is more complex but more accurate
    const reversedText = textBeforeCursor.split('').reverse().join('');
    
    // Look for } catch ( paramName ) in reverse
    let braceCount = 0;
    let inCatchBlock = false;
    let catchParamName = '';
    
    for (let i = 0; i < reversedText.length; i++) {
        const char = reversedText[i];
        
        if (char === '}') {
            braceCount++;
        } else if (char === '{') {
            braceCount--;
            
            // If we're at brace level 0, we might be at the start of a catch block
            if (braceCount === 0 && !inCatchBlock) {
                // Look for catch (param) pattern before this brace
                const beforeBrace = reversedText.substring(i + 1);
                const catchMatch = beforeBrace.match(/^\s*\)\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\(\s*hctac/); // "catch" in reverse
                
                if (catchMatch && catchMatch[1]) {
                    catchParamName = catchMatch[1].split('').reverse().join(''); // reverse back
                    inCatchBlock = true;
                    console.log(`[CATCH_CONTEXT] Found catch block with parameter: '${catchParamName}'`);
                    break;
                }
            }
        }
    }
    
    if (inCatchBlock && catchParamName === objectName) {
        console.log(`[CATCH_CONTEXT] Context match! '${objectName}' is in catch block`);
        return true;
    }
    
    console.log(`[CATCH_CONTEXT] No catch context found for '${objectName}'`);
    return false;
}

function getNl80211ConstObjectCompletions(objectName: string, analysisResult?: SemanticAnalysisResult): CompletionItem[] {
    console.log(`[NL80211_CONST_COMPLETION] Checking nl80211 constants completion for: ${objectName}`);
    
    if (!analysisResult || !analysisResult.symbolTable) {
        console.log(`[NL80211_CONST_COMPLETION] No analysisResult or symbolTable for ${objectName}`);
        return [];
    }

    const symbol = analysisResult.symbolTable.lookup(objectName);
    if (!symbol) {
        console.log(`[NL80211_CONST_COMPLETION] Symbol not found: ${objectName}`);
        return [];
    }

    console.log(`[NL80211_CONST_COMPLETION] Symbol found: ${objectName}, dataType: ${JSON.stringify(symbol.dataType)}`);

    // Check if this is an nl80211 constants object (imported as 'const' from nl80211)
    if (symbol.dataType && typeof symbol.dataType === 'object' && 
        'moduleName' in symbol.dataType && symbol.dataType.moduleName === 'nl80211-const') {
        
        console.log(`[NL80211_CONST_COMPLETION] NL80211 constants object detected for ${objectName}`);
        
        // Import nl80211TypeRegistry
        
        const constantNames = nl80211TypeRegistry.getConstantNames();
        const completions: CompletionItem[] = [];
        
        for (const constantName of constantNames) {
            const signature = nl80211TypeRegistry.getConstant(constantName);
            if (signature) {
                completions.push({
                    label: constantName,
                    kind: CompletionItemKind.Constant,
                    detail: `nl80211 constant: ${signature.type}`,
                    documentation: {
                        kind: MarkupKind.Markdown,
                        value: nl80211TypeRegistry.getConstantDocumentation(constantName)
                    },
                    insertText: constantName
                });
            }
        }
        
        console.log(`[NL80211_CONST_COMPLETION] Generated ${completions.length} nl80211 constants completions: ${constantNames.slice(0, 5).join(', ')}...`);
        return completions;
    }

    console.log(`[NL80211_CONST_COMPLETION] Not an nl80211 constants object: ${objectName}`);
    return [];
}

function getRtnlConstObjectCompletions(objectName: string, analysisResult?: SemanticAnalysisResult): CompletionItem[] {
    console.log(`[RTNL_CONST_COMPLETION] Checking rtnl constants completion for: ${objectName}`);
    
    if (!analysisResult || !analysisResult.symbolTable) {
        console.log(`[RTNL_CONST_COMPLETION] No analysisResult or symbolTable for ${objectName}`);
        return [];
    }
    const symbol = analysisResult.symbolTable.lookup(objectName);
    if (!symbol) {
        console.log(`[RTNL_CONST_COMPLETION] Symbol not found: ${objectName}`);
        return [];
    }
    console.log(`[RTNL_CONST_COMPLETION] Symbol found: ${objectName}, dataType: ${JSON.stringify(symbol.dataType)}`);
    
    // Check if this is an rtnl constants object (imported as 'const' from rtnl)
    if (symbol.dataType && typeof symbol.dataType === 'object' && 
        'moduleName' in symbol.dataType && symbol.dataType.moduleName === 'rtnl-const') {
        
        console.log(`[RTNL_CONST_COMPLETION] RTNL constants object detected for ${objectName}`);
        
        const constantNames = rtnlTypeRegistry.getConstantNames();
        const completions: CompletionItem[] = [];
        
        for (const constantName of constantNames) {
            try {
                const signature = rtnlTypeRegistry.getConstant(constantName);
                if (signature) {
                    completions.push({
                        label: constantName,
                        kind: CompletionItemKind.Constant,
                        detail: `rtnl constant: ${signature.type}`,
                        documentation: {
                            kind: MarkupKind.Markdown,
                            value: rtnlTypeRegistry.getConstantDocumentation(constantName)
                        },
                        insertText: constantName
                    });
                }
            } catch (error) {
                console.log(`[RTNL_CONST_COMPLETION] Error creating completion for ${constantName}:`, error);
            }
        }
        
        console.log(`[RTNL_CONST_COMPLETION] Generated ${completions.length} rtnl constants completions: ${constantNames.slice(0, 5).join(', ')}...`);
        return completions;
    }
    console.log(`[RTNL_CONST_COMPLETION] Not an rtnl constants object: ${objectName}`);
    return [];
}

function detectImportCompletionContext(offset: number, tokens: any[], text: string): { inStringLiteral: boolean; currentPath?: string } | undefined {
    // Look for pattern: import [specifiers] from "..." where cursor is inside the string
    // We want to detect: import * as lol from '|' (cursor at |)
    
    let importTokenIndex = -1;
    let fromTokenIndex = -1;
    let stringTokenIndex = -1;
    
    // Find relevant tokens moving backward from cursor position
    for (let i = tokens.length - 1; i >= 0; i--) {
        const token = tokens[i];
        
        // Skip tokens that are beyond our cursor position
        if (token.pos > offset) continue;
        
        // Look for string literal token at or before cursor
        if (token.type === TokenType.TK_STRING && stringTokenIndex === -1) {
            // Check if cursor is inside this string (between quotes)
            if (offset >= token.pos && offset <= token.end) {
                stringTokenIndex = i;
            }
        }
        
        // Look for 'from' keyword
        if (token.type === TokenType.TK_FROM && fromTokenIndex === -1) {
            fromTokenIndex = i;
        }
        
        // Look for 'import' keyword
        if (token.type === TokenType.TK_IMPORT && importTokenIndex === -1) {
            importTokenIndex = i;
            break; // Found import, we can stop looking further back
        }
        
        // If we hit another statement-ending token before finding import, stop
        if (token.type === TokenType.TK_SCOL || token.type === TokenType.TK_RBRACE || 
            token.type === TokenType.TK_NEWLINE) {
            break;
        }
    }
    
    // Check if we have a valid import...from...string pattern
    if (importTokenIndex !== -1 && fromTokenIndex !== -1 && stringTokenIndex !== -1) {
        // Ensure the tokens are in the right order: import < from < string
        if (importTokenIndex < fromTokenIndex && fromTokenIndex < stringTokenIndex) {
            // Extract the current path being typed from the string literal
            const stringToken = tokens[stringTokenIndex];
            const stringStart = stringToken.pos + 1; // Skip opening quote
            const stringEnd = Math.min(stringToken.end - 1, offset); // Up to cursor or closing quote
            const currentPath = text.substring(stringStart, stringEnd);
            
            return { 
                inStringLiteral: true, 
                currentPath: currentPath 
            };
        }
    }
    
    // Also check if cursor is right after 'from ' (space after from)
    if (importTokenIndex !== -1 && fromTokenIndex !== -1 && stringTokenIndex === -1) {
        const fromToken = tokens[fromTokenIndex];
        // Check if cursor is shortly after the 'from' token (allowing for whitespace)
        if (offset >= fromToken.end && offset <= fromToken.end + 10) {
            return { inStringLiteral: false };
        }
    }
    
    return undefined;
}

function createModuleNameCompletions(): CompletionItem[] {
    const availableModules = discoverAvailableModules();
    const completions: CompletionItem[] = [];
    
    for (const module of availableModules) {
        const isBuiltin = module.source === 'builtin';
        const detail = isBuiltin ? 'ucode builtin module' : 'ucode system module';
        const sortPrefix = isBuiltin ? '0_' : '1_'; // Sort builtins first, then system modules
        
        completions.push({
            label: module.name,
            kind: CompletionItemKind.Module,
            detail: detail,
            documentation: {
                kind: MarkupKind.Markdown,
                value: createModuleDocumentation(module)
            },
            insertText: module.name,
            sortText: `${sortPrefix}${module.name}`
        });
    }
    
    return completions;
}

function createModuleDocumentation(module: DiscoveredModule): string {
    const moduleType = module.source === 'builtin' ? 'builtin' : 'system';
    let doc = `Import the **${module.name}** ${moduleType} module\n\n`;
    
    if (module.path) {
        doc += `**Location:** \`${module.path}\`\n\n`;
    }
    
    doc += `**Example:**\n\`\`\`ucode\nimport * as ${module.name} from '${module.name}';\n\`\`\``;
    
    return doc;
}

/**
 * Detects if we're in a destructured import context like: import { open, l| } from 'fs'
 */
function detectDestructuredImportContext(offset: number, tokens: any[]): { moduleName: string, alreadyImported: string[] } | undefined {
    
    // Find all import statements and check which one contains the cursor
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        
        if (token.type === TokenType.TK_IMPORT) {
            // Found an import, now look for the pattern: import { ... } from "module"
            let lbraceTokenIndex = -1;
            let fromTokenIndex = -1;
            let stringTokenIndex = -1;
            let moduleName = '';
            
            // Look ahead from this import token
            for (let j = i + 1; j < tokens.length; j++) {
                const nextToken = tokens[j];
                
                if (nextToken.type === TokenType.TK_LBRACE && lbraceTokenIndex === -1) {
                    lbraceTokenIndex = j;
                } else if (nextToken.type === TokenType.TK_FROM && fromTokenIndex === -1 && lbraceTokenIndex !== -1) {
                    fromTokenIndex = j;
                } else if (nextToken.type === TokenType.TK_STRING && stringTokenIndex === -1 && fromTokenIndex !== -1) {
                    stringTokenIndex = j;
                    moduleName = nextToken.value as string;
                    break; // Found complete import statement
                } else if (nextToken.type === TokenType.TK_IMPORT) {
                    // Hit another import statement, break out to process it separately
                    break;
                }
            }
            
            // Check if we have a valid destructured import pattern
            if (lbraceTokenIndex !== -1 && fromTokenIndex !== -1 && stringTokenIndex !== -1) {
                const lbraceToken = tokens[lbraceTokenIndex];
                const fromToken = tokens[fromTokenIndex];
                
                // Check if cursor is after the opening brace and before 'from'
                if (offset > lbraceToken.pos && offset < fromToken.pos) {
                    // Collect already imported identifiers
                    const alreadyImported: string[] = [];
                    for (let k = lbraceTokenIndex + 1; k < fromTokenIndex; k++) {
                        if (tokens[k].type === TokenType.TK_LABEL) {
                            alreadyImported.push(tokens[k].value as string);
                        }
                    }
                    return { moduleName, alreadyImported };
                }
            }
        }
    }

    return undefined;
}

/**
 * Creates completions for destructured imports like: import { | } from 'fs'
 */
function createDestructuredImportCompletions(moduleName: string, alreadyImported: string[] = []): CompletionItem[] {
    try {
        const members: ModuleMember[] = getModuleMembers(moduleName);
        if (members.length === 0) {
            return [];
        }

        const completions: CompletionItem[] = [];
        
        for (const member of members) {
            // Exclude already imported members
            if (!alreadyImported.includes(member.name)) {
                // Determine completion item properties based on member type
                let kind: CompletionItemKind;
                let detail: string;
                let sortPriority: string;
                let usage: string;

                switch (member.type) {
                    case 'function':
                        kind = CompletionItemKind.Function;
                        detail = `${member.name}() from ${moduleName}`;
                        sortPriority = '1'; // Functions first
                        usage = `**${member.name}** function from the **${moduleName}** module\n\n**Usage:**\n\`\`\`ucode\nimport { ${member.name} } from '${moduleName}';\n${member.name}(/* parameters */);\n\`\`\``;
                        break;
                    case 'constant':
                        kind = CompletionItemKind.Constant;
                        detail = `${member.name} from ${moduleName}`;
                        sortPriority = '2'; // Constants second
                        usage = `**${member.name}** constant from the **${moduleName}** module\n\n**Usage:**\n\`\`\`ucode\nimport { ${member.name} } from '${moduleName}';\nconsole.log(${member.name});\n\`\`\``;
                        break;
                    case 'resource':
                        kind = CompletionItemKind.Value;
                        detail = `${member.name} resource from ${moduleName}`;
                        sortPriority = '3'; // Resources third
                        usage = `**${member.name}** resource from the **${moduleName}** module\n\n**Usage:**\n\`\`\`ucode\nimport { ${member.name} } from '${moduleName}';\n// Use as resource\n\`\`\``;
                        break;
                    default: // 'unknown'
                        kind = CompletionItemKind.Value;
                        detail = `${member.name} from ${moduleName}`;
                        sortPriority = '4'; // Unknown last
                        usage = `**${member.name}** from the **${moduleName}** module\n\n**Usage:**\n\`\`\`ucode\nimport { ${member.name} } from '${moduleName}';\n// Usage depends on actual type\n\`\`\``;
                        break;
                }

                completions.push({
                    label: member.name,
                    kind,
                    detail,
                    documentation: {
                        kind: MarkupKind.Markdown,
                        value: usage
                    },
                    insertText: member.name,
                    sortText: `${sortPriority}_${member.name}` // Sort by type priority, then alphabetically
                });
            }
        }

        return completions;
    } catch (error) {
        console.warn(`Failed to get destructured import completions for ${moduleName}:`, error);
        return [];
    }
}

function createFileSystemCompletions(currentPath: string, documentUri: string, connection: any): CompletionItem[] {
    
    try {
        // Convert document URI to file path
        const documentPath = new URL(documentUri).pathname;
        const documentDir = path.dirname(documentPath);
        
        // Resolve the target directory based on current path
        let targetDir: string;
        if (currentPath.startsWith('./') || currentPath.startsWith('../')) {
            // Handle relative path
            const relativePath = currentPath.endsWith('/') ? currentPath : path.dirname(currentPath);
            targetDir = path.resolve(documentDir, relativePath);
        } else {
            // Fallback to document directory
            targetDir = documentDir;
        }
        
        connection.console.log(`[FS_COMPLETION] Document: ${documentPath}, Target dir: ${targetDir}, Current path: ${currentPath}`);
        
        // Check if target directory exists
        if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
            connection.console.log(`[FS_COMPLETION] Target directory does not exist: ${targetDir}`);
            return [];
        }
        
        // Read directory contents
        const entries = fs.readdirSync(targetDir);
        const completions: CompletionItem[] = [];
        
        // Get the partial filename being typed
        const lastSlashIndex = currentPath.lastIndexOf('/');
        const partialName = lastSlashIndex >= 0 ? currentPath.substring(lastSlashIndex + 1) : currentPath;
        
        for (const entry of entries) {
            const entryPath = path.join(targetDir, entry);
            const stat = fs.statSync(entryPath);
            
            // Skip hidden files unless explicitly typing them
            if (entry.startsWith('.') && !partialName.startsWith('.')) {
                continue;
            }
            
            // Filter by partial name if typing
            if (partialName && !entry.toLowerCase().startsWith(partialName.toLowerCase())) {
                continue;
            }
            
            if (stat.isDirectory()) {
                // Directory completion
                completions.push({
                    label: entry + '/',
                    kind: CompletionItemKind.Folder,
                    detail: 'Directory',
                    sortText: '0_' + entry, // Directories first
                    insertText: entry + '/',
                    documentation: {
                        kind: MarkupKind.Markdown,
                        value: `📁 **${entry}/**\n\nDirectory`
                    }
                });
            } else if (entry.endsWith('.uc')) {
                // uCode file completion
                completions.push({
                    label: entry,
                    kind: CompletionItemKind.File,
                    detail: 'uCode module',
                    sortText: '1_' + entry, // Files after directories
                    insertText: entry,
                    documentation: {
                        kind: MarkupKind.Markdown,
                        value: `📄 **${entry}**\n\nuCode module file`
                    }
                });
            }
        }
        
        connection.console.log(`[FS_COMPLETION] Generated ${completions.length} file system completions`);
        return completions;
        
    } catch (error) {
        connection.console.log(`[FS_COMPLETION] Error: ${error instanceof Error ? error.message : String(error)}`);
        return [];
    }
}

export function handleCompletionResolve(item: CompletionItem): CompletionItem {
    return item;
}
