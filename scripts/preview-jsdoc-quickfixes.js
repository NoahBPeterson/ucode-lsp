#!/usr/bin/env bun
// Dry-run the JSDoc-inference quick fix against a ucode file.
//
// For each unannotated function, shows:
//   - the line/column where you'd trigger the lightbulb
//   - the full JSDoc block the quick fix would insert
//   - which params got inferred types vs stayed `{unknown}`
//
// Optionally writes a patched copy so you can diff the full result.
//
// Usage:
//   bun scripts/preview-jsdoc-quickfixes.js <input.uc> [--write <output.uc>]
//
// The ordering here matches file order (top-to-bottom), which is also the
// order you'd naturally walk the diagnostics in VS Code's Problems panel.

import fs from 'fs';
import path from 'path';
import { UcodeLexer } from '../src/lexer/ucodeLexer.ts';
import { UcodeParser } from '../src/parser/ucodeParser.ts';
import { SemanticAnalyzer } from '../src/analysis/semanticAnalyzer.ts';

const args = process.argv.slice(2);
if (args.length < 1) {
    console.error('Usage: bun scripts/preview-jsdoc-quickfixes.js <input.uc> [--write <output.uc>]');
    process.exit(2);
}
const inputPath = args[0];
const writeIdx = args.indexOf('--write');
const outputPath = writeIdx >= 0 ? args[writeIdx + 1] : null;

// Mirror the BUILTIN_ARG_CONSTRAINTS registry from src/server.ts. Keep in sync.
const BUILTIN_ARG_CONSTRAINTS = {
    substr: [['string'], ['integer'], ['integer']],
    lc: [['string']], uc: [['string']],
    trim: [['string'], ['string']], ltrim: [['string'], ['string']], rtrim: [['string'], ['string']],
    ord: [['string']], chr: [['integer']], uchr: [['integer']],
    match: [['string'], ['regex', 'string']],
    replace: [['string'], ['regex', 'string'], ['string', 'function']],
    split: [['string'], ['regex', 'string'], ['integer']],
    join: [['string'], ['array']],
    index: [['string', 'array'], null], rindex: [['string', 'array'], null],
    length: [['string', 'array', 'object']],
    keys: [['object']], values: [['object']],
    push: [['array']], pop: [['array']], shift: [['array']], unshift: [['array']],
    uniq: [['array']], slice: [['array'], ['integer'], ['integer']], splice: [['array'], ['integer']],
    sort: [['array'], ['function']], reverse: [['array', 'string']],
    filter: [['array'], ['function']], map: [['array'], ['function']],
    b64enc: [['string']], b64dec: [['string']], hexenc: [['string']], hexdec: [['string']], hex: [['string']],
    exists: [['object'], ['string']],
    regexp: [['string'], ['string']],
    iptoarr: [['string']], arrtoip: [['array']],
    timelocal: [['object']], timegm: [['object']],
    loadstring: [['string']], loadfile: [['string']], wildcard: [['string'], ['string']],
    proto: [['object']], sprintf: [['string']], printf: [['string']], render: [['string']],
    getenv: [['string']], sleep: [['integer']], localtime: [['integer']], gmtime: [['integer']],
};

function analyze(code, filePath) {
    const lexer = new UcodeLexer(code, { rawMode: true });
    const tokens = lexer.tokenize();
    const parser = new UcodeParser(tokens, code);
    parser.setComments(lexer.comments);
    parser.setSourceText(code);
    const pr = parser.parse();
    const doc = {
        getText: () => code,
        positionAt: (o) => { let l = 0, c = 0; for (let i = 0; i < o && i < code.length; i++) { if (code[i] === '\n') { l++; c = 0; } else { c++; } } return { line: l, character: c }; },
        offsetAt: (p) => { const lines = code.split('\n'); let o = 0; for (let i = 0; i < p.line && i < lines.length; i++) { o += lines[i].length + 1; } return o + p.character; },
        uri: `file://${filePath}`, languageId: 'ucode', version: 1,
    };
    const analyzer = new SemanticAnalyzer(doc, {
        enableScopeAnalysis: true, enableTypeChecking: true, enableControlFlowAnalysis: true,
    });
    const result = analyzer.analyze(pr.ast);
    return { ast: pr.ast, result };
}

const splitTypeUnion = (t) => t.split(' | ').map(s => s.trim()).filter(Boolean);

