import {
    DefinitionParams,
    Definition,
    Range
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { UcodeLexer, TokenType } from './lexer';
import { SemanticAnalysisResult, Symbol, SymbolType } from './analysis';
import { FileResolver } from './analysis/fileResolver';
import { isKnownObjectType, OBJECT_REGISTRIES } from './analysis/moduleDispatch';
import { extractModuleType } from './analysis/symbolTable';
import { Option } from 'effect';

// Global file resolver instance
let fileResolver: FileResolver | null = null;

export function handleDefinition(
    params: DefinitionParams,
    documents: any,
    analysisCache: Map<string, SemanticAnalysisResult>
): Definition | null {
    // Initialize file resolver if not already done
    if (!fileResolver) {
        fileResolver = new FileResolver();
    }
    const document = documents.get(params.textDocument.uri);
    const analysisResult = analysisCache.get(params.textDocument.uri);
    
    if (!document || !analysisResult) {
        return null;
    }

    const position = params.position;
    const text = document.getText();
    const offset = document.offsetAt(position);
    
    try {
        const lexer = new UcodeLexer(text, { rawMode: true });
        const tokens = lexer.tokenize();
        
        // Find the token at the cursor position
        const token = tokens.find(t => t.pos <= offset && offset <= t.end);
        
        if (token && token.type === TokenType.TK_LABEL && typeof token.value === 'string') {
            const symbolName = token.value;
            
            // Look up the symbol in the symbol table (position-aware for nested scopes)
            const symbol = analysisResult.symbolTable.lookupAtPosition(symbolName, offset)
                        || analysisResult.symbolTable.lookup(symbolName);

            if (symbol) {
                return getSymbolDefinition(symbol, document, fileResolver);
            }

            // Check if this is a method on a known object type (e.g., ctx_dhcp.get)
            // Look for preceding DOT + LABEL pattern in tokens
            const tokenIndex = tokens.indexOf(token);
            if (tokenIndex >= 2) {
                const dotToken = tokens[tokenIndex - 1];
                const objToken = tokens[tokenIndex - 2];
                if (dotToken && dotToken.type === TokenType.TK_DOT &&
                    objToken && objToken.type === TokenType.TK_LABEL && typeof objToken.value === 'string') {
                    const objSymbol = analysisResult.symbolTable.lookupAtPosition(objToken.value, offset)
                                   || analysisResult.symbolTable.lookup(objToken.value);

                    // Namespace import member: `import * as U from './m'; U.foo()` —
                    // resolve `foo` as an export of U's source module.
                    if (objSymbol && objSymbol.type === SymbolType.IMPORTED
                        && objSymbol.importSpecifier === '*' && objSymbol.importedFrom) {
                        let nsUri: string | null;
                        if (objSymbol.importedFrom.startsWith('file://')) {
                            nsUri = objSymbol.importedFrom;
                        } else if (objSymbol.importedFrom.startsWith('builtin://')) {
                            nsUri = null;
                        } else {
                            nsUri = fileResolver.resolveImportPath(objSymbol.importedFrom, document.uri);
                        }
                        if (nsUri) {
                            const nsLoc = locateFunctionDefinition(nsUri, symbolName, fileResolver);
                            if (nsLoc) return nsLoc;
                        }
                    }

                    const moduleType = objSymbol ? extractModuleType(objSymbol.dataType) : null;
                    if (objSymbol && moduleType) {
                        const moduleName = moduleType.moduleName;
                        if (isKnownObjectType(moduleName)) {
                            const method = OBJECT_REGISTRIES[moduleName].getMethod(symbolName);
                            if (Option.isSome(method)) {
                                // Known built-in method — navigate to the object's declaration instead
                                return getSymbolDefinition(objSymbol, document, fileResolver);
                            }
                        }
                    }
                }
            }
        }
    } catch (error) {
        // Fallback to word-based lookup if lexer fails
        const wordRange = getWordRangeAtPosition(text, offset);
        if (wordRange) {
            const symbolName = text.substring(wordRange.start, wordRange.end);
            const symbol = analysisResult.symbolTable.lookupAtPosition(symbolName, offset)
                        || analysisResult.symbolTable.lookup(symbolName);
            if (symbol) {
                return getSymbolDefinition(symbol, document, fileResolver);
            }
        }
    }
    
    return null;
}

function getSymbolDefinition(symbol: Symbol, currentDocument: TextDocument, fileResolver: FileResolver): Definition | null {
    // Built-in functions don't have definitions we can navigate to
    if (symbol.type === SymbolType.BUILTIN) {
        return null;
    }
    
    // Handle imported symbols
    if (symbol.type === SymbolType.IMPORTED) {
        return getImportedSymbolDefinition(symbol, currentDocument, fileResolver);
    }
    
    // Handle local symbols (functions, variables, parameters)
    if (symbol.type === SymbolType.FUNCTION || 
        symbol.type === SymbolType.VARIABLE || 
        symbol.type === SymbolType.PARAMETER) {
        
        const position = currentDocument.positionAt(symbol.declaredAt);
        const range: Range = {
            start: position,
            end: position
        };
        
        return {
            uri: currentDocument.uri,
            range: range
        };
    }
    
    return null;
}

function getImportedSymbolDefinition(symbol: Symbol, currentDocument: TextDocument, fileResolver: FileResolver): Definition | null {
    if (!symbol.importedFrom || !symbol.importSpecifier) {
        return null;
    }
    
    // Resolve the import path to an absolute URI
    let targetUri: string | null;
    if (symbol.importedFrom.startsWith('file://')) {
        targetUri = symbol.importedFrom;
    } else if (symbol.importedFrom.startsWith('builtin://')) {
        return null;
    } else {
        targetUri = fileResolver.resolveImportPath(symbol.importedFrom, currentDocument.uri);
    }
    if (!targetUri) {
        console.log(`Could not resolve import path: ${symbol.importedFrom}`);
        return null;
    }
    
    // Find the definition, following re-export chains
    // (e.g. `import { x } from './a'; export { x };` in the target file).
    const functionName = symbol.importSpecifier === '*' || symbol.importSpecifier === 'default'
        ? symbol.name
        : symbol.importSpecifier;

    const loc = locateFunctionDefinition(targetUri, functionName, fileResolver);
    if (loc) return loc;

    // Couldn't find the function itself (e.g. a non-function export). Fall back
    // to the top of the resolved module so navigation still lands in the right file.
    console.log(`Could not find function definition for: ${functionName} in ${targetUri}`);
    return {
        uri: targetUri,
        range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 }
        }
    };
}

