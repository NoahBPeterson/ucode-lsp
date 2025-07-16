import {
    DefinitionParams,
    Definition,
    Range
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { UcodeLexer, TokenType } from './lexer';
import { SemanticAnalysisResult, Symbol, SymbolType } from './analysis';
import { FileResolver } from './analysis/fileResolver';

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
            
            // Look up the symbol in the symbol table
            const symbol = analysisResult.symbolTable.lookup(symbolName);
            
            if (symbol) {
                return getSymbolDefinition(symbol, document, fileResolver);
            }
        }
    } catch (error) {
        // Fallback to word-based lookup if lexer fails
        const wordRange = getWordRangeAtPosition(text, offset);
        if (wordRange) {
            const symbolName = text.substring(wordRange.start, wordRange.end);
            const symbol = analysisResult.symbolTable.lookup(symbolName);
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
    const targetUri = fileResolver.resolveImportPath(symbol.importedFrom, currentDocument.uri);
    if (!targetUri) {
        console.log(`Could not resolve import path: ${symbol.importedFrom}`);
        return null;
    }
    
    // Find the actual function definition in the target file
    const functionName = symbol.importSpecifier === '*' || symbol.importSpecifier === 'default' 
        ? symbol.name 
        : symbol.importSpecifier;
    
    const functionDef = fileResolver.findFunctionDefinition(targetUri, functionName);
    if (!functionDef) {
        console.log(`Could not find function definition for: ${functionName} in ${targetUri}`);
        // Fall back to top of file if we can't find the specific function
        return {
            uri: targetUri,
            range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 0 }
            }
        };
    }
    
    // Convert the function definition position to LSP position
    // We need to convert byte offset to line/character position
    try {
        // Try to get the target document to convert positions
        const targetDocContent = require('fs').readFileSync(targetUri.replace('file://', ''), 'utf8');
        const targetDoc = {
            getText: () => targetDocContent,
            positionAt: (offset: number) => {
                const lines = targetDocContent.substring(0, offset).split('\n');
                return {
                    line: lines.length - 1,
                    character: lines[lines.length - 1].length
                };
            }
        };
        
        const startPos = targetDoc.positionAt(functionDef.start);
        const endPos = targetDoc.positionAt(functionDef.end);
        
        return {
            uri: targetUri,
            range: {
                start: startPos,
                end: endPos
            }
        };
    } catch (error) {
        console.error('Error converting position:', error);
        // Fall back to top of file
        return {
            uri: targetUri,
            range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 0 }
            }
        };
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