function inferParamTypesFromUsage(funcNode, diagnostics, callerInferences, funcsByName) {
    const paramNames = new Set(funcNode.params.map(p => p.name));
    const bodyStart = funcNode.body?.start ?? funcNode.start;
    const bodyEnd = funcNode.body?.end ?? funcNode.end;
    const cp = new Map();
    const addC = (name, allowed) => {
        if (!allowed || allowed.length === 0) return;
        let l = cp.get(name); if (!l) { l = []; cp.set(name, l); }
        l.push(new Set(allowed));
    };
    // Source 1: diagnostics.
    for (const d of diagnostics) {
        if (d.code !== 'incompatible-function-argument' && d.code !== 'nullable-argument') continue;
        const data = d.data;
        if (!data || typeof data.variableName !== 'string') continue;
        if (!paramNames.has(data.variableName)) continue;
        if (typeof data.argumentOffset === 'number' && (data.argumentOffset < bodyStart || data.argumentOffset > bodyEnd)) continue;
        const exp = Array.isArray(data.expectedTypes) ? data.expectedTypes
            : (typeof data.expectedType === 'string' ? splitTypeUnion(data.expectedType) : []);
        addC(data.variableName, exp);
    }
    // Sources 2, 3, 4: AST walk. (Sources 5/6 — string concat, arithmetic —
    // were dropped: ucode auto-coerces every type, so neither proves anything.)
    const walk = (n) => {
        if (!n || typeof n !== 'object' || typeof n.type !== 'string') return;
        if (n.type === 'CallExpression' && n.callee?.type === 'Identifier') {
            const fname = n.callee.name;
            const cs = BUILTIN_ARG_CONSTRAINTS[fname];
            if (cs && Array.isArray(n.arguments)) {
                for (let i = 0; i < n.arguments.length && i < cs.length; i++) {
                    const arg = n.arguments[i]; const al = cs[i];
                    if (!arg || !al) continue;
                    if (arg.type === 'Identifier' && paramNames.has(arg.name)) addC(arg.name, al);
                }
            }
            if (callerInferences && funcsByName && Array.isArray(n.arguments)) {
                const calleeFn = funcsByName.get(fname);
                if (calleeFn) {
                    const calleeInf = callerInferences.get(calleeFn);
                    if (calleeInf) {
                        for (let i = 0; i < n.arguments.length; i++) {
                            const arg = n.arguments[i];
                            if (!arg || arg.type !== 'Identifier' || !paramNames.has(arg.name)) continue;
                            const calleeParamName = calleeFn.params[i]?.name;
                            if (!calleeParamName) continue;
                            const t = calleeInf.get(calleeParamName);
                            if (!t || t === 'unknown') continue;
                            addC(arg.name, splitTypeUnion(t));
                        }
                    }
                }
            }
        }
        // Member access proves `array | object` (runtime errors on string/int/
        // boolean/null for both `.x` and `[k]`).
        if (n.type === 'MemberExpression' && n.object?.type === 'Identifier' && paramNames.has(n.object.name)) {
            addC(n.object.name, ['array', 'object']);
        }
        for (const k of Object.keys(n)) {
            if (k === 'leadingJsDoc' || k === '_fullType' || k === '_specCache') continue;
            const v = n[k];
            if (Array.isArray(v)) { for (const it of v) walk(it); }
            else if (v && typeof v === 'object' && typeof v.type === 'string') walk(v);
        }
    };
    walk(funcNode.body);

    const out = new Map();
    for (const name of paramNames) {
        const lists = cp.get(name);
        if (!lists || lists.length === 0) { out.set(name, 'unknown'); continue; }
        let intr = new Set(lists[0]);
        for (let i = 1; i < lists.length; i++) intr = new Set([...intr].filter(t => lists[i].has(t)));
        if (intr.size === 0) out.set(name, 'unknown');
        else if (intr.size === 1) out.set(name, [...intr][0]);
        else out.set(name, [...intr].sort().join(' | '));
    }
    return out;
}

function inferAllParamTypesFromUsage(ast, diagnostics) {
    const funcs = collectUnannotatedFunctions(ast);
    const result = new Map();
    const funcsByName = new Map();
    for (const fn of funcs) {
        if (fn.type === 'FunctionDeclaration' && fn.id?.name) funcsByName.set(fn.id.name, fn);
    }
    for (const fn of funcs) {
        const init = new Map();
        for (const p of fn.params) init.set(p.name, 'unknown');
        result.set(fn, init);
    }
    for (let iter = 0; iter < 10; iter++) {
        let changed = false;
        for (const fn of funcs) {
            const next = inferParamTypesFromUsage(fn, diagnostics, result, funcsByName);
            const cur = result.get(fn);
            for (const [k, v] of next) {
                if (cur.get(k) !== v) { cur.set(k, v); changed = true; }
            }
        }
        if (!changed) { return { result, iterations: iter + 1 }; }
    }
    return { result, iterations: 10 };
}

