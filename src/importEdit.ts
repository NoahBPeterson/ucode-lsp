/**
 * Shared import-insertion placement, used by both the UC3006 "add import" quick
 * fix and auto-import-on-completion. Inserts a new import line after the leading
 * run of existing imports / a `'use strict'` directive, or at the very top.
 */
import { TextEdit } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';

/** Offset at the end of the leading imports / 'use strict' run, or -1 if none. */
export function leadingImportAnchor(ast: any): number {
    let anchorEnd = -1;
    for (const stmt of (ast?.body || [])) {
        if (stmt?.type === 'ImportDeclaration') anchorEnd = stmt.end;
        else if (anchorEnd === -1 && stmt?.type === 'ExpressionStatement'
            && stmt.expression?.type === 'Literal' && stmt.expression.value === 'use strict') anchorEnd = stmt.end;
        else break;
    }
    return anchorEnd;
}

/** A TextEdit that inserts `importText` as its own line in the right place. */
export function computeImportInsertEdit(ast: any, document: TextDocument, importText: string): TextEdit {
    const anchorEnd = leadingImportAnchor(ast);
    return anchorEnd >= 0
        ? TextEdit.insert(document.positionAt(anchorEnd), `\n${importText}`)
        : TextEdit.insert({ line: 0, character: 0 }, `${importText}\n`);
}
