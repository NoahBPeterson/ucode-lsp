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
 * Collect TOP-LEVEL function declarations only — `function foo() {}` and
 * `export [default] function foo() {}` that are direct statements of the
 * program. Deliberately EXCLUDES lambdas (arrow functions), function
 * expressions (`let f = function () {}`), and nested functions: CodeLens
 * annotates only top-level functions.
 */
export function collectTopLevelFunctions(ast: any): any[] {
    const body = ast?.body;
    if (!Array.isArray(body)) return [];
    const out: any[] = [];
    for (const stmt of body) {
        if (!stmt || typeof stmt !== 'object') continue;
        if (stmt.type === 'FunctionDeclaration') {
            out.push(stmt);
        } else if (
            (stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportDefaultDeclaration')
            && stmt.declaration && stmt.declaration.type === 'FunctionDeclaration'
        ) {
            // export function foo() {} — annotate the wrapped declaration.
            out.push(stmt.declaration);
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
