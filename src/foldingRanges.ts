// Folding ranges for ucode. Three sources, all structural (no type analysis):
//   - block-bearing AST nodes: { } blocks (function bodies, if/for/while/try/catch),
//     object/array literals, and switch statements
//   - the leading run of consecutive `import` declarations (FoldingRangeKind.Imports)
//   - comments: multi-line block comments and runs of adjacent line comments
//
// The closing token's line is the fold's endLine (the editor hides startLine+1..endLine),
// matching how function/object folds behave elsewhere. Single-line spans never fold.

import { FoldingRange, FoldingRangeKind } from 'vscode-languageserver/node';

type LineAt = (offset: number) => number;

// Nodes whose `start`..`end` span is a foldable region.
const BLOCK_NODE_TYPES = new Set([
    'BlockStatement',   // function bodies, if/for/while/try/catch/bare blocks
    'ObjectExpression',
    'ArrayExpression',
    'SwitchStatement',
]);

export function provideFoldingRanges(
    ast: any,
    comments: any[],
    text: string,
    lineAt: LineAt,
): FoldingRange[] {
    const ranges: FoldingRange[] = [];
    const seen = new Set<string>();

    const add = (startLine: number, endLine: number, kind?: FoldingRangeKind): void => {
        if (!(endLine > startLine)) return; // need at least two lines to fold
        const key = `${startLine}:${endLine}:${kind ?? ''}`;
        if (seen.has(key)) return;
        seen.add(key);
        const range: FoldingRange = { startLine, endLine };
        if (kind) range.kind = kind;
        ranges.push(range);
    };

    // 1) Block-bearing AST nodes.
    const visit = (node: any): void => {
        if (!node || typeof node !== 'object' || typeof node.type !== 'string') return;
        if (BLOCK_NODE_TYPES.has(node.type) && typeof node.start === 'number' && typeof node.end === 'number') {
            add(lineAt(node.start), lineAt(node.end - 1));
        }
        for (const k of Object.keys(node)) {
            if (k === 'leadingJsDoc') continue; // JSDoc is folded via the comment pass
            const v = node[k];
            if (Array.isArray(v)) { for (const it of v) visit(it); }
            else if (v && typeof v === 'object' && typeof v.type === 'string') visit(v);
        }
    };
    visit(ast);

    // 2) Leading import group — fold a run of >=2 consecutive top-level imports.
    const body = Array.isArray(ast?.body) ? ast.body : [];
    for (let i = 0; i < body.length;) {
        if (body[i]?.type === 'ImportDeclaration') {
            let j = i;
            while (j + 1 < body.length && body[j + 1]?.type === 'ImportDeclaration') j++;
            if (j > i && typeof body[i].start === 'number' && typeof body[j].end === 'number') {
                add(lineAt(body[i].start), lineAt(body[j].end - 1), FoldingRangeKind.Imports);
            }
            i = j + 1;
        } else {
            i++;
        }
    }

    // 3) Comments. Block comments fold on their own; adjacent line comments group.
    let run: { startLine: number; endLine: number } | null = null;
    const flushRun = (): void => {
        if (run) add(run.startLine, run.endLine, FoldingRangeKind.Comment);
        run = null;
    };
    for (const c of comments) {
        if (typeof c?.pos !== 'number' || typeof c?.end !== 'number') continue;
        const startLine = lineAt(c.pos);
        const endLine = lineAt(Math.max(c.pos, c.end - 1));
        const isBlock = text.substr(c.pos, 2) === '/*';
        if (isBlock) {
            flushRun();
            add(startLine, endLine, FoldingRangeKind.Comment); // multi-line block comment
        } else if (run && startLine === run.endLine + 1) {
            run.endLine = endLine;                              // extend the current run
        } else {
            flushRun();
            run = { startLine, endLine };                       // start a new run
        }
    }
    flushRun();

    return ranges;
}
