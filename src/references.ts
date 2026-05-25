// In-file reference finding for the "N references" CodeLens.
//
// Pure AST walk: given a function's name and its declaration id node, collect
// every identifier usage of that name in the file that is an actual reference —
// excluding the declaration itself and positions that are NOT references to the
// binding (member property names, object-literal keys, parameter names, and
// other function/declaration names of the same spelling).
//
// Scope-approximate: it matches by name across the file, so a local that
// shadows the function name could be over-counted. That's rare; cross-file
// references are out of scope for now (in-file only).

export interface SourceSpan {
    start: number; // character offset
    end: number;   // character offset (exclusive)
}

const FUNCTIONISH = new Set([
    'FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression',
]);

/**
 * Collect in-file references to `funcName`. `declId` is the function's own id
 * node, excluded from the results. Returns spans in source order.
 */
export function findFunctionReferences(ast: any, funcName: string, declId: any): SourceSpan[] {
    const refs: SourceSpan[] = [];

    const visit = (node: any, parent: any): void => {
        if (!node || typeof node !== 'object' || typeof node.type !== 'string') return;

        if (node.type === 'Identifier' && node.name === funcName && node !== declId) {
            // A member property name: `x.funcName` (dot access) — not a reference.
            const isMemberProp = parent?.type === 'MemberExpression'
                && parent.property === node && !parent.computed;
            // An object-literal key: `{ funcName: ... }` — not a reference.
            const isObjectKey = parent?.type === 'Property'
                && parent.key === node && !parent.computed;
            // A parameter name in any function — a different binding (shadow).
            const isParam = parent && FUNCTIONISH.has(parent.type)
                && Array.isArray(parent.params) && parent.params.includes(node);
            // Another function/declaration's own name of the same spelling.
            const isOtherDeclId = parent && FUNCTIONISH.has(parent.type) && parent.id === node;

            if (!isMemberProp && !isObjectKey && !isParam && !isOtherDeclId) {
                refs.push({ start: node.start, end: node.end });
            }
        }

        for (const k of Object.keys(node)) {
            if (k === 'leadingJsDoc') continue;
            const v = node[k];
            if (Array.isArray(v)) { for (const it of v) visit(it, node); }
            else if (v && typeof v === 'object' && typeof v.type === 'string') visit(v, node);
        }
    };

    visit(ast, null);
    return refs;
}

/** "N references" / "1 reference" / "no references". */
export function formatReferencesTitle(count: number): string {
    if (count === 0) return 'no references';
    return count === 1 ? '1 reference' : `${count} references`;
}
