import {
    TextDocumentPositionParams,
    CompletionParams,
    CompletionItem,
    CompletionItemKind,
    MarkupKind,
    InsertTextFormat
} from 'vscode-languageserver/node';
import * as fs from 'fs';
import * as path from 'path';
import { URL } from 'url';
import { discoverAvailableModules, getModuleMembers, DiscoveredModule, ModuleMember } from './moduleDiscovery';
import { UcodeLexer, TokenType, Token } from './lexer';
import { UcodeParser } from './parser';
import { allBuiltinFunctions } from './builtins';
import { SemanticAnalysisResult, SymbolType, Symbol as UcodeSymbol } from './analysis';
import { extractModuleType, typeToString } from './analysis/symbolTable';
import { nl80211TypeRegistry } from './analysis/nl80211Types';
import { rtnlTypeRegistry } from './analysis/rtnlTypes';
import { Option } from 'effect';
import { MODULE_REGISTRIES, OBJECT_REGISTRIES, isKnownModule, isKnownObjectType, resolveReturnObjectType, type KnownObjectType } from './analysis/moduleDispatch';
import { FileResolver } from './analysis/fileResolver';

const defaultExportPropertiesCache = new Map<string, { content: string; properties: { name: string; type: string }[] }>();

// Shared resolver for cross-file completions. getModuleExports() parses each
// imported file's AST once and caches it (exportCache), so member completion
// doesn't re-lex/parse the imported file on every keystroke.
let completionFileResolver: FileResolver | null = null;
function getCompletionFileResolver(): FileResolver {
    if (!completionFileResolver) completionFileResolver = new FileResolver();
    return completionFileResolver;
}

/**
 * Resolve a symbol's `importedFrom` to a file:// URI, relative to the importing
 * document. Returns null for builtins and unresolvable paths. (Replaces the old
 * process.cwd()-based resolution, which was wrong whenever the server's CWD
 * wasn't the importing file's directory.)
 */
function resolveModuleUri(importedFrom: string, documentUri?: string): string | null {
    if (importedFrom.startsWith('file://')) return importedFrom;
    if (importedFrom.startsWith('builtin://')) return null;
    if (!documentUri) return null;
    const uri = getCompletionFileResolver().resolveImportPath(importedFrom, documentUri);
    return uri && uri.startsWith('file://') ? uri : null;
}

/** Member completions (named exports + `default`) for a module, from its cached AST exports. */
function getModuleExportCompletions(moduleUri: string, objectName: string): CompletionItem[] {
    const exports = getCompletionFileResolver().getModuleExports(moduleUri);
    if (!exports) return [];
    const moduleLabel = moduleUri.split('/').pop() || moduleUri;
    const items: CompletionItem[] = [];
    for (const exp of exports) {
        if (exp.type === 'default') {
            items.push({
                label: 'default',
                kind: CompletionItemKind.Property,
                detail: 'default export',
                sortText: '0_default',
                documentation: { kind: MarkupKind.Markdown, value: `**default**\n\nDefault export from \`${moduleLabel}\`\n\nAccess with: \`${objectName}.default.propertyName\`` }
            });
        } else {
            items.push({
                label: exp.name,
                kind: exp.isFunction ? CompletionItemKind.Function : CompletionItemKind.Variable,
                detail: 'named export',
                sortText: '1_' + exp.name,
                documentation: { kind: MarkupKind.Markdown, value: `**${exp.name}**\n\nnamed export from \`${moduleLabel}\`` }
            });
        }
    }
    return items;
}

/**
 * Helper to look up a symbol for an object name (e.g. for member completion).
 * When an offset is given, prefer the scope-aware lookup so scoped objects
 * (catch params, function-local lets) resolve to the right declaration.
 */
function lookupSymbol(
    objectName: string,
    analysisResult: SemanticAnalysisResult,
    offset?: number
): UcodeSymbol | undefined {
    if (offset !== undefined) {
        const scoped = analysisResult.symbolTable.lookupAtPosition(objectName, offset);
        if (scoped) return scoped;
    }
    return analysisResult.symbolTable.lookup(objectName) || undefined;
}

