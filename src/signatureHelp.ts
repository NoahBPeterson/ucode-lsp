// Signature help (parameter hints) for ucode.
//
// When the cursor is inside a call's argument list, show the callee's signature
// with the active parameter highlighted. User functions use their structured
// parameter list; builtins parse the parameter names out of their markdown doc.

import {
    type SignatureHelp, SignatureInformation, ParameterInformation, MarkupKind,
} from 'vscode-languageserver/node';
import { extractModuleType, SymbolType, type SymbolTable, type UcodeDataType } from './analysis/symbolTable';
import { isKnownModule, isKnownObjectType, MODULE_REGISTRIES, OBJECT_REGISTRIES } from './analysis/moduleDispatch';
import type {
    AstNode, CallExpressionNode, MemberExpressionNode, IdentifierNode, LiteralNode,
    ObjectExpressionNode, PropertyNode, FunctionExpressionNode, ArrowFunctionExpressionNode,
    VariableDeclaratorNode,
} from './ast/nodes';
import { Option } from 'effect';

interface ParamInfo { name: string; type?: UcodeDataType; isRest?: boolean }

/** The innermost call whose argument region contains `offset`, plus that offset's
 *  active argument index. The arg region is `(callee.end, node.end]` — being past
 *  the callee but within the call node means we're in the parentheses. */
function findEnclosingCall(ast: AstNode | null | undefined, offset: number): { call: CallExpressionNode; activeParam: number } | null {
    let best: CallExpressionNode | null = null;
    const visit = (node: AstNode | null | undefined): void => {
        if (!node || typeof node !== 'object' || typeof node.type !== 'string') return;
        if (node.type === 'CallExpression') {
            const call = node as CallExpressionNode;
            // An unterminated call (no closing `)`) has its `end` truncated to the
            // last token seen; its argument region really runs to EOF, so accept any
            // cursor past the callee for it (#85).
            const inArgRegion = call.callee
                && offset > call.callee.end
                && (offset <= call.end || call.unclosed === true);
            if (inArgRegion) {
                // innermost wins (smallest span)
                if (!best || (call.end - call.start) < (best.end - best.start)) best = call;
            }
        }
        for (const k of Object.keys(node)) {
            if (k === 'leadingJsDoc') continue;
            const v = (node as unknown as Record<string, unknown>)[k];
            if (Array.isArray(v)) { for (const it of v) visit(it as AstNode); }
            else if (v && typeof v === 'object' && typeof (v as AstNode).type === 'string') visit(v as AstNode);
        }
    };
    visit(ast);
    if (!best) return null;
    const args: AstNode[] = (best as CallExpressionNode).arguments || [];
    // active index: first arg whose end is at/after the cursor; else past the last
    // (typing a fresh trailing argument).
    let activeParam = args.length;
    for (let i = 0; i < args.length; i++) {
        const a = args[i]; if (a && offset <= a.end) { activeParam = i; break; }
    }
    return { call: best, activeParam };
}

/** Parameter names from ONE `**Parameters:**` block body (bullets like
 *  `- \`name\` (type): desc`). */
