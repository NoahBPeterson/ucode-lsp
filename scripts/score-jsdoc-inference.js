#!/usr/bin/env bun
// Run the JSDoc-inference pass against a set of .uc files, print a summary
// table of how many params each file would auto-type vs stub.
//
// Usage:
//   bun scripts/score-jsdoc-inference.js path/to/file1.uc path/to/file2.uc ...
//   bun scripts/score-jsdoc-inference.js $(find pbr mwan4 -name '*.uc')

import fs from 'fs';
import path from 'path';
import { UcodeLexer } from '../src/lexer/ucodeLexer.ts';
import { UcodeParser } from '../src/parser/ucodeParser.ts';
import { SemanticAnalyzer } from '../src/analysis/semanticAnalyzer.ts';

const BUILTIN_ARG_CONSTRAINTS = {
    substr: [['string'],['integer'],['integer']], lc: [['string']], uc: [['string']],
    trim: [['string'],['string']], ltrim: [['string'],['string']], rtrim: [['string'],['string']],
    ord: [['string']], chr: [['integer']], uchr: [['integer']],
    match: [['string'],['regex','string']],
    replace: [['string'],['regex','string'],['string','function']],
    split: [['string'],['regex','string'],['integer']],
    join: [['string'],['array']],
    index: [['string','array'], null], rindex: [['string','array'], null],
    length: [['string','array','object']],
    keys: [['object']], values: [['object']],
    push: [['array']], pop: [['array']], shift: [['array']], unshift: [['array']],
    uniq: [['array']], slice: [['array'],['integer'],['integer']], splice: [['array'],['integer']],
    sort: [['array'],['function']], reverse: [['array','string']],
    filter: [['array'],['function']], map: [['array'],['function']],
    b64enc: [['string']], b64dec: [['string']], hexenc: [['string']], hexdec: [['string']], hex: [['string']],
    exists: [['object'],['string']],
    regexp: [['string'],['string']],
    iptoarr: [['string']], arrtoip: [['array']],
    timelocal: [['object']], timegm: [['object']],
    loadstring: [['string']], loadfile: [['string']], wildcard: [['string'],['string']],
    proto: [['object']], sprintf: [['string']], printf: [['string']], render: [['string']],
    getenv: [['string']], sleep: [['integer']], localtime: [['integer']], gmtime: [['integer']],
};

const splitTypeUnion = (t) => t.split(' | ').map(s => s.trim()).filter(Boolean);

function analyze(code, filePath) {
    const lexer = new UcodeLexer(code, { rawMode: true });
    const tokens = lexer.tokenize();
    const parser = new UcodeParser(tokens, code);
    parser.setComments(lexer.comments);
    parser.setSourceText(code);
    const pr = parser.parse();
    const doc = {
        getText: () => code,
        positionAt: (o) => { let l=0,c=0; for(let i=0;i<o&&i<code.length;i++){if(code[i]==='\n'){l++;c=0;}else{c++;}} return {line:l,character:c}; },
        offsetAt: (p) => { const lines=code.split('\n'); let o=0; for(let i=0;i<p.line&&i<lines.length;i++){o+=lines[i].length+1;} return o+p.character; },
        uri: `file://${filePath}`, languageId: 'ucode', version: 1,
    };
    const analyzer = new SemanticAnalyzer(doc, {
        enableScopeAnalysis: true, enableTypeChecking: true, enableControlFlowAnalysis: true,
    });
    return { ast: pr.ast, result: analyzer.analyze(pr.ast) };
}

