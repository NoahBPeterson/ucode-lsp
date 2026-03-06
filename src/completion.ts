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
import { UcodeParser } from './parser';
import { allBuiltinFunctions } from './builtins';
import { SemanticAnalysisResult, SymbolType, Symbol as UcodeSymbol } from './analysis';
import { nl80211TypeRegistry } from './analysis/nl80211Types';
import { rtnlTypeRegistry } from './analysis/rtnlTypes';
import { Option } from 'effect';
import { MODULE_REGISTRIES, OBJECT_REGISTRIES, isKnownModule, isKnownObjectType, resolveReturnObjectType, type KnownObjectType } from './analysis/moduleDispatch';

const defaultExportPropertiesCache = new Map<string, { content: string; properties: { name: string; type: string }[] }>();

/**
 * Helper to lookup a symbol with CFG fallback
 * First tries symbol table, then falls back to CFG-based type inference
 */
function lookupSymbolWithCFG(
    objectName: string,
    analysisResult: SemanticAnalysisResult,
    offset: number = 0
): UcodeSymbol | undefined {
    // Try symbol table first
    let symbol = analysisResult.symbolTable.lookup(objectName);

    // Try CFG-based lookup if symbol table fails
    if (!symbol && analysisResult.cfgQueryEngine) {
        const cfgType = analysisResult.cfgQueryEngine.getTypeAtPosition(objectName, offset);
        if (cfgType) {
            symbol = {
                name: objectName,
                type: SymbolType.VARIABLE,
                dataType: cfgType,
                scope: 0,
                declared: true,
                used: true,
                node: {} as any,
                declaredAt: offset,
                usedAt: [offset]
            } as UcodeSymbol;
        }
    }

    return symbol || undefined;
}

