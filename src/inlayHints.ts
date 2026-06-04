// Inlay hints (inline annotations) for ucode:
//   - variable type hints:  `let h = fs.open(…)` → `h: fs.file | null`
//   - parameter-name hints:  `substr(s, |start:| 1, |length:| 2)`
//
// Hints are computed once per analysis as OFFSET-anchored "raw" hints (see
// computeRawInlayHints), cached, and then served per request. Because analysis is
// debounced behind edits, a request can arrive while the cache is one or more
// keystrokes stale. Rather than blank the hints (which flickers) or render them at
// stale offsets (which overlaps the edited text), shiftRawHints() remaps the cached
// offsets through the text delta so the hints stay glued to the code until the next
// analysis produces exact positions. materializeRawHints() converts the (possibly
// shifted) offsets to LSP positions and filters to the requested range.

import { InlayHint, InlayHintKind } from 'vscode-languageserver/node';
import { typeToString } from './analysis/symbolTable';
import { resolveCalleeParameters } from './signatureHelp';

type PosAt = (offset: number) => { line: number; character: number };

/** An inlay hint anchored to a character offset rather than a line/col position,
 *  so it can be cheaply remapped through text edits before being materialized. */
export interface RawInlayHint {
    offset: number;
    label: string;
    kind: InlayHintKind;
    paddingLeft: boolean;
    paddingRight: boolean;
}

// An initializer is worth annotating UNLESS its literal form already makes the type
// self-evident: a literal (number/string/bool/null), template/array/object literal,
// or function expression. Everything else — calls (`fs.open(…)`), member access
// (`cfg.host`), identifier aliases (`let a = output`), and logical/binary exprs
// (`fs_mod || require('fs')`) — does not reveal its type at a glance, so we annotate
// it. The `unknown`-type guard at the call site still suppresses noise where no
// concrete type is known, so this only adds hints that carry real information.
function isNonObviousInit(init: any): boolean {
    if (!init || typeof init.type !== 'string') return false;
    switch (init.type) {
        case 'Literal':
        case 'TemplateLiteral':
        case 'ArrayExpression':
        case 'ObjectExpression':
        case 'FunctionExpression':
        case 'ArrowFunctionExpression':
            return false; // self-evident from the literal form
        default:
            return true;
    }
}

/** Walk the whole AST and produce offset-anchored hints for the entire document. */
export function computeRawInlayHints(
    ast: any,
    symbolTable: any,
    builtins: Map<string, string>,
): RawInlayHint[] {
    const hints: RawInlayHint[] = [];

    const visit = (node: any): void => {
        if (!node || typeof node !== 'object' || typeof node.type !== 'string') return;

        // 1) Variable type hint after the declared name.
        if (node.type === 'VariableDeclaration') {
            for (const d of (node.declarations || [])) {
                if (d?.id?.type !== 'Identifier' || !isNonObviousInit(d.init)) continue;
                const sym: any = symbolTable?.lookupAtPosition?.(d.id.name, d.id.start) ?? symbolTable?.lookup?.(d.id.name);
                if (sym?.dataType === undefined) continue;
                const ts = typeToString(sym.dataType);
                if (!ts || ts === 'unknown') continue;
                hints.push({ offset: d.id.end, label: `: ${ts}`, kind: InlayHintKind.Type, paddingLeft: false, paddingRight: false });
            }
        }

        // 2) Parameter-name hints at call arguments.
        if (node.type === 'CallExpression' && Array.isArray(node.arguments) && node.arguments.length) {
            const sig = resolveCalleeParameters(node.callee, symbolTable, builtins);
            if (sig && sig.params.length) {
                const lastIsRest = sig.params[sig.params.length - 1]!.isRest;
                for (let i = 0; i < node.arguments.length; i++) {
                    const arg = node.arguments[i];
                    if (!arg) continue;
                    // Map arg index → parameter (a trailing rest param absorbs extras).
                    const p = i < sig.params.length ? sig.params[i]
                        : (lastIsRest ? sig.params[sig.params.length - 1] : undefined);
                    if (!p || p.isRest) continue;
                    // Redundant when the argument is exactly that name (`foo(name)`).
                    if (arg.type === 'Identifier' && arg.name === p.name) continue;
                    hints.push({ offset: arg.start, label: `${p.name}:`, kind: InlayHintKind.Parameter, paddingLeft: false, paddingRight: true });
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

/** Remap raw-hint offsets from the text they were computed against (`oldText`) to
 *  the current buffer (`newText`), using a greedy common-prefix/suffix diff:
 *    - anchors before the changed region are kept as-is,
 *    - anchors after it shift by the length delta,
 *    - anchors inside the replaced region are dropped (ambiguous; the next
 *      analysis + inlayHint refresh restores them exactly).
 *  Handles the common single-edit case precisely; a multi-region edit collapses to
 *  one changed span (lossy but self-correcting within the debounce window). */
export function shiftRawHints(raw: RawInlayHint[], oldText: string, newText: string): RawInlayHint[] {
    if (oldText === newText) return raw;
    const oldLen = oldText.length;
    const newLen = newText.length;

    const maxScan = Math.min(oldLen, newLen);
    let prefix = 0;
    while (prefix < maxScan && oldText.charCodeAt(prefix) === newText.charCodeAt(prefix)) prefix++;

    let suffix = 0;
    const maxSuffix = maxScan - prefix;
    while (suffix < maxSuffix && oldText.charCodeAt(oldLen - 1 - suffix) === newText.charCodeAt(newLen - 1 - suffix)) suffix++;

    const delta = newLen - oldLen;
    const changedEndOld = oldLen - suffix; // exclusive end of the replaced region (old coords)

    const out: RawInlayHint[] = [];
    for (const h of raw) {
        if (h.offset < prefix) {
            out.push(h);                                 // before the edit
        } else if (h.offset >= changedEndOld) {
            out.push({ ...h, offset: h.offset + delta }); // after the edit
        }
        // else: inside the replaced span — drop until re-analysis
    }
    return out;
}

/** Filter raw hints to the requested range and convert offsets to LSP positions. */
export function materializeRawHints(
    raw: RawInlayHint[],
    startOffset: number,
    endOffset: number,
    posAt: PosAt,
): InlayHint[] {
    const out: InlayHint[] = [];
    for (const h of raw) {
        if (h.offset < startOffset || h.offset > endOffset) continue;
        out.push({
            position: posAt(h.offset),
            label: h.label,
            kind: h.kind,
            paddingLeft: h.paddingLeft,
            paddingRight: h.paddingRight,
        });
    }
    return out;
}
