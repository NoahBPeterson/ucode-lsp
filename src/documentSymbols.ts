// Document symbols (outline / breadcrumbs / Ctrl+Shift+O) for ucode.
//
// Pure AST walk: emits a DocumentSymbol tree of the file's functions and
// top-level/declared variables. Nested functions become children of their
// enclosing function. Function-valued variables (`let f = () => …`) and the
// methods of a factory's returned object literal are surfaced as callable.

import { DocumentSymbol, SymbolKind, Range } from 'vscode-languageserver/node';

type PosAt = (offset: number) => { line: number; character: number };

const FUNCTIONISH = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

function range(a: number, b: number, posAt: PosAt): Range {
    return { start: posAt(a), end: posAt(b) };
}

/** Symbols for the members of an object literal `{ a, b, method() {} }` —
 *  used for a factory's returned object so its API shows in the outline. */
function objectMembers(obj: any, posAt: PosAt): DocumentSymbol[] {
    const out: DocumentSymbol[] = [];
    for (const prop of (obj?.properties || [])) {
        const key = prop?.key;
        if (!key || (key.type !== 'Identifier' && key.type !== 'Literal')) continue;
        const name = key.type === 'Identifier' ? key.name : String(key.value);
        const valueIsFn = prop.value && FUNCTIONISH.has(prop.value.type);
        out.push({
            name,
            kind: valueIsFn ? SymbolKind.Method : SymbolKind.Property,
            range: range(prop.start, prop.end, posAt),
            selectionRange: range(key.start, key.end, posAt),
            children: valueIsFn ? symbolsInBody(prop.value.body, posAt) : [],
        });
    }
    return out;
}

/** A symbol for one declarator `name = init`, classified by its initializer. */
function declaratorSymbol(d: any, isConst: boolean, posAt: PosAt): DocumentSymbol | null {
    if (d?.id?.type !== 'Identifier') return null;
    const name = d.id.name;
    const init = d.init;
    let kind: SymbolKind = isConst ? SymbolKind.Constant : SymbolKind.Variable;
    let children: DocumentSymbol[] = [];
    if (init && FUNCTIONISH.has(init.type)) {
        kind = SymbolKind.Function;
        children = symbolsInBody(init.body, posAt);
    } else if (init?.type === 'ObjectExpression') {
        kind = SymbolKind.Object;
        children = objectMembers(init, posAt);
    } else if (init?.type === 'ArrayExpression') {
        kind = SymbolKind.Array;
    }
    return {
        name, kind,
        range: range(d.start, d.end, posAt),
        selectionRange: range(d.id.start, d.id.end, posAt),
        children,
    };
}

/** Symbols declared directly in a block/program body (one nesting level), with
 *  function bodies recursed into. */
function symbolsInBody(body: any, posAt: PosAt): DocumentSymbol[] {
    const stmts: any[] = body?.type === 'BlockStatement' ? body.body
        : body?.type === 'Program' ? body.body
        : Array.isArray(body) ? body : [];
    const out: DocumentSymbol[] = [];
    for (let stmt of stmts) {
        // Unwrap `export function …` / `export let …` / `export default …`.
        if (stmt?.type === 'ExportNamedDeclaration' && stmt.declaration) stmt = stmt.declaration;
        else if (stmt?.type === 'ExportDefaultDeclaration' && stmt.declaration) stmt = stmt.declaration;
        if (!stmt) continue;

        if (stmt.type === 'FunctionDeclaration' && stmt.id?.type === 'Identifier') {
            out.push({
                name: stmt.id.name,
                kind: SymbolKind.Function,
                range: range(stmt.start, stmt.end, posAt),
                selectionRange: range(stmt.id.start, stmt.id.end, posAt),
                children: symbolsInBody(stmt.body, posAt),
            });
        } else if (stmt.type === 'VariableDeclaration') {
            const isConst = stmt.kind === 'const';
            for (const d of (stmt.declarations || [])) {
                const sym = declaratorSymbol(d, isConst, posAt);
                if (sym) out.push(sym);
            }
        }
    }
    return out;
}

/** The DocumentSymbol tree for a parsed ucode file. */
export function buildDocumentSymbols(ast: any, posAt: PosAt): DocumentSymbol[] {
    if (!ast) return [];
    return symbolsInBody(ast, posAt);
}