function paramNamesFromBlock(block: string): string[] {
    const names: string[] = [];
    const re = /^\s*[-*]\s*`([^`]+)`/gm;
    let bullet: RegExpExecArray | null;
    while ((bullet = re.exec(block)) !== null) names.push(bullet[1]!.trim());
    return names;
}

/** ALL `**Parameters:**` blocks in a builtin doc — one param-name set per overload
 *  (e.g. `render`'s template form and function form). One block → single-element array. */
function builtinParamNameSets(doc: string): string[][] {
    const re = /\*\*Parameters:\*\*\s*([\s\S]*?)(?:\n\s*\n|\*\*Returns|\*\*Note|\*\*Example|$)/g;
    const sets: string[][] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(doc)) !== null) sets.push(paramNamesFromBlock(m[1]!));
    return sets;
}

/** The first line of a builtin doc, for a compact signature-help description. */
function firstDocLine(doc: string): string {
    const line = doc.split('\n').find(l => l.trim().length > 0) ?? '';
    return line.replace(/\*\*/g, '').trim();
}

/**
 * A compact `name(p1, p2, ...)` signature for a builtin's completion `detail` (#102),
 * derived from the SAME doc source signature-help parses. Returns null when the doc
 * carries no parameter signal — so paramless/constant builtins (e.g. NL80211_* in the
 * builtin map) keep their generic detail rather than getting a misleading `name()`.
 *
 *  1. A leading `**name(...)**` line (the author's canonical form, may mark optionals
 *     with `?`) wins — it's the most precise.
 *  2. Else the first `**Parameters:**` block's names → `name(a, b, ...)`.
 */
export function compactBuiltinSignature(name: string, doc: string): string | null {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const lead = firstDocLine(doc).match(new RegExp(`^${esc}\\s*(\\([^)]*\\))`));
    if (lead) return `${name}${lead[1]}`;

    const sets = builtinParamNameSets(doc);
    if (sets.length === 0) return null;            // no Parameters block at all → no signal
    const params = sets.find(s => s.length > 0) ?? [];
    return `${name}(${params.join(', ')})`;
}

function hasRestParam(paramLabels: string[]): boolean {
    return paramLabels.length > 0 && /^\.\.\./.test(paramLabels[paramLabels.length - 1]!);
}

/** One SignatureInformation with [start,end) label offsets into `label` so the editor
 *  highlights the exact param span (more robust than string-matching). */
function makeSignatureInformation(name: string, paramLabels: string[], doc?: string): SignatureInformation {
    const label = `${name}(${paramLabels.join(', ')})`;
    const params: ParameterInformation[] = [];
    let cursor = name.length + 1; // just past '('
    for (const p of paramLabels) {
        params.push(ParameterInformation.create([cursor, cursor + p.length]));
        cursor += p.length + 2; // ', '
    }
    const sig: SignatureInformation = { label, parameters: params };
    if (doc) sig.documentation = { kind: MarkupKind.Markdown, value: doc };
    return sig;
}

/** Clamp the active param to a signature's param list (a rest param absorbs all trailing args). */
function clampActiveParam(paramLabels: string[], activeParam: number): number {
    if (paramLabels.length === 0) return 0;
    if (activeParam >= paramLabels.length) return hasRestParam(paramLabels) ? paramLabels.length - 1 : paramLabels.length - 1;
    return activeParam;
}

function buildSignature(name: string, paramLabels: string[], activeParam: number, doc?: string): SignatureHelp {
    const sig = makeSignatureInformation(name, paramLabels, doc);
    return { signatures: [sig], activeSignature: 0, activeParameter: clampActiveParam(paramLabels, activeParam) };
}

/** Pick which overload is active, given the call's first-argument AST node and the active
 *  parameter index. Heuristic (no type inference): a function-expression/arrow first arg →
 *  the variadic (rest) form; a string-literal first arg → a non-rest form; otherwise the
 *  form whose arity fits the current argument position (preferring a rest form once the
 *  fixed forms are exceeded). Falls back to the first overload. */
function selectActiveOverload(sets: string[][], arg0: AstNode | undefined, activeParam: number): number {
    const restIdx = sets.findIndex(hasRestParam);
    const nonRestIdx = sets.findIndex(s => !hasRestParam(s));
    if (arg0) {
        const t = arg0.type;
        if ((t === 'ArrowFunctionExpression' || t === 'FunctionExpression') && restIdx >= 0) return restIdx;
        if (t === 'Literal' && typeof (arg0 as LiteralNode).value === 'string' && nonRestIdx >= 0) return nonRestIdx;
    }
    if (restIdx >= 0 && nonRestIdx >= 0 && activeParam >= sets[nonRestIdx]!.length) return restIdx;
    return 0;
}

/** Build a multi-signature SignatureHelp (overloads), choosing the active one. */
function buildOverloadedSignature(name: string, paramSets: string[][], arg0: AstNode | undefined, activeParam: number, doc?: string): SignatureHelp {
    const activeSignature = selectActiveOverload(paramSets, arg0, activeParam);
    const signatures = paramSets.map(labels => makeSignatureInformation(name, labels, doc));
    return { signatures, activeSignature, activeParameter: clampActiveParam(paramSets[activeSignature]!, activeParam) };
}

export interface CalleeParam { name: string; label: string; isRest: boolean }
export interface CalleeSignature {
    displayName: string;
    params: CalleeParam[];
    documentation?: string;
    /** Multiple parameter sets, one per overload (e.g. render's template vs function form).
     *  `params` remains the primary set (used by inlay hints); signature help shows all. */
    overloadParams?: CalleeParam[][];
}

/**
 * Resolve a call's callee to its parameter list, for any supported callee kind:
 *   - `receiver.method(…)` on a known module namespace (fs.open) or object type
 *     (an fs.file handle's .read) → registry signature
 *   - a user function → its structured parameters (with types)
 *   - a global builtin → param names parsed from its markdown doc
 * `label` is the per-param display (with `?`/`...`/type); `name` is the bare name
 * (for inlay parameter-name hints). Shared by signature help + inlay hints.
 */
/** Resolve a factory-returned method's parameters from its cross-file definition
 *  location. Given (sourceUri, function-node start offset) it returns the method's
 *  param list. Supplied by the server (which can parse the source file). */
export type MemberParamResolver = (uri: string, fnStart: number) => CalleeParam[] | null;

/** Build a CalleeParam[] from an object-literal method's function/arrow value. */
function paramsFromFunctionNode(fn: FunctionExpressionNode | ArrowFunctionExpressionNode): CalleeParam[] {
    const params: CalleeParam[] = (fn.params || []).map(p => ({ name: p.name, label: p.name, isRest: false }));
    if (fn.restParam) params.push({ name: fn.restParam.name, label: '...' + fn.restParam.name, isRest: true });
    return params;
}

/** Find `method` in an object literal's properties when its value is a function. */
function objectLiteralMethodSignature(obj: ObjectExpressionNode, method: string, displayName: string): CalleeSignature | null {
    for (const prop of obj.properties || []) {
        if (prop.type !== 'Property') continue;
        const p = prop as PropertyNode;
        if (p.computed) continue;
        const keyName = p.key?.type === 'Identifier' ? (p.key as IdentifierNode).name
            : (p.key?.type === 'Literal' && typeof (p.key as LiteralNode).value === 'string') ? String((p.key as LiteralNode).value)
            : undefined;
        if (keyName !== method) continue;
        const v = p.value;
        if (v && (v.type === 'FunctionExpression' || v.type === 'ArrowFunctionExpression')) {
            return { displayName, params: paramsFromFunctionNode(v as FunctionExpressionNode | ArrowFunctionExpressionNode) };
        }
        return null;
    }
    return null;
}

/** Param list of a function-valued property `methodName` on a plain LOCAL object
 *  literal reachable from a receiver symbol's `initNode`
 *  (`let o = { m: function(a, b){} }` → `o.m(…)`). Works without an ast/offset pair,
 *  so callers that lack them (inlay hints) still resolve the method. */
export function localObjectLiteralMethodParams(initNode: AstNode | undefined, methodName: string): CalleeParam[] | null {
    if (!initNode || initNode.type !== 'ObjectExpression') return null;
    for (const p of (initNode as ObjectExpressionNode).properties || []) {
        if (!p || p.type !== 'Property' || (p as PropertyNode).computed) continue;
        const key = (p as PropertyNode).key;
        const keyName = key?.type === 'Identifier' ? (key as IdentifierNode).name
            : key?.type === 'Literal' && typeof (key as LiteralNode).value === 'string' ? (key as LiteralNode).value as string
            : null;
        if (keyName !== methodName) continue;
        const val = (p as PropertyNode).value;
        if (val?.type === 'FunctionExpression' || val?.type === 'ArrowFunctionExpression') {
            return paramsFromFunctionNode(val as FunctionExpressionNode | ArrowFunctionExpressionNode);
        }
        return null; // member exists but isn't a function
    }
    return null;
}

/** The object literal assigned to `let <name> = {…}` most recently before `offset`
 *  (#83, local object-literal method calls resolved straight from the AST). */
function findVarInitObjectLiteral(ast: AstNode | null | undefined, name: string, offset: number): ObjectExpressionNode | null {
    let best: ObjectExpressionNode | null = null;
    let bestStart = -1;
    const visit = (node: AstNode | null | undefined): void => {
        if (!node || typeof node !== 'object' || typeof node.type !== 'string') return;
        if (node.type === 'VariableDeclarator') {
            const d = node as VariableDeclaratorNode;
            if (d.id?.type === 'Identifier' && d.id.name === name
                && d.init?.type === 'ObjectExpression'
                && typeof d.id.start === 'number' && d.id.start <= offset && d.id.start > bestStart) {
                best = d.init as ObjectExpressionNode;
                bestStart = d.id.start;
            }
        }
        for (const k of Object.keys(node)) {
            if (k === 'leadingJsDoc') continue;
            const v = (node as unknown as Record<string, unknown>)[k];
            if (Array.isArray(v)) { for (const it of v) visit(it as AstNode); }
            else if (v && typeof v === 'object' && typeof (v as AstNode).type === 'string') visit(v as AstNode);
        }
    };
    visit(ast);
    return best;
}

/** The object literal whose method body most tightly contains `offset` — the
 *  receiver of a `this.…` call (#84). */
function findThisReceiverObject(ast: AstNode | null | undefined, offset: number): ObjectExpressionNode | null {
    let best: ObjectExpressionNode | null = null;
    let bestSpan = Infinity;
    const visit = (node: AstNode | null | undefined): void => {
        if (!node || typeof node !== 'object' || typeof node.type !== 'string') return;
        if (node.type === 'ObjectExpression') {
            const obj = node as ObjectExpressionNode;
            for (const prop of obj.properties || []) {
                if (prop.type !== 'Property') continue;
                const v = (prop as PropertyNode).value;
                if (v && (v.type === 'FunctionExpression' || v.type === 'ArrowFunctionExpression')
                    && typeof v.start === 'number' && typeof v.end === 'number'
                    && v.start <= offset && offset <= v.end) {
                    const span = v.end - v.start;
                    if (span < bestSpan) { bestSpan = span; best = obj; }
                }
            }
        }
        for (const k of Object.keys(node)) {
            if (k === 'leadingJsDoc') continue;
            const v = (node as unknown as Record<string, unknown>)[k];
            if (Array.isArray(v)) { for (const it of v) visit(it as AstNode); }
            else if (v && typeof v === 'object' && typeof (v as AstNode).type === 'string') visit(v as AstNode);
        }
    };
    visit(ast);
    return best;
}

export function resolveCalleeParameters(
    callee: AstNode | null | undefined,
    symbolTable: SymbolTable | undefined,
    builtins: Map<string, string>,
    resolveMemberParams?: MemberParamResolver,
    ast?: AstNode | null,
    offset?: number,
): CalleeSignature | null {
    // `this.method(…)` inside an object-literal method — resolve the sibling
    // property's function params straight from the AST (#84).
    if (callee?.type === 'MemberExpression'
        && !(callee as MemberExpressionNode).computed
        && (callee as MemberExpressionNode).property?.type === 'Identifier'
        && (callee as MemberExpressionNode).object?.type === 'ThisExpression'
        && ast && typeof offset === 'number') {
        const method = ((callee as MemberExpressionNode).property as IdentifierNode).name;
        const obj = findThisReceiverObject(ast, offset);
        if (obj) {
            const sig = objectLiteralMethodSignature(obj, method, `this.${method}`);
            if (sig) return sig;
        }
        return null;
    }
    if (callee?.type === 'MemberExpression'
        && !(callee as MemberExpressionNode).computed
        && (callee as MemberExpressionNode).property?.type === 'Identifier'
        && (callee as MemberExpressionNode).object?.type === 'Identifier') {
        const mem = callee as MemberExpressionNode;
        const method: string = (mem.property as IdentifierNode).name;
        const obj = mem.object as IdentifierNode;
        const objSym = symbolTable?.lookupAtPosition?.(obj.name, obj.start) ?? symbolTable?.lookup?.(obj.name);
        const mt = objSym?.dataType !== undefined ? extractModuleType(objSym.dataType) : null;
        // Factory-object / namespace-import / local-object fallback: resolve the method's
        // params from its recorded cross-file def location (#83 factory, #171 namespace
        // import) or, failing that, straight from a local object literal's AST (#83).
        const factoryFallback = (): CalleeSignature | null => {
            const loc = objSym?.propertyDefinitionLocations?.get?.(method);
            if (loc && resolveMemberParams) {
                const params = resolveMemberParams(loc.uri, loc.start);
                if (params) return { displayName: `${obj.name}.${method}`, params };
            }
            if (ast && typeof offset === 'number') {
                const objLit = findVarInitObjectLiteral(ast, obj.name, offset);
                if (objLit) {
                    const sig = objectLiteralMethodSignature(objLit, method, `${obj.name}.${method}`);
                    if (sig) return sig;
                }
            }
            // Plain local object literal without an ast/offset pair (inlay hints):
            // the method's params come straight from the recorded initializer node.
            const localParams = localObjectLiteralMethodParams(objSym?.initNode, method);
            if (localParams) return { displayName: `${obj.name}.${method}`, params: localParams };
            return null;
        };
        if (!mt) {
            return factoryFallback();
        }
        const tn = mt.moduleName;
        // `socket` names both a module and its handle object-type; a namespace-import receiver
        // (`import * as socket`) resolves as the MODULE, a handle variable as the object type.
        const nsLike = objSym?.importSpecifier === '*' || objSym?.type === SymbolType.MODULE;
        const sigOpt = (nsLike && isKnownModule(tn)) ? MODULE_REGISTRIES[tn].getFunction(method)
            : isKnownObjectType(tn) ? OBJECT_REGISTRIES[tn].getMethod(method)
            : isKnownModule(tn) ? MODULE_REGISTRIES[tn].getFunction(method)
            : Option.none();
        // A receiver typed as a ModuleType whose module isn't a known builtin (e.g. a
        // namespace import of a USER file) — fall through to the factory/def-location
        // resolver rather than giving up. (#171)
        if (Option.isNone(sigOpt)) return factoryFallback();
        const sig = sigOpt.value;
        const res: CalleeSignature = {
            displayName: `${obj.name}.${method}`,
            params: sig.parameters.map(p => ({ name: p.name, label: p.isRest ? `...${p.name}` : (p.optional ? `${p.name}?` : p.name), isRest: !!p.isRest })),
        };
        if (sig.description) res.documentation = sig.description;
        return res;
    }

    if (callee?.type !== 'Identifier') return null;
    const name: string = (callee as IdentifierNode).name;

    // User function first (so a local function shadowing a builtin name wins).
    const sym = symbolTable?.lookupAtPosition?.(name, callee.start) ?? symbolTable?.lookup?.(name);
    const userParams: ParamInfo[] | undefined = sym?.parameters;
    if (Array.isArray(userParams)) {
        return {
            displayName: name,
            params: userParams.map(p => {
                const ty = p.type && typeof p.type === 'string' && p.type !== 'unknown' ? `: ${p.type}` : '';
                return { name: p.name, label: (p.isRest ? '...' : '') + p.name + ty, isRest: !!p.isRest };
            }),
        };
    }

    // Named-import module function: `import { pair } from 'socket'; pair(…)`. The symbol is
    // neither a user function nor a global builtin, so resolve its params via the module
    // registry (the same signatures `socket.pair(…)` uses).
    if (sym?.importedFrom && isKnownModule(sym.importedFrom)) {
        const specName = sym.importSpecifier ?? name;
        const sigOpt = MODULE_REGISTRIES[sym.importedFrom].getFunction(specName);
        if (Option.isSome(sigOpt)) {
            const sig = sigOpt.value;
            const res: CalleeSignature = {
                displayName: name,
                params: sig.parameters.map(p => ({ name: p.name, label: p.isRest ? `...${p.name}` : (p.optional ? `${p.name}?` : p.name), isRest: !!p.isRest })),
            };
            if (sig.description) res.documentation = sig.description;
            return res;
        }
    }

    const doc = builtins.get(name);
    if (doc !== undefined) {
        const toParams = (ns: string[]): CalleeParam[] =>
            ns.map(n => ({ name: n.replace(/^\.\.\./, ''), label: n, isRest: n.startsWith('...') }));
        const sets = builtinParamNameSets(doc);
        const res: CalleeSignature = {
            displayName: name,
            params: toParams(sets[0] ?? []),
        };
        // Multiple `**Parameters:**` blocks → overloads (e.g. render's two forms).
        if (sets.length > 1) res.overloadParams = sets.map(toParams);
        const fl = firstDocLine(doc);
        if (fl) res.documentation = fl;
        return res;
    }
    return null;
}

/** Parameter TYPES for a member call `recv.method(...)` where `recv` resolves to a
 *  module namespace (`import * as struct`) or a known object-handle type
 *  (`struct.instance`, `fs.file`, …). Returns null otherwise. Unlike
 *  resolveCalleeParameters (which keeps only display labels for signature help),
 *  this surfaces each parameter's declared type so usage inference can constrain an
 *  argument — e.g. `inst.unpack(mac)` ⟹ `mac` is `string`. The receiver's type may
 *  be nullable (`struct.instance | null`); extractModuleType handles the union. */
export function resolveMemberCallParameterTypes(
    callee: AstNode | null | undefined, symbolTable: SymbolTable | undefined
): Array<{ name: string; type: string; optional: boolean }> | null {
    if (!(callee?.type === 'MemberExpression' && !(callee as MemberExpressionNode).computed
        && (callee as MemberExpressionNode).property?.type === 'Identifier'
        && (callee as MemberExpressionNode).object?.type === 'Identifier')) return null;
    const mem = callee as MemberExpressionNode;
    const method: string = (mem.property as IdentifierNode).name;
    const obj = mem.object as IdentifierNode;
    const objSym = symbolTable?.lookupAtPosition?.(obj.name, obj.start) ?? symbolTable?.lookup?.(obj.name);
    const mt = objSym?.dataType !== undefined ? extractModuleType(objSym.dataType) : null;
    if (!mt) return null;
    const tn = mt.moduleName;
    const sigOpt = isKnownObjectType(tn) ? OBJECT_REGISTRIES[tn].getMethod(method)
        : isKnownModule(tn) ? MODULE_REGISTRIES[tn].getFunction(method)
        : Option.none();
    if (Option.isNone(sigOpt)) return null;
    return sigOpt.value.parameters.map(p => ({ name: p.name, type: p.type, optional: !!p.optional }));
}

/**
 * Signature help at `offset`. Resolves the callee's parameters (see
 * resolveCalleeParameters) and highlights the active argument.
 */
export function provideSignatureHelp(
    ast: AstNode | null | undefined,
    symbolTable: SymbolTable | undefined,
    builtins: Map<string, string>,
    offset: number,
    resolveMemberParams?: MemberParamResolver,
): SignatureHelp | null {
    const enclosing = findEnclosingCall(ast, offset);
    if (!enclosing) return null;
    const sig = resolveCalleeParameters(enclosing.call.callee, symbolTable, builtins, resolveMemberParams, ast, offset);
    if (!sig) return null;
    if (sig.overloadParams && sig.overloadParams.length > 1) {
        const arg0 = enclosing.call.arguments?.[0];
        const sets = sig.overloadParams.map(ps => ps.map(p => p.label));
        return buildOverloadedSignature(sig.displayName, sets, arg0, enclosing.activeParam, sig.documentation);
    }
    return buildSignature(sig.displayName, sig.params.map(p => p.label), enclosing.activeParam, sig.documentation);
}