function collectUnannotatedFunctions(ast) {
    const out = [];
    const walk = (n) => {
        if (!n || typeof n !== 'object' || typeof n.type !== 'string') return;
        if ((n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression')
            && n.params && n.params.length > 0 && !n.leadingJsDoc) out.push(n);
        for (const k of Object.keys(n)) {
            if (k === 'leadingJsDoc') continue;
            const v = n[k];
            if (Array.isArray(v)) { for (const it of v) walk(it); }
            else if (v && typeof v === 'object' && typeof v.type === 'string') walk(v);
        }
    };
    walk(ast);
    return out;
}

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
    for (const d of diagnostics) {
        if (d.code !== 'incompatible-function-argument' && d.code !== 'nullable-argument') continue;
        const data = d.data; if (!data || typeof data.variableName !== 'string') continue;
        if (!paramNames.has(data.variableName)) continue;
        if (typeof data.argumentOffset === 'number' && (data.argumentOffset < bodyStart || data.argumentOffset > bodyEnd)) continue;
        const exp = Array.isArray(data.expectedTypes) ? data.expectedTypes
            : (typeof data.expectedType === 'string' ? splitTypeUnion(data.expectedType) : []);
        addC(data.variableName, exp);
    }
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
        // Member access proves `array | object` (runtime errors otherwise).
        if (n.type === 'MemberExpression' && n.object?.type === 'Identifier' && paramNames.has(n.object.name)) {
            addC(n.object.name, ['array','object']);
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

function inferAll(ast, diagnostics) {
    const funcs = collectUnannotatedFunctions(ast);
    const result = new Map();
    const funcsByName = new Map();
    for (const fn of funcs) if (fn.type === 'FunctionDeclaration' && fn.id?.name) funcsByName.set(fn.id.name, fn);
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
            for (const [k, v] of next) { if (cur.get(k) !== v) { cur.set(k, v); changed = true; } }
        }
        if (!changed) return { result, iterations: iter + 1, funcs };
    }
    return { result, iterations: 10, funcs };
}

// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
if (args.length === 0) {
    console.error('Usage: bun scripts/score-jsdoc-inference.js <file1.uc> [<file2.uc> ...]');
    process.exit(2);
}

const rows = [];
let totalParams = 0, totalInferred = 0, totalFiles = 0, totalErrored = 0;
const groups = new Map();

for (const filePath of args) {
    let code;
    try { code = fs.readFileSync(filePath, 'utf8'); } catch (e) { continue; }
    let ast, result;
    try { ({ ast, result } = analyze(code, path.resolve(filePath))); }
    catch (e) { totalErrored++; continue; }
    if (!ast) { totalErrored++; continue; }

    const { result: allInferred, iterations, funcs } = inferAll(ast, result.diagnostics);
    let pTotal = 0, pTyped = 0;
    for (const fn of funcs) {
        const inf = allInferred.get(fn);
        for (const p of fn.params) {
            pTotal++;
            if (inf.get(p.name) !== 'unknown') pTyped++;
        }
    }
    const hit = pTotal > 0 ? (100 * pTyped / pTotal).toFixed(0) : '—';
    rows.push({ file: filePath, funcs: funcs.length, params: pTotal, typed: pTyped, hit, iterations });
    totalParams += pTotal; totalInferred += pTyped; totalFiles++;

    const top = filePath.split('/')[0];
    if (!groups.has(top)) groups.set(top, { params: 0, typed: 0, files: 0 });
    const g = groups.get(top); g.params += pTotal; g.typed += pTyped; g.files++;
}

// Print sorted by hit rate (descending) so the wins float to the top.
rows.sort((a, b) => parseFloat(b.hit || 0) - parseFloat(a.hit || 0));

console.log('hit%  typed/params  funcs  iter  file');
console.log('────  ────────────  ─────  ────  ───────────────────────────────────');
for (const r of rows) {
    const pad = (s, n) => String(s).padStart(n);
    console.log(`${pad(r.hit, 4)}  ${pad(`${r.typed}/${r.params}`, 12)}  ${pad(r.funcs, 5)}  ${pad(r.iterations, 4)}  ${r.file}`);
}

console.log('\n──────────────────────────────────────────────────────────────');
console.log(`Total: ${totalInferred}/${totalParams} params auto-typed across ${totalFiles} files (${(100 * totalInferred / totalParams).toFixed(1)}%)`);
if (totalErrored > 0) console.log(`(${totalErrored} files failed to parse — skipped)`);
console.log('\nBy directory:');
for (const [name, g] of groups) {
    console.log(`  ${name.padEnd(12)}  ${g.typed}/${g.params}  (${(100 * g.typed / g.params).toFixed(1)}%)  across ${g.files} files`);
}
