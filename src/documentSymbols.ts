// Document symbols (outline / breadcrumbs / Ctrl+Shift+O) for ucode.
//
// Pure AST walk: emits a DocumentSymbol tree of the file's functions and
// top-level/declared variables. Nested functions become children of their
// enclosing function. Function-valued variables (`let f = () => …`) and the
// methods of a factory's returned object literal are surfaced as callable.

import { DocumentSymbol, SymbolKind, Range } from 'vscode-languageserver/node';
import type {
    AstNode,
    IdentifierNode,
    ObjectExpressionNode,
    FunctionDeclarationNode,
    FunctionExpressionNode,
    ArrowFunctionExpressionNode,
    VariableDeclaratorNode,
} from './ast/nodes';

type PosAt = (offset: number) => { line: number; character: number };

/** A node that carries a function `body` (declaration/expression/arrow). */
type FunctionishNode = FunctionDeclarationNode | FunctionExpressionNode | ArrowFunctionExpressionNode;

/** Is `n` one of the three function-shaped node kinds? */
function isFunctionish(n: AstNode | null | undefined): n is FunctionishNode {
    return n?.type === 'FunctionDeclaration' || n?.type === 'FunctionExpression' || n?.type === 'ArrowFunctionExpression';
}

function range(a: number, b: number, posAt: PosAt): Range {
    return { start: posAt(a), end: posAt(b) };
}

/** Parameter symbols (incl. a `...rest`) of a function, for the outline (#47). */
function paramSymbols(fn: FunctionishNode, posAt: PosAt): DocumentSymbol[] {
    const out: DocumentSymbol[] = [];
    const push = (id: IdentifierNode | undefined, isRest: boolean): void => {
        if (id?.type !== 'Identifier') return;
        out.push({
            name: isRest ? `...${id.name}` : id.name,
            kind: SymbolKind.Variable,
            range: range(id.start, id.end, posAt),
            selectionRange: range(id.start, id.end, posAt),
            children: [],
        });
    };
    for (const p of (fn.params || [])) push(p, false);
    if (fn.restParam) push(fn.restParam, true);
    return out;
}

/** Members of an object literal returned by a top-level `return {…}` in a function
 *  body — surfaces a factory's inline-returned API in the outline (#47). */
function returnedObjectMembers(body: AstNode | null | undefined, posAt: PosAt): DocumentSymbol[] {
    if (!body || body.type !== 'BlockStatement') return [];
    const out: DocumentSymbol[] = [];
    for (const stmt of (body.body || [])) {
        if (stmt?.type === 'ReturnStatement') {
            const arg = stmt.argument;
            if (arg?.type === 'ObjectExpression') out.push(...objectMembers(arg, posAt));
        }
    }
    return out;
}

/** Full child-symbol set for a function: its parameters, the symbols declared in
 *  its body, and the members of any inline `return {…}` object (#47). */
function functionChildren(fn: FunctionishNode, posAt: PosAt): DocumentSymbol[] {
    const children = [
        ...paramSymbols(fn, posAt),
        ...symbolsInBody(fn.body, posAt),
        ...returnedObjectMembers(fn.body, posAt),
    ];
    // Arrow with a concise object body: `(q) => ({ … })` returns the object directly.
    if (fn.type === 'ArrowFunctionExpression' && fn.expression
        && fn.body?.type === 'ObjectExpression') {
        children.push(...objectMembers(fn.body, posAt));
    }
    return children;
}

/** Symbols for the members of an object literal `{ a, b, method() {} }` —
 *  used for a factory's returned object so its API shows in the outline. */
function objectMembers(obj: ObjectExpressionNode | null | undefined, posAt: PosAt): DocumentSymbol[] {
    const out: DocumentSymbol[] = [];
    for (const member of (obj?.properties || [])) {
        // Skip spread elements (`...rest`) — they have no key.
        if (member?.type !== 'Property') continue;
        const prop = member;
        const key = prop.key;
        if (!key || (key.type !== 'Identifier' && key.type !== 'Literal')) continue;
        const name = key.type === 'Identifier'
            ? key.name
            : String(key.value);
        const value = prop.value;
        const valueIsFn = isFunctionish(value);
        out.push({
            name,
            kind: valueIsFn ? SymbolKind.Method : SymbolKind.Property,
            range: range(prop.start, prop.end, posAt),
            selectionRange: range(key.start, key.end, posAt),
            children: isFunctionish(value) ? functionChildren(value, posAt) : [],
        });
    }
    return out;
}

/** A symbol for one declarator `name = init`, classified by its initializer. */
function declaratorSymbol(d: VariableDeclaratorNode, isConst: boolean, posAt: PosAt): DocumentSymbol | null {
    if (d?.id?.type !== 'Identifier') return null;
    const name = d.id.name;
    const init = d.init;
    let kind: SymbolKind = isConst ? SymbolKind.Constant : SymbolKind.Variable;
    let children: DocumentSymbol[] = [];
    if (isFunctionish(init)) {
        kind = SymbolKind.Function;
        children = functionChildren(init, posAt);
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
function symbolsInBody(body: AstNode | AstNode[] | null | undefined, posAt: PosAt): DocumentSymbol[] {
    const stmts: AstNode[] = (body && !Array.isArray(body) && (body.type === 'BlockStatement' || body.type === 'Program')) ? body.body
        : Array.isArray(body) ? body : [];
    const out: DocumentSymbol[] = [];
    for (let stmt of stmts) {
        // Unwrap `export function …` / `export let …` / `export default …`.
        if (stmt?.type === 'ExportNamedDeclaration' && stmt.declaration) stmt = stmt.declaration;
        else if (stmt?.type === 'ExportDefaultDeclaration' && stmt.declaration) stmt = stmt.declaration;
        if (!stmt) continue;

        if (stmt.type === 'FunctionDeclaration' && stmt.id?.type === 'Identifier') {
            const fn: FunctionDeclarationNode = stmt;
            out.push({
                name: fn.id.name,
                kind: SymbolKind.Function,
                range: range(fn.start, fn.end, posAt),
                selectionRange: range(fn.id.start, fn.id.end, posAt),
                children: functionChildren(fn, posAt),
            });
        } else if (stmt.type === 'VariableDeclaration') {
            const varDecl = stmt;
            const isConst = varDecl.kind === 'const';
            for (const d of (varDecl.declarations || [])) {
                const sym = declaratorSymbol(d, isConst, posAt);
                if (sym) out.push(sym);
            }
        }
    }
    return out;
}

/** The DocumentSymbol tree for a parsed ucode file. */
export function buildDocumentSymbols(ast: AstNode | null | undefined, posAt: PosAt): DocumentSymbol[] {
    if (!ast) return [];
    return symbolsInBody(ast, posAt);
}
