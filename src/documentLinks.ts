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
import type { AstNode } from './ast/nodes';
import { walkAst } from './ast/astChildren';

interface PathResolver {
    resolveImportPath(importPath: string, currentFileUri: string): string | null;
    /** include('…') targets — file-relative, or LuCI template-root for LuCI templates/
     *  controllers. Optional so older/lighter resolvers keep working without it. */
    resolveIncludeTarget?(rawPath: string, currentFileUri: string): string | null;
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

    const addLink = (sourceLit: AstNode | null | undefined, resolve?: (raw: string) => string | null): void => {
        if (!sourceLit || sourceLit.type !== 'Literal') return;
        const raw = sourceLit.value;
        if (typeof raw !== 'string') return;
        const target = resolve ? resolve(raw) : fileResolver.resolveImportPath(raw, uri);
        if (!target || !target.startsWith('file://')) return; // skip builtins / unresolved
        const range = innerRange(sourceLit);
        if (range) links.push({ range, target });
    };

    walkAst(ast, (node) => {
        switch (node.type) {
            case 'ImportDeclaration':
            case 'ExportAllDeclaration':
                addLink(node.source);
                break;
            case 'ExportNamedDeclaration': {
                if (node.source) addLink(node.source); // re-export: `export { x } from '...'`
                break;
            }
            case 'CallExpression': {
                if (node.callee.type === 'Identifier' && node.callee.name === 'require'
                    && node.arguments.length >= 1) {
                    addLink(node.arguments[0]);
                }
                // include('…') — file-relative, or a LuCI template-root name ('header').
                if (node.callee.type === 'Identifier' && node.callee.name === 'include'
                    && node.arguments.length >= 1 && fileResolver.resolveIncludeTarget) {
                    addLink(node.arguments[0], (raw) => fileResolver.resolveIncludeTarget!(raw, uri));
                }
                break;
            }
        }
    });
    return links;
}