export function handleCompletion(
    textDocumentPositionParams: TextDocumentPositionParams,
    documents: any,
    connection: any,
    analysisResult?: SemanticAnalysisResult
): CompletionItem[] {
    connection.console.log(`[COMPLETION_DEBUG] analysisResult provided: ${!!analysisResult}, symbolTable: ${!!analysisResult?.symbolTable}`);
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
            const { objectName, propertyChain, resolvedObjectType } = memberContext;
            connection.console.log(`Member expression detected for: ${objectName}${propertyChain ? `, chain: ${propertyChain.join('.')}` : ''}${resolvedObjectType ? `, resolvedObjectType: ${resolvedObjectType}` : ''}`);
            connection.console.log(`[DEBUG] objectName: "${objectName}", propertyChain: ${JSON.stringify(propertyChain)}`);

            // Call chain completions: cursor(). or fs.open(). resolved via return type
            if (resolvedObjectType) {
                const reg = OBJECT_REGISTRIES[resolvedObjectType];
                const completions: CompletionItem[] = [];
                const isException = resolvedObjectType === 'exception';
                for (const methodName of reg.getMethodNames()) {
                    const methodDoc = reg.getMethodDocumentation(methodName);
                    const item: CompletionItem = {
                        label: methodName,
                        kind: isException ? CompletionItemKind.Property : CompletionItemKind.Method,
                        detail: `${resolvedObjectType} ${isException ? 'property' : 'method'}`,
                        insertText: methodName
                    };
                    if (Option.isSome(methodDoc)) {
                        item.documentation = { kind: MarkupKind.Markdown, value: methodDoc.value };
                    }
                    completions.push(item);
                }
                connection.console.log(`Returning ${completions.length} call-chain completions for ${resolvedObjectType}`);
                return completions;
            }

            // Unified object type completions (fs.file/dir/proc, io.handle, uloop.*, uci.cursor, nl80211.listener, exception)
            const objectTypeCompletions = getUnifiedObjectTypeCompletions(objectName, analysisResult);
            if (objectTypeCompletions.length > 0) {
                connection.console.log(`Returning ${objectTypeCompletions.length} object type completions for ${objectName}`);
                return objectTypeCompletions;
            }

            // Unified module completions (all 15 known modules)
            const moduleCompletions = getUnifiedModuleCompletions(objectName, analysisResult);
            if (moduleCompletions.length > 0) {
                connection.console.log(`Returning ${moduleCompletions.length} module completions for ${objectName}`);
                return moduleCompletions;
            }

            // nl80211/rtnl constants object completions
            const nl80211ConstCompletions = getNl80211ConstObjectCompletions(objectName, analysisResult);
            if (nl80211ConstCompletions.length > 0) {
                connection.console.log(`Returning ${nl80211ConstCompletions.length} nl80211 constants completions for ${objectName}`);
                return nl80211ConstCompletions;
            }

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
                
                // Fallback: check if this might be a namespace import that wasn't handled above
                // This covers edge cases where the symbol properties don't match expected patterns
                const fallbackNamespaceCompletions = getFallbackNamespaceCompletions(objectName, analysisResult);
                if (fallbackNamespaceCompletions.length > 0) {
                    connection.console.log(`Returning ${fallbackNamespaceCompletions.length} fallback namespace completions for ${objectName}`);
                    return fallbackNamespaceCompletions;
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

function detectMemberCompletionContext(offset: number, tokens: any[]): { objectName: string; propertyChain?: string[]; resolvedObjectType?: KnownObjectType } | undefined {
    // Look for pattern: LABEL DOT [LABEL DOT]* (cursor position)
    // Also handles call chains: LABEL(...) DOT, LABEL DOT LABEL(...) DOT

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
    let resolvedObjectType: KnownObjectType | undefined;

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
        } else if (token.type === TokenType.TK_RPAREN) {
            // Call expression: walk backward through matched parens to find the function name
            let parenDepth = 1;
            let j = currentTokenIndex - 1;
            while (j >= 0 && parenDepth > 0) {
                if (tokens[j].type === TokenType.TK_RPAREN) parenDepth++;
                else if (tokens[j].type === TokenType.TK_LPAREN) parenDepth--;
                j--;
            }
            // j now points to the token before the opening paren
            if (j >= 0 && tokens[j].type === TokenType.TK_LABEL) {
                const funcName = tokens[j].value as string;
                let moduleName: string | undefined;
                // Check for module prefix: LABEL DOT LABEL(...)
                if (j >= 2 && tokens[j - 1].type === TokenType.TK_DOT && tokens[j - 2].type === TokenType.TK_LABEL) {
                    moduleName = tokens[j - 2].value as string;
                }
                const objType = resolveReturnObjectType(funcName, moduleName);
                if (objType) {
                    resolvedObjectType = objType;
                    break;
                }
            }
            // Could not resolve — stop
            break;
        } else {
            // Not a label or rparen token, stop here
            break;
        }
    }

    // If we resolved an object type from a call chain, return it directly
    if (resolvedObjectType) {
        return { objectName: '__call_chain__', resolvedObjectType };
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

    const result: { objectName: string; propertyChain?: string[]; resolvedObjectType?: KnownObjectType } = { objectName };
    if (chain.length > 0) {
        result.propertyChain = chain;
    }
    return result;
}

/**
 * Unified module completion: returns completions for any known module namespace import.
 * Replaces 15+ individual get*ModuleCompletions functions.
 */
function getUnifiedModuleCompletions(objectName: string, analysisResult?: SemanticAnalysisResult): CompletionItem[] {
    if (!analysisResult || !analysisResult.symbolTable) return [];

    const symbol = lookupSymbolWithCFG(objectName, analysisResult);
    if (!symbol) return [];

    // Determine the module name from multiple possible symbol shapes:
    // 1. Direct import: symbol.type === IMPORTED && importedFrom is a known module
    // 2. Module from require(): symbol.type === MODULE && dataType.moduleName
    // 3. Variable alias: symbol.type === VARIABLE && dataType.moduleName
    let moduleName: string | undefined;

    if (symbol.dataType && typeof symbol.dataType === 'object' && 'moduleName' in symbol.dataType) {
        const mn = (symbol.dataType as any).moduleName as string;
        // Skip nl80211-const / rtnl-const objects — they use the const object completion path
        if (mn === 'nl80211-const' || mn === 'rtnl-const') return [];
        if (isKnownModule(mn)) {
            moduleName = mn;
        }
    }

    if (!moduleName && symbol.type === SymbolType.IMPORTED && symbol.importedFrom) {
        moduleName = symbol.importedFrom;
    }

    if (!moduleName || !isKnownModule(moduleName)) return [];

    const reg = MODULE_REGISTRIES[moduleName];
    const completions: CompletionItem[] = [];

    // Add function completions
    for (const funcName of reg.getFunctionNames()) {
        const funcDoc = reg.getFunctionDocumentation(funcName);
        const item: CompletionItem = {
            label: funcName,
            kind: CompletionItemKind.Function,
            detail: `${moduleName} module function`,
            sortText: `0_${funcName}`,
            insertText: funcName
        };
        if (Option.isSome(funcDoc)) {
            item.documentation = { kind: MarkupKind.Markdown, value: funcDoc.value };
        }
        completions.push(item);
    }

    // Add constant completions
    for (const constName of reg.getConstantNames()) {
        const constDoc = reg.getConstantDocumentation(constName);
        const item: CompletionItem = {
            label: constName,
            kind: CompletionItemKind.Constant,
            detail: `${moduleName} module constant`,
            sortText: `1_${constName}`,
            insertText: constName,
            insertTextFormat: InsertTextFormat.PlainText
        };
        if (Option.isSome(constDoc)) {
            item.documentation = { kind: MarkupKind.Markdown, value: constDoc.value };
        }
        completions.push(item);
    }

    return completions;
}

/**
 * Unified object type completion: returns completions for any known object type.
 * Handles fs.file/dir/proc, io.handle, uloop.*, uci.cursor, nl80211.listener, exception.
 */
function getUnifiedObjectTypeCompletions(objectName: string, analysisResult?: SemanticAnalysisResult): CompletionItem[] {
    if (!analysisResult || !analysisResult.symbolTable) return [];

    const symbol = lookupSymbolWithCFG(objectName, analysisResult);
    if (!symbol || !symbol.dataType) return [];

    // Detect the object type from the symbol's dataType
    let objectType: KnownObjectType | null = null;

    if (typeof symbol.dataType === 'object' && 'moduleName' in symbol.dataType) {
        const mn = (symbol.dataType as any).moduleName as string;
        if (isKnownObjectType(mn)) {
            objectType = mn;
        }
    }

    if (!objectType) return [];

    const reg = OBJECT_REGISTRIES[objectType];
    const completions: CompletionItem[] = [];

    for (const methodName of reg.getMethodNames()) {
        const methodDoc = reg.getMethodDocumentation(methodName);
        const isException = objectType === 'exception';
        const item: CompletionItem = {
            label: methodName,
            kind: isException ? CompletionItemKind.Property : CompletionItemKind.Method,
            detail: `${objectType} ${isException ? 'property' : 'method'}`,
            insertText: methodName
        };
        if (Option.isSome(methodDoc)) {
            item.documentation = { kind: MarkupKind.Markdown, value: methodDoc.value };
        }
        completions.push(item);
    }

    return completions;
}

// Legacy per-module completion functions removed - now handled by getUnifiedModuleCompletions/getUnifiedObjectTypeCompletions

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

function getFallbackNamespaceCompletions(objectName: string, analysisResult?: SemanticAnalysisResult): CompletionItem[] {
    const fs = require('fs');
    const path = require('path');
    
    if (!analysisResult || !analysisResult.symbolTable) {
        return [];
    }

    const symbol = lookupSymbolWithCFG(objectName, analysisResult);
    
    // Only provide fallback completions if we have a symbol with valid import information
    if (!symbol || !symbol.importedFrom || symbol.type !== SymbolType.IMPORTED) {
        return [];
    }
    
    // Check if this is a built-in module (no file path, just module name)
    const builtinModules = ['uloop', 'rtnl', 'socket', 'math', 'log', 'debug', 'digest', 'fs', 'io', 'nl80211', 'resolv', 'struct', 'ubus', 'uci', 'zlib'];
    const isBuiltinModule = builtinModules.includes(symbol.importedFrom);
    
    // For built-in modules, don't provide fallback completions - they should be handled by specific module completion functions
    if (isBuiltinModule) {
        return [];
    }
    
    try {
        // For file-based imports, resolve the file path and check existence
        let filePath: string;
        
        if (symbol.importedFrom.startsWith('file://')) {
            filePath = symbol.importedFrom.replace('file://', '');
        } else if (symbol.importedFrom.startsWith('./') || symbol.importedFrom.startsWith('../')) {
            filePath = path.resolve(process.cwd(), symbol.importedFrom);
        } else if (/^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)+$/.test(symbol.importedFrom)) {
            // Dot notation - convert to file path
            const convertedPath = './' + symbol.importedFrom.replace(/\./g, '/') + '.uc';
            filePath = path.resolve(process.cwd(), convertedPath);
        } else {
            // Unknown import format - no fallback completions for non-builtin modules
            return [];
        }
        
        // Only provide completions if the file actually exists
        if (!fs.existsSync(filePath)) {
            return [];
        }
        
        // Read the file to check if it has exports
        const fileContent = fs.readFileSync(filePath, 'utf8');
        
        const completions: CompletionItem[] = [];
        
        // Only add 'default' if there's actually a default export
        if (fileContent.includes('export default')) {
            completions.push({
                label: 'default',
                kind: CompletionItemKind.Property,
                detail: 'default export',
                sortText: '0_default',
                documentation: {
                    kind: MarkupKind.Markdown,
                    value: `**default**\n\nDefault export from \`${path.basename(filePath)}\`\n\nAccess with: \`${objectName}.default.propertyName\``
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
                    value: `**${exportSymbol.name}**\n\n${exportSymbol.type} export from \`${path.basename(filePath)}\``
                }
            });
        }
        
        return completions;
        
    } catch (error) {
        // If anything fails, don't provide any completions
        return [];
    }
}

