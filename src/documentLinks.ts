/**
 * Document links for module path strings — makes the `'...'` in `import … from
 * '...'`, re-exports (`export … from '...'`, `export * from '...'`) and
 * `require('...')` Ctrl/Cmd-clickable, opening the resolved `.uc` file.
 *
 * Only local files get a link: builtin modules (`fs`, `ubus`, …) resolve to a
 * `builtin://` URI with no file to open, so they're skipped.
 */
import { DocumentLink, Range } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type {
    AstNode,
    LiteralNode,
    ImportDeclarationNode,
    ExportAllDeclarationNode,
    ExportNamedDeclarationNode,
    CallExpressionNode,
    IdentifierNode,
} from './ast/nodes';

interface PathResolver {
    resolveImportPath(importPath: string, currentFileUri: string): string | null;
}

export function provideDocumentLinks(
    ast: AstNode | null | undefined,
    document: TextDocument,
    fileResolver: PathResolver,
    uri: string,
): DocumentLink[] {
    if (!ast) return [];
    const links: DocumentLink[] = [];

    // The byte range of the path *inside* the surrounding quotes, so the link
    // underlines just the path and not the quote characters.
    const innerRange = (lit: AstNode): Range | null => {
        if (typeof lit?.start !== 'number' || typeof lit?.end !== 'number') return null;
        const raw = document.getText().slice(lit.start, lit.end);
        const quoted = raw.length >= 2 && (raw[0] === '"' || raw[0] === "'" || raw[0] === '`');
        const s = quoted ? lit.start + 1 : lit.start;
        const e = quoted ? lit.end - 1 : lit.end;
        if (e <= s) return null;
        return { start: document.positionAt(s), end: document.positionAt(e) };
    };

    const addLink = (sourceLit: AstNode | null | undefined): void => {
        if (!sourceLit || sourceLit.type !== 'Literal' || typeof (sourceLit as LiteralNode).value !== 'string') return;
        const target = fileResolver.resolveImportPath((sourceLit as LiteralNode).value as string, uri);
        if (!target || !target.startsWith('file://')) return; // skip builtins / unresolved
        const range = innerRange(sourceLit);
        if (range) links.push({ range, target });
    };

    const walk = (node: AstNode): void => {
        if (!node || typeof node !== 'object' || typeof node.type !== 'string') return;

        switch (node.type) {
            case 'ImportDeclaration':
            case 'ExportAllDeclaration':
                addLink((node as ImportDeclarationNode | ExportAllDeclarationNode).source);
                break;
            case 'ExportNamedDeclaration': {
                const exp = node as ExportNamedDeclarationNode;
                if (exp.source) addLink(exp.source); // re-export: `export { x } from '...'`
                break;
            }
            case 'CallExpression': {
                const call = node as CallExpressionNode;
                if (call.callee?.type === 'Identifier' && (call.callee as IdentifierNode).name === 'require'
                    && call.arguments?.length >= 1) {
                    addLink(call.arguments[0]);
                }
                break;
            }
        }

        for (const k of Object.keys(node)) {
            if (k === 'leadingJsDoc') continue;
            const v = (node as unknown as Record<string, unknown>)[k];
            if (Array.isArray(v)) { for (const it of v) walk(it as AstNode); }
            else if (v && typeof v === 'object' && typeof (v as { type?: unknown }).type === 'string') walk(v as AstNode);
        }
    };

    walk(ast);
    return links;
}
