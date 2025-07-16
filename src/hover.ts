import {
    TextDocumentPositionParams,
    Hover,
    MarkupKind
} from 'vscode-languageserver/node';
import { UcodeLexer, TokenType, isKeyword } from './lexer';
import { builtinFunctions } from './builtins';
import { SemanticAnalysisResult, SymbolType } from './analysis';
import { typeToString } from './analysis/symbolTable';

export function handleHover(
    textDocumentPositionParams: TextDocumentPositionParams,
    documents: any,
    connection: any,
    analysisResult?: SemanticAnalysisResult
): Hover | undefined {
    connection.console.log('Hover request received for: ' + textDocumentPositionParams.textDocument.uri);
    const document = documents.get(textDocumentPositionParams.textDocument.uri);
    if (!document) {
        connection.console.log('Document not found');
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
            connection.console.log('Hover word (from lexer): ' + word);
            
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
            
            // 2. Fallback to built-in functions and keywords
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