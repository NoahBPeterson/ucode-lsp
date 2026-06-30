// Function-level git history for CodeLens.
//
// The pure helpers (collectAllFunctions, parseGitLogLOutput, formatSummaryTitle)
// are unit-tested in isolation. Only runGitLogL / repoHead / getFunctionGitSummary
// touch the environment (they shell out to `git`); all of those swallow failure
// and return null so a missing repo, untracked file, or out-of-range edit just
// produces a muted lens instead of throwing.

import { execFileSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import type { AstNode, FunctionDeclarationNode } from './ast/nodes';

/** One parsed commit from the `git log -L` custom format. */
export interface GitCommit {
    hash: string;
    author: string;
    relDate: string;   // human relative date, e.g. "2 days ago"
    subject: string;
}

/** A function's git history over a line range, newest commit first. */
export interface GitSummary {
    count: number;        // commits touching the range
    last: GitCommit;      // most recent commit
    commits: GitCommit[]; // all commits, newest first
}

/**
 * Collect every function DECLARATION — `function foo() {}` — at any nesting
 * depth (top-level, exported, or nested inside another function/block). These
 * are functions that are merely *defined*, not assigned to anything.
 *
 * Deliberately EXCLUDES values: arrow functions and function expressions
 * (`let f = function () {}`, `{ call: function () {} }`) get no CodeLens, since
 * they're bound to a variable/property rather than declared. Skips recursing
 * into `leadingJsDoc` to avoid walking comment sub-trees.
 */
export function collectFunctionDeclarations(ast: AstNode | null | undefined): FunctionDeclarationNode[] {
    const out: FunctionDeclarationNode[] = [];
    const walk = (n: AstNode): void => {
        if (!n || typeof n !== 'object' || typeof n.type !== 'string') return;
        // Skip forward declarations (`function f;`) — they have no body; the real
        // definition (if any) gets the lens, so `f` isn't annotated twice.
        if (n.type === 'FunctionDeclaration' && !(n as FunctionDeclarationNode).forwardDeclaration) out.push(n as FunctionDeclarationNode);
        for (const k of Object.keys(n)) {
            if (k === 'leadingJsDoc') continue;
            const v = (n as unknown as Record<string, unknown>)[k];
            if (Array.isArray(v)) { for (const it of v) walk(it as AstNode); }
            else if (v && typeof v === 'object' && typeof (v as { type?: unknown }).type === 'string') walk(v as AstNode);
        }
    };
    if (ast) walk(ast);
    return out;
}

/** A CodeLens target: a function definition the lens (git history + references) sits above.
 *  Covers plain `function foo(){}` declarations, function-VALUED global definitions
 *  (`global.X = function…` / top-level bare `X = function…`), top-level function-valued
 *  `let`/`const` variables, and object-literal METHODS (`{ m: function… }` — the rpc-handler
 *  API pattern). All form a referenceable surface worth a history/references annotation. */
export interface CodeLensFn {
    name: string;
    /** The identifier node to exclude from its own reference list (null = none to exclude). */
    idNode: AstNode | null;
    nameStart: number;   // identifier offset — declaration position + stable lens key
    anchorStart: number; // offset whose LINE the lens renders on
    defStart: number;    // git -L range start offset
    defEnd: number;      // git -L range end offset
    /** When set, this is an object-literal method bound to `<memberOf>` — its references are
     *  `<memberOf>.name` MEMBER accesses, not bare calls. Empty string = unbound (e.g. a bare
     *  `return {…}`), so no in-file reference base. */
    memberOf?: string;
    /** True for a function-valued GLOBAL definition (`global.X = fn` / bare `X = fn`). Such a
     *  name leaks into a `loadfile()()` caller, so its references also live in those callers —
     *  the resolver follows loadfile edges (not just import edges) for these. */
    isGlobal?: boolean;
}

const isFnValue = (n: any): boolean => n?.type === 'FunctionExpression' || n?.type === 'ArrowFunctionExpression';

/**
 * CodeLens targets = every `collectFunctionDeclarations` PLUS top-level function-valued
 * definitions worth annotating:
 *   • `global.X = fn` / bare `X = fn` (implicit globals; leak into a `loadfile()()` caller),
 *   • `let`/`const X = fn` (module-scope function variables),
 *   • object-literal methods `{ m: fn }` on a top-level object (`let api = {…}`, `api = {…}`,
 *     or a top-level `return {…}` — the rpc-handler export pattern). References for these are
 *     MEMBER accesses through the object's binding (tracked via `memberOf`).
 * Nested/local function values are intentionally left out (low value, refs already local).
 */
export function collectCodeLensFunctions(ast: AstNode | null | undefined): CodeLensFn[] {
    const out: CodeLensFn[] = [];
    for (const fn of collectFunctionDeclarations(ast)) {
        if (fn.id) out.push({ name: fn.id.name, idNode: fn.id, nameStart: fn.id.start, anchorStart: fn.start, defStart: fn.start, defEnd: fn.end });
    }
    const prog = ast as { type?: string; body?: unknown[] } | null | undefined;
    if (!prog || prog.type !== 'Program' || !Array.isArray(prog.body)) return out;

    // Top-level let/const/function names — a bare `name = fn` to one of these is a local
    // reassignment, not a global, so it gets no lens (consistent with `let f = function`).
    const declared = new Set<string>();
    for (const stmt of prog.body) {
        const s = stmt as { type?: string; id?: { name?: string }; declarations?: { id?: { type?: string; name?: string } }[] };
        if (s?.type === 'FunctionDeclaration' && s.id?.name) declared.add(s.id.name);
        if (s?.type === 'VariableDeclaration') for (const d of (s.declarations ?? [])) if (d?.id?.type === 'Identifier' && d.id.name) declared.add(d.id.name);
    }

    // Emit a lens per function-valued property of an object literal, bound to `memberOf`.
    const emitObjectMethods = (obj: any, memberOf: string): void => {
        for (const prop of (obj?.properties ?? [])) {
            if (prop?.type !== 'Property' || !isFnValue(prop.value)) continue;
            const key = prop.key;
            const keyName = key?.type === 'Identifier' ? key.name
                : (key?.type === 'Literal' && typeof key.value === 'string' ? key.value : undefined);
            if (!keyName) continue;
            out.push({
                name: keyName, idNode: key as AstNode, nameStart: key.start,
                anchorStart: prop.start, defStart: prop.start, defEnd: prop.value.end, memberOf,
            });
        }
    };

    for (const stmt of prog.body) {
        const s = stmt as { type?: string; expression?: any; declarations?: any[]; argument?: any };

        // let/const X = fn  (module-scope function var)  |  let/const api = { …methods }
        if (s?.type === 'VariableDeclaration') {
            for (const d of (s.declarations ?? [])) {
                if (d?.id?.type !== 'Identifier' || !d.init) continue;
                if (isFnValue(d.init)) {
                    out.push({ name: d.id.name, idNode: d.id as AstNode, nameStart: d.id.start, anchorStart: d.id.start, defStart: d.init.start, defEnd: d.init.end });
                } else if (d.init.type === 'ObjectExpression') {
                    emitObjectMethods(d.init, d.id.name);
                }
            }
            continue;
        }

        // top-level `return { …methods }`  (module export object — unbound)
        if (s?.type === 'ReturnStatement' && s.argument?.type === 'ObjectExpression') {
            emitObjectMethods(s.argument, '');
            continue;
        }

        const expr = s?.type === 'ExpressionStatement' ? s.expression : null;
        if (!expr || expr.type !== 'AssignmentExpression' || expr.operator !== '=') continue;
        const left = expr.left, rhs = expr.right;

        // api = { …methods }  (assignment to a bare identifier)
        if (rhs?.type === 'ObjectExpression' && left?.type === 'Identifier' && left.name) {
            emitObjectMethods(rhs, left.name);
            continue;
        }
        if (!isFnValue(rhs)) continue;
        // global.X = fn  |  bare X = fn (implicit global)
        if (left?.type === 'MemberExpression' && left.object?.type === 'Identifier' && left.object.name === 'global'
            && !left.computed && left.property?.type === 'Identifier' && left.property.name) {
            out.push({ name: left.property.name, idNode: left.property as AstNode, nameStart: left.property.start, anchorStart: expr.start, defStart: expr.start, defEnd: rhs.end, isGlobal: true });
        } else if (left?.type === 'Identifier' && left.name && !declared.has(left.name)) {
            out.push({ name: left.name, idNode: left as AstNode, nameStart: left.start, anchorStart: left.start, defStart: left.start, defEnd: rhs.end, isGlobal: true });
        }
    }
    return out;
}

// ASCII Unit Separator — the field delimiter in the git --format string. Never
// appears in author names or commit subjects, so splitting on it is safe.
const FS_CHAR = '\x1f';
const GIT_FORMAT = `%H${FS_CHAR}%an${FS_CHAR}%ar${FS_CHAR}%s`;

/**
 * Parse the stdout of
 *   git log -L <s>,<e>:<file> -s --format='%H\x1f%an\x1f%ar\x1f%s'
 * One line per commit, newest first. Returns null when there is no history.
 */
export function parseGitLogLOutput(stdout: string): GitSummary | null {
    if (!stdout) return null;
    const commits: GitCommit[] = [];
    for (const raw of stdout.split('\n')) {
        const line = raw.replace(/\r$/, '');
        if (!line) continue;
        const parts = line.split(FS_CHAR);
        if (parts.length < 4) continue;
        commits.push({
            hash: parts[0]!,
            author: parts[1]!,
            relDate: parts[2]!,
            subject: parts.slice(3).join(FS_CHAR), // subject can't contain \x1f, but be safe
        });
    }
    if (commits.length === 0) return null;
    return { count: commits.length, last: commits[0]!, commits };
}

/** First whitespace-delimited token of an author name, to keep the lens short. */
function firstName(author: string): string {
    const t = author.trim().split(/\s+/)[0];
    return t || author;
}

/** Inline CodeLens title, e.g. "3 commits · last: Noah, 2 days ago". */
export function formatSummaryTitle(s: GitSummary): string {
    const plural = s.count === 1 ? 'commit' : 'commits';
    return `${s.count} ${plural} · last: ${firstName(s.last.author)}, ${s.last.relDate}`;
}

/**
 * Run `git log -L start,end:file -s` for a 1-based line range. Returns stdout,
 * or null on any failure (not a repo, untracked path, range past on-disk EOF,
 * timeout). Never throws. Uses execFile (array args) + cwd=dirname/basename so
 * paths with spaces and the `:file` pathspec resolve cleanly.
 */
export function runGitLogL(filePath: string, startLine: number, endLine: number): string | null {
    try {
        return execFileSync('git', [
            'log',
            '-L', `${startLine},${endLine}:${path.basename(filePath)}`,
            '-s',
            `--format=${GIT_FORMAT}`,
        ], {
            cwd: path.dirname(filePath),
            encoding: 'utf8',
            timeout: 3000,
            maxBuffer: 1 << 20,
            stdio: ['ignore', 'pipe', 'ignore'],
        });
    } catch {
        return null;
    }
}

interface CacheEntry { value: GitSummary | null; head: string | null; mtimeMs: number; }
const summaryCache = new Map<string, CacheEntry>();

// Per-directory HEAD cache with a short TTL so a burst of resolves (one render)
// shares a single `git rev-parse` instead of one per lens.
const headCache = new Map<string, { head: string | null; at: number }>();
const HEAD_TTL_MS = 2000;

function repoHead(dir: string): string | null {
    const now = Date.now();
    const cached = headCache.get(dir);
    if (cached && now - cached.at < HEAD_TTL_MS) return cached.head;
    let head: string | null = null;
    try {
        head = execFileSync('git', ['rev-parse', 'HEAD'], {
            cwd: dir, encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
    } catch {
        head = null;
    }
    headCache.set(dir, { head, at: now });
    return head;
}

/**
 * Cached function git summary. The cache invalidates when the repo HEAD changes
 * (new commit) or the on-disk file mtime changes (save). Returns null when there
 * is no resolvable history (caller renders a muted lens).
 *
 * Limitation: git reads the on-disk file, so an unsaved/line-skewed editor
 * buffer yields approximate or muted results until the file is saved.
 */
export function getFunctionGitSummary(filePath: string, startLine: number, endLine: number): GitSummary | null {
    const dir = path.dirname(filePath);
    const head = repoHead(dir);
    let mtimeMs = 0;
    try { mtimeMs = fs.statSync(filePath).mtimeMs; } catch { /* missing → mtime 0 */ }

    const key = `${filePath}:${startLine}:${endLine}`;
    const cached = summaryCache.get(key);
    if (cached && cached.head === head && cached.mtimeMs === mtimeMs) return cached.value;

    const stdout = runGitLogL(filePath, startLine, endLine);
    const value = stdout ? parseGitLogLOutput(stdout) : null;
    summaryCache.set(key, { value, head, mtimeMs });
    return value;
}
