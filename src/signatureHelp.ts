// Signature help (parameter hints) for ucode.
//
// When the cursor is inside a call's argument list, show the callee's signature
// with the active parameter highlighted. User functions use their structured
// parameter list; builtins parse the parameter names out of their markdown doc.

import {
    SignatureHelp, SignatureInformation, ParameterInformation, MarkupKind,
} from 'vscode-languageserver/node';
import { extractModuleType } from './analysis/symbolTable';
import { isKnownModule, isKnownObjectType, MODULE_REGISTRIES, OBJECT_REGISTRIES } from './analysis/moduleDispatch';
import { Option } from 'effect';

interface ParamInfo { name: string; type?: any; isRest?: boolean }

/** The innermost call whose argument region contains `offset`, plus that offset's
 *  active argument index. The arg region is `(callee.end, node.end]` — being past
 *  the callee but within the call node means we're in the parentheses. */
function findEnclosingCall(ast: any, offset: number): { call: any; activeParam: number } | null {
    let best: any = null;
    const visit = (node: any): void => {
        if (!node || typeof node !== 'object' || typeof node.type !== 'string') return;
        if (node.type === 'CallExpression' && node.callee
            && offset > node.callee.end && offset <= node.end) {
            // innermost wins (smallest span)
            if (!best || (node.end - node.start) < (best.end - best.start)) best = node;
        }
        for (const k of Object.keys(node)) {
            if (k === 'leadingJsDoc') continue;
            const v = node[k];
            if (Array.isArray(v)) { for (const it of v) visit(it); }
            else if (v && typeof v === 'object' && typeof v.type === 'string') visit(v);
        }
    };
    visit(ast);
    if (!best) return null;
    const args: any[] = best.arguments || [];
    // active index: first arg whose end is at/after the cursor; else past the last
    // (typing a fresh trailing argument).
    let activeParam = args.length;
    for (let i = 0; i < args.length; i++) {
        if (args[i] && offset <= args[i].end) { activeParam = i; break; }
    }
    return { call: best, activeParam };
}

/** Parameter names parsed from a builtin's markdown doc `**Parameters:**` block
 *  (bullets like `- \`name\` (type): desc`). Returns [] when absent. */
function builtinParamNames(doc: string): string[] {
    const m = /\*\*Parameters:\*\*\s*([\s\S]*?)(?:\n\s*\n|\*\*Returns|\*\*Note|\*\*Example|$)/.exec(doc);
    if (!m) return [];
    const names: string[] = [];
    const re = /^\s*[-*]\s*`([^`]+)`/gm;
    let bullet: RegExpExecArray | null;
    while ((bullet = re.exec(m[1]!)) !== null) names.push(bullet[1]!.trim());
    return names;
}

/** The first line of a builtin doc, for a compact signature-help description. */
function firstDocLine(doc: string): string {
    const line = doc.split('\n').find(l => l.trim().length > 0) ?? '';
    return line.replace(/\*\*/g, '').trim();
}

function buildSignature(name: string, paramLabels: string[], activeParam: number, doc?: string): SignatureHelp {
    const hasRest = paramLabels.length > 0 && /^\.\.\./.test(paramLabels[paramLabels.length - 1]!);
    const label = `${name}(${paramLabels.join(', ')})`;
    // Build ParameterInformation with [start,end) label offsets into `label` so the
    // editor highlights the exact span (more robust than string-matching).
    const params: ParameterInformation[] = [];
    let cursor = name.length + 1; // just past '('
    for (let i = 0; i < paramLabels.length; i++) {
        const p = paramLabels[i]!;
        params.push(ParameterInformation.create([cursor, cursor + p.length]));
        cursor += p.length + 2; // ', '
    }
    // Clamp the active param: a rest/vararg param absorbs all trailing arguments.
    let active = activeParam;
    if (active >= paramLabels.length) active = hasRest ? paramLabels.length - 1 : Math.max(0, paramLabels.length - 1);
    if (paramLabels.length === 0) active = 0;

    const sig: SignatureInformation = { label, parameters: params };
    if (doc) sig.documentation = { kind: MarkupKind.Markdown, value: doc };
    return { signatures: [sig], activeSignature: 0, activeParameter: active };
}

export interface CalleeParam { name: string; label: string; isRest: boolean }
export interface CalleeSignature { displayName: string; params: CalleeParam[]; documentation?: string }

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

export function resolveCalleeParameters(
    callee: any,
    symbolTable: any,
    builtins: Map<string, string>,
    resolveMemberParams?: MemberParamResolver,
): CalleeSignature | null {
    if (callee?.type === 'MemberExpression' && !callee.computed && callee.property?.type === 'Identifier'
        && callee.object?.type === 'Identifier') {
        const method: string = callee.property.name;
        const obj = callee.object;
        const objSym: any = symbolTable?.lookupAtPosition?.(obj.name, obj.start) ?? symbolTable?.lookup?.(obj.name);
        const mt = objSym?.dataType !== undefined ? extractModuleType(objSym.dataType) : null;
        if (!mt) {
            // Not a module/object-registry receiver. It may be a factory-returned
            // object (`let sh = create_sys(…); sh.exec(…)`) — resolve the method's
            // params from its recorded cross-file definition location.
            const loc = objSym?.propertyDefinitionLocations?.get?.(method);
            if (loc && resolveMemberParams) {
                const params = resolveMemberParams(loc.uri, loc.start);
                if (params) return { displayName: `${obj.name}.${method}`, params };
            }
            return null;
        }
        const tn = mt.moduleName;
        const sigOpt = isKnownObjectType(tn) ? OBJECT_REGISTRIES[tn].getMethod(method)
            : isKnownModule(tn) ? MODULE_REGISTRIES[tn].getFunction(method)
            : Option.none();
        if (Option.isNone(sigOpt)) return null;
        const sig = sigOpt.value;
        const res: CalleeSignature = {
            displayName: `${obj.name}.${method}`,
            params: sig.parameters.map(p => ({ name: p.name, label: p.optional ? `${p.name}?` : p.name, isRest: false })),
        };
        if (sig.description) res.documentation = sig.description;
        return res;
    }

    if (callee?.type !== 'Identifier') return null;
    const name: string = callee.name;

    // User function first (so a local function shadowing a builtin name wins).
    const sym: any = symbolTable?.lookupAtPosition?.(name, callee.start) ?? symbolTable?.lookup?.(name);
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

    const doc = builtins.get(name);
    if (doc !== undefined) {
        const res: CalleeSignature = {
            displayName: name,
            params: builtinParamNames(doc).map(n => ({ name: n.replace(/^\.\.\./, ''), label: n, isRest: n.startsWith('...') })),
        };
        const fl = firstDocLine(doc);
        if (fl) res.documentation = fl;
        return res;
    }
    return null;
}

/**
 * Signature help at `offset`. Resolves the callee's parameters (see
 * resolveCalleeParameters) and highlights the active argument.
 */
export function provideSignatureHelp(
    ast: any,
    symbolTable: any,
    builtins: Map<string, string>,
    offset: number,
    resolveMemberParams?: MemberParamResolver,
): SignatureHelp | null {
    const enclosing = findEnclosingCall(ast, offset);
    if (!enclosing) return null;
    const sig = resolveCalleeParameters(enclosing.call.callee, symbolTable, builtins, resolveMemberParams);
    if (!sig) return null;
    return buildSignature(sig.displayName, sig.params.map(p => p.label), enclosing.activeParam, sig.documentation);
}
