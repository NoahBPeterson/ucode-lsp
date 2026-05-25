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
 *
 * `isReference`, when given, is a scope-aware predicate: a name-matched candidate
 * is kept only if it resolves to the target binding (e.g. via the symbol table's
 * `lookupAtPosition`). Without it, this falls back to name matching — correct
 * for cross-file consumers where the imported binding is effectively unique, but
 * blind to shadowing within a single file.
 */
export function findFunctionReferences(
    ast: any,
    funcName: string,
    declId: any,
    isReference?: (node: any) => boolean,
): SourceSpan[] {
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
            // An import binding or export specifier — `import name from …`,
            // `export default name`, `export { name }`. These are not usages: an
            // import may even be unused, and an export just re-publishes the
            // binding. Only real usages should count as references.
            const isImportExport = parent
                && (parent.type.startsWith('Import') || parent.type.startsWith('Export'));

            if (!isMemberProp && !isObjectKey && !isParam && !isOtherDeclId && !isImportExport
                && (!isReference || isReference(node))) {
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

/**
 * Collect `ns.member` accesses where `ns` is a namespace-import binding — these
 * are references to the module's `member` export via the namespace
 * (`import * as ns from 'mod'; ns.fn()`). Returns the property identifier's span.
 */
export function findNamespaceMemberReferences(ast: any, namespaceLocal: string, memberName: string): SourceSpan[] {
    const refs: SourceSpan[] = [];
    const visit = (node: any): void => {
        if (!node || typeof node !== 'object' || typeof node.type !== 'string') return;
        if (node.type === 'MemberExpression' && !node.computed
            && node.object?.type === 'Identifier' && node.object.name === namespaceLocal
            && node.property?.type === 'Identifier' && node.property.name === memberName) {
            refs.push({ start: node.property.start, end: node.property.end });
        }
        for (const k of Object.keys(node)) {
            if (k === 'leadingJsDoc') continue;
            const v = node[k];
            if (Array.isArray(v)) { for (const it of v) visit(it); }
            else if (v && typeof v === 'object' && typeof v.type === 'string') visit(v);
        }
    };
    visit(ast);
    return refs;
}

/** "N references" / "1 reference" / "no references". */
export function formatReferencesTitle(count: number): string {
    if (count === 0) return 'no references';
    return count === 1 ? '1 reference' : `${count} references`;
}

/** The bindings a single import declaration introduces. */
export interface ImportBinding {
    source: string;                                   // module specifier text
    defaultLocal?: string;                            // import X from '…'
    namespaceLocal?: string;                          // import * as X from '…'
    named: { imported: string; local: string }[];     // import { a as b } from '…'
}

/** Top-level import declarations of a file, flattened to their bindings. */
export function getImportBindings(ast: any): ImportBinding[] {
    const out: ImportBinding[] = [];
    const body = ast?.body;
    if (!Array.isArray(body)) return out;
    for (const stmt of body) {
        if (!stmt || stmt.type !== 'ImportDeclaration') continue;
        const source = stmt.source && typeof stmt.source.value === 'string' ? stmt.source.value : null;
        if (!source) continue;
        const binding: ImportBinding = { source, named: [] };
        for (const spec of (stmt.specifiers || [])) {
            if (spec.type === 'ImportDefaultSpecifier' && spec.local?.name) {
                binding.defaultLocal = spec.local.name;
            } else if (spec.type === 'ImportNamespaceSpecifier' && spec.local?.name) {
                binding.namespaceLocal = spec.local.name;
            } else if (spec.type === 'ImportSpecifier' && spec.local?.name) {
                binding.named.push({ imported: spec.imported?.name ?? spec.local.name, local: spec.local.name });
            }
        }
        out.push(binding);
    }
    return out;
}
