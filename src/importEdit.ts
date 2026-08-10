/**
 * Shared import-insertion placement, used by both the UC3006 "add import" quick
 * fix and auto-import-on-completion. Inserts a new import line after the leading
 * run of existing imports / a `'use strict'` directive, or at the very top.
 */
import { TextEdit } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { AstNode, ImportDeclarationNode, ImportSpecifierNode } from './ast/nodes';

/** The statement list of a body-carrying root (Program/BlockStatement), else empty. */
function rootBody(ast: AstNode | null | undefined): AstNode[] {
    return (ast && (ast.type === 'Program' || ast.type === 'BlockStatement')) ? ast.body : [];
}

/** Offset at the end of the leading imports / 'use strict' run, or -1 if none. */
export function leadingImportAnchor(ast: AstNode | null | undefined): number {
    let anchorEnd = -1;
    for (const stmt of rootBody(ast)) {
        if (stmt?.type === 'ImportDeclaration') anchorEnd = stmt.end;
        else if (anchorEnd === -1 && stmt?.type === 'ExpressionStatement'
            && stmt.expression?.type === 'Literal'
            && stmt.expression.value === 'use strict') anchorEnd = stmt.end;
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

/** An existing `import { … } from '<module>'` (with at least one NAMED specifier) so a
 *  new named import can be merged into its brace list instead of adding a second line. */
function findMergeableNamedImport(ast: AstNode | null | undefined, module: string): ImportDeclarationNode | null {
    for (const stmt of rootBody(ast)) {
        if (stmt?.type !== 'ImportDeclaration') continue;
        const decl = stmt;
        if (decl.source?.value !== module) continue;
        if (decl.specifiers?.some(s => s.type === 'ImportSpecifier')) return decl;
    }
    return null;
}

/**
 * Add a single named import `name` from `module` (ticket 93). If the file already imports
 * from `module` with a `{ … }` list, merge `name` into that list (`, name` after the last
 * named specifier) — an AST-offset edit — instead of adding a duplicate `import` line.
 * Returns `null` when `name` is already imported from `module` (nothing to do). Otherwise
 * falls back to a fresh `import { name } from 'module';` line.
 */
export function computeNamedImportEdit(
    ast: AstNode | null | undefined, document: TextDocument, module: string, name: string
): TextEdit | null {
    const existing = findMergeableNamedImport(ast, module);
    if (existing) {
        const named = existing.specifiers.filter((s): s is ImportSpecifierNode => s.type === 'ImportSpecifier');
        // Already present (by local binding or imported name) → no edit needed.
        if (named.some(s => s.local?.name === name || s.imported?.name === name)) return null;
        const first = named[0];
        if (!first) return null;
        const last = named.reduce((a, b) => (b.end > a.end ? b : a), first);
        return TextEdit.insert(document.positionAt(last.end), `, ${name}`);
    }
    return computeImportInsertEdit(ast, document, `import { ${name} } from '${module}';`);
}