// Collect every unannotated function, depth-first, in file (top-to-bottom) order.
function collectUnannotatedFunctions(ast) {
    const out = [];
    const walk = (n) => {
        if (!n || typeof n !== 'object' || typeof n.type !== 'string') return;
        if ((n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression')
            && n.params && n.params.length > 0 && !n.leadingJsDoc) {
            out.push(n);
        }
        for (const k of Object.keys(n)) {
            if (k === 'leadingJsDoc') continue;
            const v = n[k];
            if (Array.isArray(v)) { for (const it of v) walk(it); }
            else if (v && typeof v === 'object' && typeof v.type === 'string') walk(v);
        }
    };
    walk(ast);
    // Stable tree order for consistent numbering; don't re-sort by start.
    return out;
}

function funcDisplayName(fn) {
    if (fn.type === 'FunctionDeclaration') return fn.id?.name ?? '(unnamed)';
    if (fn.type === 'FunctionExpression' && fn.id?.name) return fn.id.name;
    return '(anonymous)';
}

function lineColOf(offset, code) {
    let line = 1, col = 0;
    for (let i = 0; i < offset && i < code.length; i++) {
        if (code[i] === '\n') { line++; col = 0; } else { col++; }
    }
    return { line, col };
}

// ---------------------------------------------------------------------------

const absInput = path.resolve(inputPath);
const original = fs.readFileSync(absInput, 'utf8');
const { ast, result: initial } = analyze(original, absInput);

const unannotated = collectUnannotatedFunctions(ast);
const bySeverity = (diags) => ({
    err: diags.filter(d => d.severity === 1).length,
    warn: diags.filter(d => d.severity === 2).length,
    info: diags.filter(d => d.severity === 3).length,
    hint: diags.filter(d => d.severity === 4).length,
    total: diags.length,
});

console.log(`──────────────────────────────────────────────────────────`);
console.log(`Input: ${absInput}`);
console.log(`Unannotated functions: ${unannotated.length}`);
const d0 = bySeverity(initial.diagnostics);
console.log(`Diagnostics BEFORE: ${d0.total}  (err ${d0.err}, warn ${d0.warn}, info ${d0.info}, hint ${d0.hint})`);
console.log(`──────────────────────────────────────────────────────────\n`);

// Run the cross-function fixpoint once and read each function's inferences from it.
const { result: allInferred, iterations } = inferAllParamTypesFromUsage(ast, initial.diagnostics);
console.log(`Fixpoint converged in ${iterations} iteration${iterations === 1 ? '' : 's'}.\n`);

// Build the patch plan. Each entry carries (insertOffset, text, metadata).
const edits = [];
let inferredCount = 0;
let unknownCount = 0;
for (let i = 0; i < unannotated.length; i++) {
    const fn = unannotated[i];
    const inferred = allInferred.get(fn) || inferParamTypesFromUsage(fn, initial.diagnostics);
    const { line, col } = lineColOf(fn.start, original);
    // Indent = whatever precedes the function start on its own line.
    const lineStart = fn.start - col;
    const indent = original.slice(lineStart, fn.start);
    const name = funcDisplayName(fn);
    const paramLines = fn.params.map(p => `${indent} * @param {${inferred.get(p.name)}} ${p.name}`);
    const inferredForThis = fn.params.filter(p => inferred.get(p.name) !== 'unknown').length;
    inferredCount += inferredForThis;
    unknownCount += (fn.params.length - inferredForThis);

    const block = [`${indent}/**`, ...paramLines, `${indent} */`, ''].join('\n');
    edits.push({
        offset: lineStart,
        text: block,
        line,
        col,
        name,
        params: fn.params.map(p => ({ name: p.name, type: inferred.get(p.name) })),
        inferredForThis,
    });

    const paramSummary = edits[i].params
        .map(p => `${p.name}: ${p.type === 'unknown' ? '?' : p.type}`)
        .join(', ');
    const tag = inferredForThis > 0 ? `[${inferredForThis}/${fn.params.length} inferred]` : `[stub only]`;
    console.log(`Step ${String(i + 1).padStart(2)}/${unannotated.length}  L${line}  ${name}(${paramSummary})  ${tag}`);
}

console.log(`\n──────────────────────────────────────────────────────────`);
console.log(`Summary: ${inferredCount} params auto-typed, ${unknownCount} stubbed {unknown}`);
console.log(`──────────────────────────────────────────────────────────`);

// Apply edits in REVERSE offset order so earlier insertions don't shift later ones.
const sorted = edits.slice().sort((a, b) => b.offset - a.offset);
let patched = original;
for (const e of sorted) {
    patched = patched.slice(0, e.offset) + e.text + patched.slice(e.offset);
}

// Re-analyze to show the delta.
const { result: after } = analyze(patched, absInput);
const d1 = bySeverity(after.diagnostics);
console.log(`\nDiagnostics AFTER applying all patches:`);
console.log(`  ${d1.total}  (err ${d1.err}, warn ${d1.warn}, info ${d1.info}, hint ${d1.hint})`);
console.log(`  delta: total ${d0.total - d1.total}, err ${d0.err - d1.err}, warn ${d0.warn - d1.warn}, info ${d0.info - d1.info}`);

if (outputPath) {
    const absOut = path.resolve(outputPath);
    fs.writeFileSync(absOut, patched);
    console.log(`\nPatched file written to: ${absOut}`);
    console.log(`Diff:  diff -u ${absInput} ${absOut}`);
} else {
    console.log(`\nTip: rerun with '--write <path>' to save the patched file for diffing.`);
}