/**
 * Resolve a function's declaration in `targetUri`, following re-export chains:
 * if the name isn't declared in the target file but is imported there from
 * another module, follow that import (depth-bounded) to the real declaration.
 * Returns the LSP Definition, or null if the declaration can't be found.
 */
function locateFunctionDefinition(targetUri: string, functionName: string, fileResolver: FileResolver): Definition | null {
    let curUri = targetUri;
    let curName = functionName;
    let functionDef = fileResolver.findFunctionDefinition(curUri, curName);

    for (let depth = 0; !functionDef && depth < 8; depth++) {
        const reexport = fileResolver.findReexportedSource(curUri, curName);
        if (!reexport || reexport.uri.startsWith('builtin://')) break;
        curUri = reexport.uri;
        curName = reexport.importedName;
        functionDef = fileResolver.findFunctionDefinition(curUri, curName);
    }

    if (!functionDef) return null;

    // Convert byte offsets in the (possibly chained-to) file to LSP positions.
    // Use the same buffer-or-disk content FileResolver parsed, so an unsaved
    // imported file maps offsets to the right lines.
    try {
        const targetDocContent = fileResolver.getFileContent(curUri);
        if (targetDocContent === null) return null;
        const positionAt = (offset: number) => {
            const clamped = Math.max(0, Math.min(offset, targetDocContent.length));
            const slice = targetDocContent.slice(0, clamped);
            const lines = slice.split('\n');
            const lastLine = lines.at(-1) ?? '';
            return { line: Math.max(0, lines.length - 1), character: lastLine.length };
        };
        return { uri: curUri, range: { start: positionAt(functionDef.start), end: positionAt(functionDef.end) } };
    } catch (error) {
        console.error('Error converting position:', error);
        return { uri: curUri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } };
    }
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