function getDefaultImportCompletions(objectName: string, analysisResult?: SemanticAnalysisResult): CompletionItem[] {
    const fs = require('fs');
    
    if (!analysisResult || !analysisResult.symbolTable) {
        return [];
    }

    const symbol = lookupSymbolWithCFG(objectName, analysisResult);
    if (!symbol) {
        return [];
    }

    // Check if this is a default import (symbol.type === 'imported' but NOT a destructured import)
    if (symbol.type === SymbolType.IMPORTED && symbol.importedFrom && 
        symbol.dataType && typeof symbol.dataType === 'object' && 
        'isDefaultImport' in symbol.dataType && symbol.dataType.isDefaultImport) {
        
        
        try {
            // Check if the imported file exists and can be read
            // Convert URI to file system path
            let filePath: string;
            if (symbol.importedFrom.startsWith('file://')) {
                filePath = symbol.importedFrom.replace('file://', '');
            } else if (symbol.importedFrom.startsWith('./') || symbol.importedFrom.startsWith('../')) {
                filePath = path.resolve(process.cwd(), symbol.importedFrom);
            } else if (/^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)+$/.test(symbol.importedFrom)) {
                // Dot notation that wasn't resolved - convert to file path
                const convertedPath = './' + symbol.importedFrom.replace(/\./g, '/') + '.uc';
                filePath = path.resolve(process.cwd(), convertedPath);
            } else {
                filePath = symbol.importedFrom;
            }

            if (!fs.existsSync(filePath)) {
                return [];
            }
            
            // Read and parse the imported file to find the default export
            const fileContent = fs.readFileSync(filePath, 'utf8');
            const defaultExportProperties = extractDefaultExportProperties(fileContent, filePath);
            
            const completions: CompletionItem[] = [];
            
            for (const property of defaultExportProperties) {
                completions.push({
                    label: property.name,
                    kind: getCompletionKindForProperty(property.type),
                    detail: `${property.type} from default export`,
                    sortText: '0_' + property.name,
                    documentation: {
                        kind: MarkupKind.Markdown,
                        value: `**${property.name}**\n\n${property.type} from default export of \`${path.basename(filePath)}\``
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

    const symbol = lookupSymbolWithCFG(objectName, analysisResult);
    if (!symbol) {
        return [];
    }

    // Check if this is a namespace import (import * as name from 'module')
    // Be more permissive to catch edge cases, but avoid conflicts with default imports
    if (symbol.type === SymbolType.IMPORTED && symbol.importedFrom && 
        (symbol.importSpecifier === '*' || 
         // Only process if this is NOT already handled by default import completions
         !(symbol.dataType && typeof symbol.dataType === 'object' && 
           'isDefaultImport' in symbol.dataType && symbol.dataType.isDefaultImport))) {
        try {
            // Check if this is a built-in module
            const builtinModules = ['uloop', 'rtnl', 'socket', 'math', 'log', 'debug', 'digest', 'fs', 'io', 'nl80211', 'resolv', 'struct', 'ubus', 'uci', 'zlib'];
            const isBuiltinModule = builtinModules.includes(symbol.importedFrom);
            
            let completions: CompletionItem[] = [];
            
            if (isBuiltinModule) {
                // For built-in modules, don't provide namespace import completions - they should be handled by specific module completion functions
                return [];
            }
            
            // For file-based imports, check if the imported file exists and can be read
            // Convert URI to file system path, or resolve import path if needed
            let filePath: string;
            let resolved = false;
            
            if (symbol.importedFrom.startsWith('file://')) {
                // Already a resolved URI
                filePath = symbol.importedFrom.replace('file://', '');
                resolved = true;
            } else if (symbol.importedFrom.startsWith('./') || symbol.importedFrom.startsWith('../')) {
                // Relative path that wasn't resolved - need to resolve it now
                const path = require('path');
                filePath = path.resolve(process.cwd(), symbol.importedFrom);
                resolved = true;
            } else if (/^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)+$/.test(symbol.importedFrom)) {
                // Dot notation that wasn't resolved - convert it to a file path
                const path = require('path');
                const convertedPath = './' + symbol.importedFrom.replace(/\./g, '/') + '.uc';
                filePath = path.resolve(process.cwd(), convertedPath);
                resolved = true;
            } else {
                // Unknown import format for non-builtin modules
                return [];
            }
                
            if (resolved && fs.existsSync(filePath)) {
                // Read and parse the imported file to find exports
                const fileContent = fs.readFileSync(filePath, 'utf8');
                
                // For namespace imports, provide 'default' as a completion if there's a default export
                if (fileContent.includes('export default')) {
                    completions.push({
                        label: 'default',
                        kind: CompletionItemKind.Property,
                        detail: 'default export',
                        sortText: '0_default',
                        documentation: {
                            kind: MarkupKind.Markdown,
                            value: `**default**\n\nDefault export from \`${path.basename(filePath)}\`\n\nAccess with: \`${objectName}.default.propertyName\``
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
                            value: `**${exportSymbol.name}**\n\n${exportSymbol.type} export from \`${path.basename(filePath)}\``
                        }
                    });
                }
            }
            // Don't provide any fallback completions if file doesn't exist
            
            return completions;
            
        } catch (error) {
            return [];
        }
    }

    return [];
}

function getPropertyChainCompletions(objectName: string, propertyChain: string[], analysisResult?: SemanticAnalysisResult): CompletionItem[] {
    const fs = require('fs');
    
    if (!analysisResult || !analysisResult.symbolTable) {
        return [];
    }

    const symbol = lookupSymbolWithCFG(objectName, analysisResult);
    if (!symbol) {
        return [];
    }

    // Handle specific known patterns
    
    // Pattern: namespace.default.* (e.g., logModule.default.debug)
    if (symbol.type === SymbolType.IMPORTED && 
        symbol.importedFrom && 
        symbol.importSpecifier === '*' &&
        propertyChain.length === 1 && 
        propertyChain[0] === 'default') {
        
        try {
            // Check if the imported file exists and can be read
            // Convert URI to file system path
            const filePath = symbol.importedFrom.startsWith('file://') 
                ? symbol.importedFrom.replace('file://', '') 
                : symbol.importedFrom;
                
            if (!fs.existsSync(filePath)) {
                return [];
            }
            
            // Read and parse the imported file to find the default export properties
            const fileContent = fs.readFileSync(filePath, 'utf8');
            const defaultExportProperties = extractDefaultExportProperties(fileContent, filePath);
            
            const completions: CompletionItem[] = [];
            
            for (const property of defaultExportProperties) {
                completions.push({
                    label: property.name,
                    kind: getCompletionKindForProperty(property.type),
                    detail: `${property.type} from default export`,
                    sortText: '0_' + property.name,
                    documentation: {
                        kind: MarkupKind.Markdown,
                        value: `**${property.name}**\n\n${property.type} from default export of \`${path.basename(filePath)}\`\n\nAccessed via: \`${objectName}.default.${property.name}\``
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

    const symbol = lookupSymbolWithCFG(objectName, analysisResult);
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

function extractDefaultExportProperties(fileContent: string, filePath?: string): { name: string; type: string }[] {
    if (filePath) {
        const cached = defaultExportPropertiesCache.get(filePath);
        if (cached && cached.content === fileContent) {
            return cached.properties;
        }
    }

    let properties: { name: string; type: string }[] = [];

    try {
        const lexer = new UcodeLexer(fileContent, { rawMode: true });
        const tokens = lexer.tokenize();
        const parser = new UcodeParser(tokens, fileContent);
        const parseResult = parser.parse();

        if (!parseResult.ast) {
            if (filePath) {
                defaultExportPropertiesCache.set(filePath, { content: fileContent, properties });
            }
            return properties;
        }

        const program = parseResult.ast as any;
        const variableInitializers = new Map<string, any>();

        for (const statement of program.body || []) {
            if (statement?.type === 'VariableDeclaration') {
                for (const declarator of statement.declarations || []) {
                    if (declarator?.id?.type === 'Identifier') {
                        variableInitializers.set(declarator.id.name, declarator.init || null);
                    }
                }
            }
        }

        for (const statement of program.body || []) {
            if (statement?.type === 'ExportDefaultDeclaration') {
                const resolved = resolveDefaultExportObject(statement.declaration, variableInitializers, new Set<string>());
                if (resolved && resolved.type === 'ObjectExpression') {
                    properties = extractPropertiesFromObjectExpression(resolved);
                    break;
                }
            }
        }
    } catch (error) {
        properties = [];
    }

    if (filePath) {
        defaultExportPropertiesCache.set(filePath, { content: fileContent, properties });
    }

    return properties;
}

function resolveDefaultExportObject(
    declaration: any,
    variableInitializers: Map<string, any>,
    visited: Set<string>
): any | null {
    if (!declaration) {
        return null;
    }

    if (declaration.type === 'ObjectExpression') {
        return declaration;
    }

    if (declaration.type === 'Identifier') {
        const name = declaration.name;
        if (!name || visited.has(name)) {
            return null;
        }
        visited.add(name);
        const initializer = variableInitializers.get(name);
        if (initializer) {
            return resolveDefaultExportObject(initializer, variableInitializers, visited);
        }
        return null;
    }

    if (declaration.type === 'CallExpression') {
        for (const arg of declaration.arguments || []) {
            const resolved = resolveDefaultExportObject(arg, variableInitializers, visited);
            if (resolved) {
                return resolved;
            }
        }
        return null;
    }

    if (declaration.type === 'AssignmentExpression') {
        return resolveDefaultExportObject(declaration.right, variableInitializers, visited);
    }

    if (declaration.type === 'VariableDeclarator') {
        return resolveDefaultExportObject(declaration.init, variableInitializers, visited);
    }

    return null;
}

function extractPropertiesFromObjectExpression(objectExpression: any): { name: string; type: string }[] {
    const properties: { name: string; type: string }[] = [];
    if (!objectExpression?.properties) {
        return properties;
    }

    const seen = new Set<string>();

    for (const property of objectExpression.properties) {
        if (!property || property.type !== 'Property') {
            continue;
        }

        const propertyName = extractDefaultExportPropertyName(property);
        if (!propertyName || seen.has(propertyName)) {
            continue;
        }

        const propertyType = inferDefaultExportPropertyType(property.value);
        properties.push({ name: propertyName, type: propertyType });
        seen.add(propertyName);
    }

    return properties;
}

function extractDefaultExportPropertyName(property: any): string | null {
    if (!property) {
        return null;
    }

    if (property.computed) {
        if (property.key?.type === 'Literal' && property.key.value !== undefined && property.key.value !== null) {
            return String(property.key.value);
        }
        return null;
    }

    if (property.key?.type === 'Identifier') {
        return property.key.name;
    }

    if (property.key?.type === 'Literal') {
        if (property.key.value === undefined || property.key.value === null) {
            return null;
        }
        return String(property.key.value);
    }

    return null;
}

function inferDefaultExportPropertyType(valueNode: any): string {
    if (!valueNode) {
        return 'property';
    }

    switch (valueNode.type) {
        case 'FunctionExpression':
        case 'ArrowFunctionExpression':
            return 'function';
        case 'Literal':
            if (valueNode.literalType === 'string') {
                return 'string';
            }
            if (valueNode.literalType === 'number' || valueNode.literalType === 'double') {
                return 'number';
            }
            return 'property';
        default:
            return 'property';
    }
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

function getNl80211ConstObjectCompletions(objectName: string, analysisResult?: SemanticAnalysisResult): CompletionItem[] {
    console.log(`[NL80211_CONST_COMPLETION] Checking nl80211 constants completion for: ${objectName}`);
    
    if (!analysisResult || !analysisResult.symbolTable) {
        console.log(`[NL80211_CONST_COMPLETION] No analysisResult or symbolTable for ${objectName}`);
        return [];
    }

    const symbol = lookupSymbolWithCFG(objectName, analysisResult);
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
    const symbol = lookupSymbolWithCFG(objectName, analysisResult);
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