export function handleCompletion(
    textDocumentPositionParams: TextDocumentPositionParams | CompletionParams,
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

        // Check if cursor is inside a JSDoc comment
        const jsDocCompletion = detectJsDocCompletionContext(text, offset, lexer.comments);
        if (jsDocCompletion) {
            return createJsDocCompletions(jsDocCompletion, document.uri, connection);
        }

        // `{` is registered as a completion trigger character SOLELY for JSDoc
        // type annotations (`@param {string}`). When the user opens a code block
        // — `function f(x) {` then Enter — the same trigger fires here, outside
        // any JSDoc, and the general-completion fallback below would surface a
        // stray global (e.g. ARGV). VS Code then auto-selects it, so Enter
        // accepts the completion instead of inserting a newline. Since the only
        // legitimate `{`-triggered completion is JSDoc (handled above), suppress
        // everything else when `{` was the trigger. `triggerCharacter` is only
        // populated for an actual keypress trigger, so manual invocation
        // (Ctrl+Space) after a `{` is unaffected.
        const triggerCharacter = (textDocumentPositionParams as CompletionParams).context?.triggerCharacter;
        if (triggerCharacter === '{') {
            return [];
        }

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
            const { objectName, propertyChain, resolvedObjectType, callFunctionName } = memberContext;
            connection.console.log(`Member expression detected for: ${objectName}${propertyChain ? `, chain: ${propertyChain.join('.')}` : ''}${resolvedObjectType ? `, resolvedObjectType: ${resolvedObjectType}` : ''}`);
            connection.console.log(`[DEBUG] objectName: "${objectName}", propertyChain: ${JSON.stringify(propertyChain)}`);

            // Call chain completions: cursor(). or fs.open(). resolved via return type
            if (resolvedObjectType) {
                const reg = OBJECT_REGISTRIES[resolvedObjectType];
                const completions: CompletionItem[] = [];
                const isPropertyType = OBJECT_REGISTRIES[resolvedObjectType]?.isPropertyBased ?? false;
                for (const methodName of reg.getMethodNames()) {
                    const methodDoc = reg.getMethodDocumentation(methodName);
                    const item: CompletionItem = {
                        label: methodName,
                        kind: isPropertyType ? CompletionItemKind.Property : CompletionItemKind.Method,
                        detail: `${resolvedObjectType} ${isPropertyType ? 'property' : 'method'}`,
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

            // Call chain on a user factory function (make().): complete the function's
            // inferred return-object properties. Covers local and imported factories.
            if (callFunctionName) {
                const fnReturnCompletions = getUserFunctionReturnCompletions(callFunctionName, analysisResult, offset);
                connection.console.log(`Returning ${fnReturnCompletions.length} call-chain return completions for ${callFunctionName}()`);
                return fnReturnCompletions;
            }

            // Unified object type completions (fs.file/dir/proc, io.handle, uloop.*, uci.cursor, nl80211.listener, exception)
            const objectTypeCompletions = getUnifiedObjectTypeCompletions(objectName, analysisResult, offset);
            if (objectTypeCompletions.length > 0) {
                connection.console.log(`Returning ${objectTypeCompletions.length} object type completions for ${objectName}`);
                return objectTypeCompletions;
            }

            // Unified module completions (all 15 known modules)
            const moduleCompletions = getUnifiedModuleCompletions(objectName, analysisResult, offset);
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
            const defaultImportCompletions = getDefaultImportCompletions(objectName, analysisResult, document.uri);
            if (defaultImportCompletions.length > 0) {
                connection.console.log(`Returning ${defaultImportCompletions.length} default import completions for ${objectName}`);
                return defaultImportCompletions;
            }

            // Named value import used as an object (import { CONF } from './m'; CONF.):
            // complete the imported VALUE's own object properties, not the module's
            // exports (which is only right for `import * as ns`).
            const importedValueCompletions = getImportedValuePropertyCompletions(objectName, analysisResult, document.uri, offset);
            if (importedValueCompletions.length > 0) {
                connection.console.log(`Returning ${importedValueCompletions.length} imported-value property completions for ${objectName}`);
                return importedValueCompletions;
            }

            // Check if this is a namespace import with completions available (only if no property chain)
            if (!propertyChain || propertyChain.length === 0) {
                const namespaceImportCompletions = getNamespaceImportCompletions(objectName, analysisResult, document.uri);
                if (namespaceImportCompletions.length > 0) {
                    connection.console.log(`Returning ${namespaceImportCompletions.length} namespace import completions for ${objectName}`);
                    return namespaceImportCompletions;
                }
                
                // Fallback: check if this might be a namespace import that wasn't handled above
                // This covers edge cases where the symbol properties don't match expected patterns
                const fallbackNamespaceCompletions = getFallbackNamespaceCompletions(objectName, analysisResult, document.uri);
                if (fallbackNamespaceCompletions.length > 0) {
                    connection.console.log(`Returning ${fallbackNamespaceCompletions.length} fallback namespace completions for ${objectName}`);
                    return fallbackNamespaceCompletions;
                }
            }
            
            // Check if this is a property chain completion (e.g., obj.prop.subprop.)
            if (propertyChain && propertyChain.length > 0) {
                const propertyChainCompletions = getPropertyChainCompletions(objectName, propertyChain, analysisResult, offset);
                if (propertyChainCompletions.length > 0) {
                    connection.console.log(`Returning ${propertyChainCompletions.length} property chain completions for ${objectName}.${propertyChain.join('.')}`);
                    return propertyChainCompletions;
                }
            }
            
            // Check if this is a variable with generic object properties
            const variableCompletions = getVariableCompletions(objectName, analysisResult, document.uri, offset);
            if (variableCompletions.length > 0) {
                connection.console.log(`Returning ${variableCompletions.length} variable completions for ${objectName}`);
                return variableCompletions;
            }
            
            // For member expressions, return empty array - never show builtin functions
            connection.console.log(`No specific completions for object: ${objectName}`);
            return [];
        }
        
        // Don't offer completions while the user is NAMING a function
        // (`function lo|`). The name is brand new; any suggestion (e.g.
        // `localtime` fuzzy-matching `lo`) can be committed by typing `(` —
        // VS Code accepts the highlighted item on a commit character — which
        // silently renames the function to a builtin.
        if (isFunctionNameContext(offset, tokens)) {
            return [];
        }

        // Only show general completions when NOT in a member expression context
        return createGeneralCompletions(analysisResult, connection, offset);

    } catch (error) {
        connection.console.log('Completion error: ' + error);
        return createGeneralCompletions(analysisResult, connection);
    }
}

// True when the cursor sits in the NAME position of a function declaration or
// expression — right after the `function` keyword (`function |` or
// `function lo|`). Completions there are never wanted: the user is inventing a
// new identifier, not referencing an existing one.
function isFunctionNameContext(offset: number, tokens: any[]): boolean {
    // Nearest meaningful token that begins before the cursor, and the one before it.
    let cur: any = null, prev: any = null;
    for (const t of tokens) {
        if (t.type === TokenType.TK_EOF) continue;
        if (t.pos < offset) { prev = cur; cur = t; }
        else break;
    }
    if (!cur) return false;
    // `function |` — cursor right after the keyword, no name typed yet.
    if (cur.type === TokenType.TK_FUNC) return true;
    // `function lo|` — typing the name; the keyword is the previous token.
    if (cur.type === TokenType.TK_LABEL && prev && prev.type === TokenType.TK_FUNC) return true;
    return false;
}

function detectMemberCompletionContext(offset: number, tokens: any[]): { objectName: string; propertyChain?: string[]; resolvedObjectType?: KnownObjectType; callFunctionName?: string } | undefined {
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
    let callChainFunctionName: string | undefined;

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
                // Not a known object-returning builtin — remember the bare function
                // name so the handler can try a user factory's inferred return shape.
                if (!moduleName) {
                    callChainFunctionName = funcName;
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

    // A bare user-function call chain (make().) — let the handler resolve the
    // function's inferred return-object shape from its symbol.
    if (callChainFunctionName) {
        return { objectName: '__call_chain__', callFunctionName: callChainFunctionName };
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
function getUnifiedModuleCompletions(objectName: string, analysisResult?: SemanticAnalysisResult, offset?: number): CompletionItem[] {
    if (!analysisResult || !analysisResult.symbolTable) return [];

    // Position-aware: resolves a function-LOCAL module-typed variable
    // (`let _ubus = ubus_mod || require('ubus'); _ubus.`), not just globals.
    const symbol = lookupSymbol(objectName, analysisResult, offset);
    if (!symbol) return [];

    // Determine the module name from multiple possible symbol shapes:
    // 1. Direct import: symbol.type === IMPORTED && importedFrom is a known module
    // 2. Module from require(): symbol.type === MODULE && dataType.moduleName
    // 3. Variable alias: symbol.type === VARIABLE && dataType.moduleName
    let moduleName: string | undefined;

    const modType = extractModuleType(symbol.dataType);
    if (modType) {
        const mn = modType.moduleName;
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
function getUnifiedObjectTypeCompletions(objectName: string, analysisResult?: SemanticAnalysisResult, offset?: number): CompletionItem[] {
    if (!analysisResult || !analysisResult.symbolTable) return [];

    // Position-aware so a function-LOCAL handle (`let h = fs.open(...); h.`)
    // resolves its object-type methods, not just a global of the same name.
    const symbol = lookupSymbol(objectName, analysisResult, offset);
    if (!symbol || !symbol.dataType) return [];

    // Detect the object type from the symbol's dataType
    let objectType: KnownObjectType | null = null;

    const modType = extractModuleType(symbol.dataType);
    if (modType) {
        const mn = modType.moduleName;
        if (isKnownObjectType(mn)) {
            objectType = mn;
        }
    }

    if (!objectType) return [];

    const reg = OBJECT_REGISTRIES[objectType];
    const completions: CompletionItem[] = [];

    for (const methodName of reg.getMethodNames()) {
        const methodDoc = reg.getMethodDocumentation(methodName);
        const isPropertyType = objectType === 'exception' || objectType === 'fs.statvfs';
        const item: CompletionItem = {
            label: methodName,
            kind: isPropertyType ? CompletionItemKind.Property : CompletionItemKind.Method,
            detail: `${objectType} ${isPropertyType ? 'property' : 'method'}`,
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

function createGeneralCompletions(analysisResult?: SemanticAnalysisResult, connection?: any, offset?: number): CompletionItem[] {
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
    
    // Add variables from symbol table (position-aware to include scoped imports)
    if (analysisResult && analysisResult.symbolTable) {
        const variables = offset !== undefined
            ? analysisResult.symbolTable.getSymbolsAtPosition(offset)
            : analysisResult.symbolTable.getAllSymbols();
        if (connection) {
            connection.console.log(`[INFO] Found ${variables.length} symbols in symbol table (offset: ${offset})`);
        }
        for (const symbol of variables) {
            const varName = symbol.name;
            // Skip builtin functions (already added above)
            if (allBuiltinFunctions.has(varName)) {
                continue;
            }
            // Hide for-in iterator vars while the cursor is still in the head
            // (e.g. typing the iterable). semanticAnalyzer sets visibleFrom on
            // such symbols to the body's start offset.
            if (symbol.visibleFrom !== undefined && offset !== undefined && offset < symbol.visibleFrom) {
                continue;
            }
            
            // Skip module constants objects to prevent constants from leaking globally
            // But we DO want to show the variables themselves (wlconst, rtconst) in completions  
            // The issue is we're filtering out the variable, not individual constants
            const symModType = extractModuleType(symbol.dataType);
            if (symModType) {
              const moduleName = symModType.moduleName;
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

// Named value import used as an object — `import { CONF } from './m'; CONF.foo`.
// Resolves the imported value's OWN object shape (getNamedExportTypeInfo) and
// completes its properties. Distinct from a namespace import (`import * as ns`),
// whose members are the module's exports.
function getImportedValuePropertyCompletions(
    objectName: string,
    analysisResult?: SemanticAnalysisResult,
    documentUri?: string,
    offset?: number
): CompletionItem[] {
    if (!analysisResult || !analysisResult.symbolTable) return [];
    const symbol = lookupSymbol(objectName, analysisResult, offset);
    if (!symbol || symbol.type !== SymbolType.IMPORTED || !symbol.importedFrom) return [];
    // Namespace (`*`) and default imports are handled by their own paths.
    if (!symbol.importSpecifier || symbol.importSpecifier === '*' || symbol.importSpecifier === 'default') return [];

    const uri = resolveModuleUri(symbol.importedFrom, documentUri);
    if (!uri) return [];

    const info = getCompletionFileResolver().getNamedExportTypeInfo(uri, symbol.importSpecifier);
    if (!info || !info.propertyTypes || info.propertyTypes.size === 0) return [];

    const items: CompletionItem[] = [];
    for (const [name, ptype] of info.propertyTypes) {
        items.push({ label: name, kind: CompletionItemKind.Property, detail: typeToString(ptype), insertText: name });
    }
    return items;
}

/**
 * Completions for a direct factory call chain (`make().`): the function's inferred
 * return-object property shape, taken from its symbol's returnPropertyTypes. Works
 * for local function declarations and imported named/default factories (both get
 * returnPropertyTypes populated by the analyzer). Returns [] for functions that
 * don't provably return an object literal.
 */
function getUserFunctionReturnCompletions(funcName: string, analysisResult?: SemanticAnalysisResult, offset?: number): CompletionItem[] {
    if (!analysisResult || !analysisResult.symbolTable) return [];
    const symbol = lookupSymbol(funcName, analysisResult, offset);
    if (!symbol || !symbol.returnPropertyTypes || symbol.returnPropertyTypes.size === 0) return [];

    const items: CompletionItem[] = [];
    for (const [name, ptype] of symbol.returnPropertyTypes) {
        items.push({ label: name, kind: CompletionItemKind.Property, detail: typeToString(ptype), insertText: name });
    }
    return items;
}

function getFallbackNamespaceCompletions(objectName: string, analysisResult?: SemanticAnalysisResult, documentUri?: string): CompletionItem[] {
    if (!analysisResult || !analysisResult.symbolTable) {
        return [];
    }

    const symbol = lookupSymbol(objectName, analysisResult);

    // Only for NAMESPACE imports (import * as ns) — ns.<member> = the module's
    // exports. Named value imports (import { x }) complete their own properties
    // via getImportedValuePropertyCompletions, not the module's exports.
    if (!symbol || !symbol.importedFrom || symbol.type !== SymbolType.IMPORTED || symbol.importSpecifier !== '*') {
        return [];
    }

    // resolveModuleUri returns null for builtin modules (handled by the dedicated
    // module completion functions) and for anything that doesn't resolve to a file.
    const uri = resolveModuleUri(symbol.importedFrom, documentUri);
    if (!uri) return [];
    return getModuleExportCompletions(uri, objectName);
}

function getDefaultImportCompletions(objectName: string, analysisResult?: SemanticAnalysisResult, documentUri?: string): CompletionItem[] {
    const fs = require('fs');

    if (!analysisResult || !analysisResult.symbolTable) {
        return [];
    }

    const symbol = lookupSymbol(objectName, analysisResult);
    if (!symbol) {
        return [];
    }

    // Check if this is a default import (symbol.type === 'imported' but NOT a destructured import)
    if (symbol.type === SymbolType.IMPORTED && symbol.importedFrom &&
        symbol.dataType && typeof symbol.dataType === 'object' &&
        'isDefaultImport' in symbol.dataType && symbol.dataType.isDefaultImport) {

        try {
            // Resolve the import relative to the importing document (not process.cwd()).
            const uri = resolveModuleUri(symbol.importedFrom, documentUri);
            if (!uri) return [];
            const filePath = uri.replace('file://', '');
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

function getNamespaceImportCompletions(objectName: string, analysisResult?: SemanticAnalysisResult, documentUri?: string): CompletionItem[] {
    if (!analysisResult || !analysisResult.symbolTable) {
        return [];
    }

    const symbol = lookupSymbol(objectName, analysisResult);
    if (!symbol) {
        return [];
    }

    // Check if this is a namespace import (import * as name from 'module').
    // Be permissive to catch edge cases, but avoid conflicts with default imports.
    if (symbol.type === SymbolType.IMPORTED && symbol.importedFrom &&
        (symbol.importSpecifier === '*' ||
         !(symbol.dataType && typeof symbol.dataType === 'object' &&
           'isDefaultImport' in symbol.dataType && symbol.dataType.isDefaultImport))) {

        // resolveModuleUri returns null for builtin modules (handled by the
        // dedicated module completion functions) and for unresolvable paths.
        const uri = resolveModuleUri(symbol.importedFrom, documentUri);
        if (!uri) return [];
        return getModuleExportCompletions(uri, objectName);
    }

    return [];
}

function getPropertyChainCompletions(objectName: string, propertyChain: string[], analysisResult?: SemanticAnalysisResult, offset?: number): CompletionItem[] {
    const fs = require('fs');

    if (!analysisResult || !analysisResult.symbolTable) {
        return [];
    }

    const symbol = lookupSymbol(objectName, analysisResult, offset);
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
    
    // Generic nested object properties: `obj.prop.` completes prop's sub-keys
    // from the symbol's nestedPropertyTypes (one level deep — the only depth the
    // analyzer records). e.g. `let o = { inner: { z: 1 } }; o.inner.` → `z`.
    if (propertyChain.length === 1 && symbol.nestedPropertyTypes) {
        const nested = symbol.nestedPropertyTypes.get(propertyChain[0]!);
        if (nested && nested.size > 0) {
            const items: CompletionItem[] = [];
            for (const [name, ptype] of nested) {
                items.push({
                    label: name,
                    kind: CompletionItemKind.Property,
                    detail: typeToString(ptype),
                    insertText: name
                });
            }
            return items;
        }
    }

    // TODO: Add more property chain patterns here
    // - module.exports.* patterns
    // - method chaining completions

    return [];
}

function getVariableCompletions(objectName: string, analysisResult?: SemanticAnalysisResult, documentUri?: string, offset?: number): CompletionItem[] {
    if (!analysisResult || !analysisResult.symbolTable) {
        return [];
    }

    const symbol = lookupSymbol(objectName, analysisResult, offset);
    if (!symbol) {
        return [];
    }

    // Imported symbol used as an object — complete the module's exports (cached AST).
    if (symbol.type === SymbolType.IMPORTED && symbol.importedFrom) {
        const uri = resolveModuleUri(symbol.importedFrom, documentUri);
        if (!uri) return [];
        return getModuleExportCompletions(uri, objectName);
    }

    // Variables with a KNOWN object shape — object literals, catch params (the
    // exception object's message/stacktrace/type), JSDoc-typed objects, and
    // factory/default-export return objects — carry inferred propertyTypes. These
    // aren't "arbitrary"; complete them as the object's properties.
    if (symbol.propertyTypes && symbol.propertyTypes.size > 0) {
        const items: CompletionItem[] = [];
        for (const [name, ptype] of symbol.propertyTypes) {
            items.push({
                label: name,
                kind: CompletionItemKind.Property,
                detail: typeToString(ptype),
                insertText: name
            });
        }
        return items;
    }

    return [];
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
        parser.setComments(lexer.comments);
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

function getNl80211ConstObjectCompletions(objectName: string, analysisResult?: SemanticAnalysisResult): CompletionItem[] {
    console.log(`[NL80211_CONST_COMPLETION] Checking nl80211 constants completion for: ${objectName}`);
    
    if (!analysisResult || !analysisResult.symbolTable) {
        console.log(`[NL80211_CONST_COMPLETION] No analysisResult or symbolTable for ${objectName}`);
        return [];
    }

    const symbol = lookupSymbol(objectName, analysisResult);
    if (!symbol) {
        console.log(`[NL80211_CONST_COMPLETION] Symbol not found: ${objectName}`);
        return [];
    }

    console.log(`[NL80211_CONST_COMPLETION] Symbol found: ${objectName}, dataType: ${JSON.stringify(symbol.dataType)}`);

    // Check if this is an nl80211 constants object (imported as 'const' from nl80211)
    if (extractModuleType(symbol.dataType)?.moduleName === 'nl80211-const') {
        
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
    const symbol = lookupSymbol(objectName, analysisResult);
    if (!symbol) {
        console.log(`[RTNL_CONST_COMPLETION] Symbol not found: ${objectName}`);
        return [];
    }
    console.log(`[RTNL_CONST_COMPLETION] Symbol found: ${objectName}, dataType: ${JSON.stringify(symbol.dataType)}`);
    
    // Check if this is an rtnl constants object (imported as 'const' from rtnl)
    if (extractModuleType(symbol.dataType)?.moduleName === 'rtnl-const') {
        
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

// ---- JSDoc completion support ----

interface JsDocCompletionContext {
    kind: 'tag' | 'type' | 'import-path';
    /** For kind === 'import-path': the partial path already typed inside the
     *  `import('…` quotes (e.g. `./sy`), used to drive file completion. */
    partialPath?: string;
}

function detectJsDocCompletionContext(text: string, offset: number, comments: Token[]): JsDocCompletionContext | null {
    // Find the comment token that contains the cursor offset
    for (const comment of comments) {
        if (offset >= comment.pos && offset <= comment.end) {
            const val = String(comment.value);
            if (!val.startsWith('*')) continue; // Not a JSDoc comment

            // Get text from comment start to cursor position
            const textBeforeCursor = text.substring(comment.pos, offset);

            // Check if we're right after @ or typing a tag name
            const afterAtMatch = textBeforeCursor.match(/@(\w*)$/);
            if (afterAtMatch) {
                return { kind: 'tag' };
            }

            // Inside the quotes of an `import('…')` type reference — complete file
            // paths. Must be checked before the generic type patterns below, which
            // would otherwise swallow it as a plain type position.
            const importPathMatch = textBeforeCursor.match(/\{[^}]*\bimport\(\s*['"]([^'"]*)$/);
            if (importPathMatch) {
                return { kind: 'import-path', partialPath: importPathMatch[1] ?? '' };
            }

            // Check if we're in a type position:
            // After @param {, @param name , @returns {, @returns , @param {type} name (no - we want after the tag)
            // Simplified: after @param name or @param { or @returns { or @returns
            const typeContextPatterns = [
                /@param\s+\{[^}]*$/,           // @param {partial_type
                /@param\s+\w+\s+\{?[^-]*$/,    // @param name partial_type or @param name {partial
                /@returns?\s+\{?[^-]*$/,        // @returns partial_type
            ];

            for (const pattern of typeContextPatterns) {
                if (pattern.test(textBeforeCursor)) {
                    return { kind: 'type' };
                }
            }

            return null;
        }
    }
    return null;
}

function createJsDocCompletions(context: JsDocCompletionContext, documentUri: string, connection: any): CompletionItem[] {
    // Cursor is inside `import('…')` — complete sibling files/directories so the
    // user picks a real module path instead of typing it blind.
    if (context.kind === 'import-path') {
        const partial = context.partialPath ?? '';
        const completions = createFileSystemCompletions(partial, documentUri, connection);
        // A bare path (`output.uc`) resolves as a module-search name, not relative
        // to this file, so the type fails to resolve (UC7001). When the user hasn't
        // typed a relative prefix yet, insert one so the path actually resolves.
        // filterText stays the bare name so it still matches what the user types
        // (a `./`-prefixed label would otherwise be filtered out by a typed `o`).
        if (!partial.startsWith('.') && !partial.startsWith('/')) {
            for (const c of completions) {
                const bare = (c.insertText ?? c.label);
                c.filterText = bare;
                c.insertText = './' + bare;
                c.label = './' + c.label;
            }
        }
        return completions;
    }

    if (context.kind === 'tag') {
        return [
            { label: 'param', kind: CompletionItemKind.Keyword, detail: '@param {type} name - description', insertText: 'param ', sortText: '0param' },
            { label: 'returns', kind: CompletionItemKind.Keyword, detail: '@returns {type} description', insertText: 'returns ', sortText: '0returns' },
            { label: 'typedef', kind: CompletionItemKind.Keyword, detail: '@typedef {object} TypeName', insertText: 'typedef ', sortText: '0typedef' },
            { label: 'property', kind: CompletionItemKind.Keyword, detail: '@property {type} name - description', insertText: 'property ', sortText: '0property' },
            { label: 'type', kind: CompletionItemKind.Keyword, detail: '@type {type}', insertText: 'type ', sortText: '0type' },
            { label: 'description', kind: CompletionItemKind.Keyword, detail: '@description text', insertText: 'description ', sortText: '0description' },
        ];
    }

    // Type completions
    const items: CompletionItem[] = [];

    // Primitive types
    const primitives = ['string', 'number', 'integer', 'boolean', 'array', 'object', 'function', 'null'];
    for (const prim of primitives) {
        items.push({
            label: prim,
            kind: CompletionItemKind.TypeParameter,
            sortText: `1${prim}`,
        });
    }

    // Module types
    for (const moduleName of Object.keys(MODULE_REGISTRIES)) {
        items.push({
            label: `module:${moduleName}`,
            kind: CompletionItemKind.Module,
            detail: `${moduleName} module`,
            sortText: `2module:${moduleName}`,
        });
    }

    // Object types
    for (const objectType of Object.keys(OBJECT_REGISTRIES)) {
        items.push({
            label: objectType,
            kind: CompletionItemKind.Class,
            detail: `${objectType} object type`,
            sortText: `3${objectType}`,
        });
    }

    // Concrete cross-file type references: one per sibling `.uc` module. Picking
    // `import('./sys.uc')` resolves to that module's type (a factory's return
    // shape, an exported object, or a named export's type) with no hand-written
    // typedef. This is the discoverable, non-guessing way to reach the import()
    // syntax — the canonical form a user would otherwise have to know by heart.
    items.push(...createSiblingImportTypeCompletions(documentUri));

    // Generic import() type snippet (fallback when the target isn't a sibling, or
    // when the user wants a specific exported property: `import('mod').Name`).
    items.push({
        label: "import('module').type",
        kind: CompletionItemKind.Snippet,
        detail: 'Cross-file type reference',
        insertText: "import('$1').$2",
        insertTextFormat: InsertTextFormat.Snippet,
        sortText: '5import',
    });

    return items;
}

/** Offer `import('./<file>.uc')` for each sibling `.uc` module of the document,
 *  so the import() type syntax is discoverable from the `@param {` completion
 *  list. Bare form (no `.property`) — correct for factory default-exports and
 *  whole-module object exports alike. */
function createSiblingImportTypeCompletions(documentUri: string): CompletionItem[] {
    const items: CompletionItem[] = [];
    try {
        const documentPath = new URL(documentUri).pathname;
        const documentDir = path.dirname(documentPath);
        const currentFile = path.basename(documentPath);
        if (!fs.existsSync(documentDir) || !fs.statSync(documentDir).isDirectory()) return items;
        const resolver = getCompletionFileResolver();
        for (const entry of fs.readdirSync(documentDir)) {
            if (!entry.endsWith('.uc') || entry === currentFile) continue;
            const ref = `import('./${entry}')`;
            // Bare form: the whole module's exported type (a factory's return shape
            // or a whole-module object).
            items.push({
                label: ref,
                kind: CompletionItemKind.Module,
                detail: `Type from ${entry}`,
                insertText: ref,
                sortText: `4import:${entry}:`,
                documentation: {
                    kind: MarkupKind.Markdown,
                    value: `Cross-file type reference to \`${entry}\`.\n\nResolves to the module's exported type — a factory's return shape, an exported object, or a named export.`
                }
            });

            // Property forms: `import('./pkg.uc').pkg`. A module whose default
            // export is an OBJECT (`export default { pkg, sym, … }`) is usually
            // consumed one property at a time (`let pkg = mod.pkg`), so the bare
            // form gives the wrong shape — offer each property/named export so the
            // right one is discoverable.
            const siblingUri = 'file://' + path.join(documentDir, entry);
            const propNames = new Set<string>();
            const defInfo = resolver.getDefaultExportPropertyTypes(siblingUri);
            if (defInfo?.propertyTypes) {
                for (const p of defInfo.propertyTypes.keys()) propNames.add(p);
            }
            const exports = resolver.getModuleExports(siblingUri);
            for (const e of exports || []) {
                if (e.type === 'named') propNames.add(e.name);
            }
            for (const prop of propNames) {
                const propRef = `import('./${entry}').${prop}`;
                items.push({
                    label: propRef,
                    kind: CompletionItemKind.Module,
                    detail: `Type of ${prop} from ${entry}`,
                    insertText: propRef,
                    sortText: `4import:${entry}:${prop}`,
                    documentation: {
                        kind: MarkupKind.Markdown,
                        value: `Cross-file type reference to the \`${prop}\` export of \`${entry}\`.`
                    }
                });
            }
        }
    } catch {
        // Best-effort discoverability aid; ignore FS errors.
    }
    return items;
}

export function handleCompletionResolve(item: CompletionItem): CompletionItem {
    return item;
}
