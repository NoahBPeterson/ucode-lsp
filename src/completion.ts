import {
    TextDocumentPositionParams,
    CompletionItem,
    CompletionItemKind,
    MarkupKind
} from 'vscode-languageserver/node';
import { builtinFunctions } from './builtins';

export function handleCompletion(_textDocumentPositionParams: TextDocumentPositionParams): CompletionItem[] {
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
}

export function handleCompletionResolve(item: CompletionItem): CompletionItem {
    return item;
}