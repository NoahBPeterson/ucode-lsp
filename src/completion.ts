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

export function handleCompletion(
    textDocumentPositionParams: TextDocumentPositionParams,
    documents: any,
    connection: any,
    _analysisResult?: SemanticAnalysisResult
): CompletionItem[] {
    const document = documents.get(textDocumentPositionParams.textDocument.uri);
    if (!document) {
        return createGeneralCompletions();
    }

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
            
            // For member expressions, we could add object-specific completions here
            // For now, don't show any completions for unknown objects
            connection.console.log(`No specific completions for object: ${objectName}`);
            
            // For any member expression, return empty array - never show builtin functions
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
            // Make sure the cursor is after the dot (for completion)
            if (offset > dotToken.end) {
                return {
                    objectName: prevToken.value as string
                };
            }
        }
    }
    
    return undefined;
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