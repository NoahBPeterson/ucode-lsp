/**
 * Shared import-insertion placement, used by both the UC3006 "add import" quick
 * fix and auto-import-on-completion. Inserts a new import line after the leading
 * run of existing imports / a `'use strict'` directive, or at the very top.
 */
import { TextEdit } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { AstNode, ProgramNode, ExpressionStatementNode, LiteralNode } from './ast/nodes';

/** Offset at the end of the leading imports / 'use strict' run, or -1 if none. */
export function leadingImportAnchor(ast: AstNode | null | undefined): number {
    let anchorEnd = -1;
    const body: AstNode[] = (ast && Array.isArray((ast as ProgramNode).body)) ? (ast as ProgramNode).body : [];
    for (const stmt of body) {
        if (stmt?.type === 'ImportDeclaration') anchorEnd = stmt.end;
        else if (anchorEnd === -1 && stmt?.type === 'ExpressionStatement'
            && (stmt as ExpressionStatementNode).expression?.type === 'Literal'
            && ((stmt as ExpressionStatementNode).expression as LiteralNode).value === 'use strict') anchorEnd = stmt.end;
        else break;
    }
    return anchorEnd;
}

/** A TextEdit that inserts `importText` as its own line in the right place. */
export function computeImportInsertEdit(ast: AstNode | null | undefined, document: TextDocument, importText: string): TextEdit {
    const anchorEnd = leadingImportAnchor(ast);
    return anchorEnd >= 0
        ? TextEdit.insert(document.positionAt(anchorEnd), `\n${importText}`)
        : TextEdit.insert({ line: 0, character: 0 }, `${importText}\n`);
}
