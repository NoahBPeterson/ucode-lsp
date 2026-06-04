// Inlay hints (inline annotations) for ucode:
//   - variable type hints:  `let h = fs.open(…)` → `h: fs.file | null`
//   - parameter-name hints:  `substr(s, |start:| 1, |length:| 2)`
//
// Only emits hints whose anchor falls within the requested range.

import { InlayHint, InlayHintKind } from 'vscode-languageserver/node';
import { typeToString } from './analysis/symbolTable';
import { resolveCalleeParameters } from './signatureHelp';

type PosAt = (offset: number) => { line: number; character: number };

// An initializer whose type is NON-obvious (worth annotating). Literals, arrays,
// objects, and function expressions make the type self-evident, so we skip them
// to avoid noise — a call or member access (`fs.open(…)`, `cfg.host`) does not.
function isNonObviousInit(init: any): boolean {
    return init && (init.type === 'CallExpression' || init.type === 'MemberExpression');
}

export function provideInlayHints(
    ast: any,
    symbolTable: any,
    builtins: Map<string, string>,
    startOffset: number,
    endOffset: number,
    posAt: PosAt,
): InlayHint[] {
    const hints: InlayHint[] = [];
    const inRange = (off: number) => off >= startOffset && off <= endOffset;

    const visit = (node: any): void => {
        if (!node || typeof node !== 'object' || typeof node.type !== 'string') return;

        // 1) Variable type hint after the declared name.
        if (node.type === 'VariableDeclaration') {
            for (const d of (node.declarations || [])) {
                if (d?.id?.type !== 'Identifier' || !isNonObviousInit(d.init) || !inRange(d.id.end)) continue;
                const sym: any = symbolTable?.lookupAtPosition?.(d.id.name, d.id.start) ?? symbolTable?.lookup?.(d.id.name);
                if (sym?.dataType === undefined) continue;
                const ts = typeToString(sym.dataType);
                if (!ts || ts === 'unknown') continue;
                hints.push({ position: posAt(d.id.end), label: `: ${ts}`, kind: InlayHintKind.Type, paddingLeft: false, paddingRight: false });
            }
        }

        // 2) Parameter-name hints at call arguments.
        if (node.type === 'CallExpression' && Array.isArray(node.arguments) && node.arguments.length) {
            const sig = resolveCalleeParameters(node.callee, symbolTable, builtins);
            if (sig && sig.params.length) {
                const lastIsRest = sig.params[sig.params.length - 1]!.isRest;
                for (let i = 0; i < node.arguments.length; i++) {
                    const arg = node.arguments[i];
                    if (!arg || !inRange(arg.start)) continue;
                    // Map arg index → parameter (a trailing rest param absorbs extras).
                    const p = i < sig.params.length ? sig.params[i]
                        : (lastIsRest ? sig.params[sig.params.length - 1] : undefined);
                    if (!p || p.isRest) continue;
                    // Redundant when the argument is exactly that name (`foo(name)`).
                    if (arg.type === 'Identifier' && arg.name === p.name) continue;
                    hints.push({ position: posAt(arg.start), label: `${p.name}:`, kind: InlayHintKind.Parameter, paddingLeft: false, paddingRight: true });
                }
            }
        }

        for (const k of Object.keys(node)) {
            if (k === 'leadingJsDoc') continue;
            const v = node[k];
            if (Array.isArray(v)) { for (const it of v) visit(it); }
            else if (v && typeof v === 'object' && typeof v.type === 'string') visit(v);
        }
    };
    visit(ast);
    return hints;
}
