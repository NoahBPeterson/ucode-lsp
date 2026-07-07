/**
 * CLI check mode for ucode-lsp
 *
 * Scans .uc files and prints diagnostics (like `tsc`).
 * Invoked by bin/ucode-lsp.js when no LSP transport flag is passed.
 */

import * as fs from 'fs';
import * as path from 'path';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { DiagnosticSeverity, MarkupKind } from 'vscode-languageserver/node';
import type { Diagnostic, TextDocuments } from 'vscode-languageserver/node';
import { UcodeLexer, detectTemplateMode, bridgeTemplateTokens, type Token } from './lexer';
import { UcodeParser } from './parser';
import { SemanticAnalyzer, type SemanticAnalysisResult } from './analysis';
import { UcodeErrorCode } from './analysis/errorConstants';
import { UCODE_TARGET_VERSIONS, DEFAULT_TARGET_VERSION, type UcodeTargetVersion } from './analysis/ucodeVersions';
import { handleHover } from './hover';
import type {
    AstNode, IdentifierNode, MemberExpressionNode, PropertyNode,
    ImportSpecifierNode, ExportSpecifierNode, ExportAllDeclarationNode,
} from './ast/nodes';

// Read the version from package.json at build time so `--version` never drifts
// from the published version. Bundled by webpack into dist/cli.js.
const VERSION: string = require('../package.json').version;

const HELP = `ucode-lsp v${VERSION} — ucode language server and checker

Usage:
  ucode-lsp [options] [paths...]

Modes:
  (default)         Check .uc files and print diagnostics
  --stdio           Start LSP server over stdio (for editors)

Options:
  --verbose             Show all diagnostics including info and hints
  --target-version <v>  Target OpenWrt/ucode release for version-gated checks
  -t <v>                (alias of --target-version)
                        One of: ${UCODE_TARGET_VERSIONS.join(', ')} (default: ${DEFAULT_TARGET_VERSION})
  --type-coverage       Instead of diagnostics, report every variable that has
                        no hover or whose hover type contains 'unknown'
                        (file(line,startCol-endCol) per occurrence + a summary)
  --help                Show this help message
  --help-types          Show the type annotation guide
  --version             Show version

Examples:
  ucode-lsp                       Check all .uc files in current directory
  ucode-lsp src/                  Check all .uc files in src/
  ucode-lsp file.uc               Check a specific file
  ucode-lsp --verbose             Include info-level diagnostics
  ucode-lsp --target-version 23.05 file.uc   Check against OpenWrt 23.05's ucode
  ucode-lsp --type-coverage src/  Audit hover/type coverage of variables in src/
`;

const HELP_TYPES = `Type Annotations for ucode-lsp
===================================

ucode-lsp uses JSDoc comments (\`/** ... */\`) to provide type information
for static analysis, hover info, and autocompletion.

@param — Parameter Types
------------------------
Annotate function parameters with their expected types:

    /**
     * @param {string} name - The user's name
     * @param {number} age
     */
    function greet(name, age) { ... }

An alternative bare syntax is also supported:

    /** @param name string - The user's name */

@returns — Return Types
-----------------------
Document the return type of a function:

    /** @returns {string} The greeting message */
    function greet(name) { ... }

Note: return types are parsed for documentation but type inference
uses the actual return statements.

@typedef / @property — Custom Types
------------------------------------
Define named object types with typed properties:

    /**
     * @typedef {object} PkgInfo
     * @property {string} name - Package name
     * @property {string} version - Semantic version
     * @property {boolean?} installed - Whether installed
     */

    /** @param {PkgInfo} pkg */
    function install(pkg) {
        pkg.name;       // autocomplete + type: string
        pkg.installed;  // type: boolean | null
    }

Typedefs are scoped to the file they are defined in.

Supported Types
---------------
Primitives:
    string, number, integer (int), double (float),
    boolean (bool), array, object, function, null, regex (regexp)

Module types (used directly as types):
    fs, uci, ubus, uloop, math, io, log, debug, digest,
    nl80211, resolv, rtnl, socket, struct, zlib
    Also accepted with prefix: {module:fs}

Object types (provide method/property completion):
    fs.file, fs.dir, fs.proc, fs.statvfs, io.handle,
    uci.cursor, nl80211.listener, exception,
    uloop.timer, uloop.handle, uloop.process, uloop.task,
    uloop.interval, uloop.signal, uloop.pipe

Union types:
    {string|number}, {fs.file|null}

Optional types (shorthand for type|null):
    {string?}, {boolean?}

import() expressions:
    {import('fs')}             — builtin module type
    {import('fs').file}        — object type from module
    {import('./config')}       — default export from local file
    {import('./config').name}  — named export or default export property

Cross-File Types with import()
------------------------------
You can reference types from other .uc files using import().

Named exports (export const, export function):

    // lib/types.uc
    export const config = {
        host: 'localhost',
        port: 8080,
        enabled: true,
    };

    // main.uc
    /** @param {import('./lib/types').config} cfg */
    function start(cfg) {
        cfg.host;     // autocomplete + type: string
        cfg.port;     // type: number
        cfg.enabled;  // type: boolean
    }

Default exports:

    // lib/types.uc
    export default {
        host: 'localhost',
        port: 8080,
    };

    // main.uc — import the whole default export
    /** @param {import('./lib/types')} config */
    function start(config) {
        config.host;  // type: string
        config.port;  // type: number
    }

You can also access a property of the default export:

    // lib/types.uc
    export default {
        db: { host: 'localhost', port: 5432 },
        app: { name: 'myapp', debug: false },
    };

    // main.uc
    /** @param {import('./lib/types').db} conn */
    function connect(conn) {
        conn.host;  // type: string
        conn.port;  // type: number
    }

When a name matches both a named export and a default export
property, the named export takes priority.

Strict Mode
-----------
When a file contains 'use strict', the analyzer emits info-level
diagnostics (UC7003) for function parameters that lack @param
annotations. Use --verbose in check mode to see these.

Diagnostic Codes
----------------
UC1005    Variable shadows a variable from an outer scope
UC2006    printf/sprintf: wrong number of format arguments
UC2007    printf/sprintf: incompatible argument type
UC4001    Unreachable code after return/break/continue/die()/exit()
UC4005    A loop mutates the collection it iterates (skips elements, or
          loops forever — an error when the infinite loop is provable)
UC7001    Unknown type in @param annotation
UC7002    @param name does not match any function parameter
UC7003    Missing @param annotations (strict mode, info severity)

incompatible-function-argument
          Argument type does not match what the builtin expects
nullable-argument
          Argument may be null where non-null is required
`;

const SKIP_DIRS = new Set([
    'node_modules', '.git', '.vscode', 'dist', 'out',
    '.nyc_output', 'coverage', '__pycache__', '.pytest_cache',
    'build', 'target',
]);

const KNOWN_FLAGS = new Set(['--verbose', '--help', '--help-types', '--version', '--stdio', '--pipe', '--node-ipc', '--type-coverage']);

function collectUcFiles(dir: string): string[] {
    const files: string[] = [];
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return files;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
                files.push(...collectUcFiles(full));
            }
        } else if (entry.isFile() && entry.name.endsWith('.uc')) {
            files.push(full);
        }
    }
    return files;
}

function severityLabel(s: DiagnosticSeverity): string {
    switch (s) {
        case DiagnosticSeverity.Error:       return 'error';
        case DiagnosticSeverity.Warning:     return 'warning';
        case DiagnosticSeverity.Information: return 'info';
        case DiagnosticSeverity.Hint:        return 'hint';
        default:                             return 'unknown';
    }
}

interface FileAnalysis {
    diagnostics: Diagnostic[];
    document: TextDocument;
    tokens: Token[];
    comments: Token[];
    /** null when the file failed to parse (no AST to analyze). */
    result: SemanticAnalysisResult | null;
}

function analyzeFile(filePath: string, targetVersion: UcodeTargetVersion): FileAnalysis {
    const content = fs.readFileSync(filePath, 'utf8');
    const uri = 'file://' + encodeURIComponent(path.resolve(filePath)).replace(/%2F/g, '/');
    const textDocument = TextDocument.create(uri, 'ucode', 1, content);

    // Template files (`{% %}`/`{{ }}`) — e.g. uhttpd handlers — lex in template mode and
    // have their framing tokens bridged to statement separators so the ordinary parser can
    // consume them; raw scripts are unchanged. Mirrors the LSP server path so the CLI checker
    // and the editor agree (without this the CLI parses a `{%` handler as raw and emits a
    // spurious UC6001/UC3007/UC1002 cascade on valid template code).
    const isTemplate = detectTemplateMode(content);
    const lexer = new UcodeLexer(content, { rawMode: !isTemplate });
    const tokens = isTemplate ? bridgeTemplateTokens(lexer.tokenize()) : lexer.tokenize();
    const parser = new UcodeParser(tokens, content);
    parser.setComments(lexer.comments);
    const parseResult = parser.parse();

    // Lexer side-channel errors (#56) surface alongside parser errors.
    const diagnostics: Diagnostic[] = [...lexer.errors, ...parseResult.errors].map(err => ({
        severity: (err as { severity?: string }).severity === 'warning' ? DiagnosticSeverity.Warning : DiagnosticSeverity.Error,
        range: {
            start: textDocument.positionAt(err.start),
            end: textDocument.positionAt(err.end),
        },
        message: err.message,
        source: 'ucode-parser',
        code: err.code ?? UcodeErrorCode.SYNTAX_ERROR,
    }));

    let result: SemanticAnalysisResult | null = null;
    if (parseResult.ast) {
        const analyzer = new SemanticAnalyzer(textDocument, {
            enableTypeChecking: true,
            enableScopeAnalysis: true,
            enableControlFlowAnalysis: true,
            enableUnusedVariableDetection: true,
            enableShadowingWarnings: true,
            workspaceRoot: process.cwd(),
            targetVersion,
        });
        result = analyzer.analyze(parseResult.ast);
        diagnostics.push(...result.diagnostics);
    }

    return { diagnostics, document: textDocument, tokens, comments: lexer.comments, result };
}

/**
 * Collect every Identifier node that reads or binds a VARIABLE — i.e. every
 * position where hovering asks "what is this name?". Excludes identifiers that
 * are not variables:
 *   - `.prop` of a non-computed member expression (property name, not a variable)
 *   - `key` of a non-computed object-literal property
 *   - the module-side name of an aliased import/export (`import { X as y }` — X);
 *     for the non-aliased form the parser shares ONE node for both sides, which
 *     stays included as the local binding
 * Deduped by start offset (shared imported/local nodes are reachable twice).
 */
function collectVariableIdentifiers(root: AstNode): IdentifierNode[] {
    const out: IdentifierNode[] = [];
    const seen = new Set<number>();

    const visit = (node: AstNode): void => {
        if (!node || typeof node !== 'object' || typeof node.type !== 'string') return;

        if (node.type === 'Identifier') {
            const id = node as IdentifierNode;
            if (typeof id.start === 'number' && !seen.has(id.start)) {
                seen.add(id.start);
                out.push(id);
            }
            return;
        }

        // Children that are NOT variable positions (identity-based, so the shared
        // imported===local node of a non-aliased import is never skipped).
        const skip = new Set<unknown>();
        switch (node.type) {
            case 'MemberExpression': {
                const m = node as MemberExpressionNode;
                if (!m.computed) skip.add(m.property);
                break;
            }
            case 'Property': {
                const p = node as PropertyNode;
                if (!p.computed) skip.add(p.key);
                break;
            }
            case 'ImportSpecifier': {
                const s = node as ImportSpecifierNode;
                if (s.imported !== s.local) skip.add(s.imported);
                break;
            }
            case 'ExportSpecifier': {
                const s = node as ExportSpecifierNode;
                if (s.exported !== s.local) skip.add(s.exported);
                break;
            }
            case 'ExportAllDeclaration': {
                const s = node as ExportAllDeclarationNode;
                if (s.exported) skip.add(s.exported);
                break;
            }
        }

        for (const key of Object.keys(node)) {
            if (key === 'type' || key === 'start' || key === 'end' || key === 'leadingJsDoc') continue;
            const value = (node as unknown as Record<string, unknown>)[key];
            if (Array.isArray(value)) {
                for (const item of value) {
                    if (item && typeof item === 'object' && !skip.has(item)) visit(item as AstNode);
                }
            } else if (value && typeof value === 'object' && !skip.has(value)) {
                visit(value as AstNode);
            }
        }
    };

    visit(root);
    return out;
}

/** Pull the displayed type out of a hover's FIRST line (`… **name**: \`type\``).
 *  Returns null when the hover has no such type display (builtin docs, keywords,
 *  module documentation…) — those are typed/documented, not coverage gaps. */
function hoverDisplayedType(markdown: string): string | null {
    const firstLine = markdown.split('\n', 1)[0] ?? '';
    const m = firstLine.match(/\*\*\s*:\s*`([^`]+)`/);
    return m ? m[1]! : null;
}

interface CoverageIssue {
    kind: 'no-hover' | 'unknown-type';
    name: string;
    start: number;
    end: number;
    typeStr?: string;
}

/**
 * Probe every variable identifier in the file through the REAL editor hover
 * path (handleHover), so the report can never disagree with what VS Code
 * shows. Returns the issues plus how many identifiers were probed.
 */
function auditTypeCoverage(analysis: FileAnalysis): { issues: CoverageIssue[]; probed: number } {
    const { document, tokens, comments, result } = analysis;
    if (!result?.ast) return { issues: [], probed: 0 };

    // handleHover only needs `.get(uri)` from the documents collection.
    const documents = {
        get: (uri: string) => (uri === document.uri ? document : undefined),
    } as unknown as TextDocuments<TextDocument>;

    const identifiers = collectVariableIdentifiers(result.ast)
        .sort((a, b) => a.start - b.start);

    const issues: CoverageIssue[] = [];
    for (const id of identifiers) {
        const hover = handleHover(
            { textDocument: { uri: document.uri }, position: document.positionAt(id.start) },
            documents,
            result,
            tokens,
            comments,
        );

        const markdown = hover && typeof hover.contents === 'object' && 'kind' in hover.contents
            && hover.contents.kind === MarkupKind.Markdown ? hover.contents.value : null;

        if (!hover || markdown === '') {
            issues.push({ kind: 'no-hover', name: id.name, start: id.start, end: id.end });
            continue;
        }
        if (markdown) {
            const typeStr = hoverDisplayedType(markdown);
            if (typeStr && /\bunknown\b/.test(typeStr)) {
                issues.push({ kind: 'unknown-type', name: id.name, start: id.start, end: id.end, typeStr });
            }
        }
    }

    return { issues, probed: identifiers.length };
}

// Extract `--target-version <v>` / `--target-version=<v>` / `-t <v>` from the args,
// returning the chosen version (default DEFAULT_TARGET_VERSION) and the remaining
// args with the flag (and its value) removed. Exits on an invalid value.
function parseTargetVersion(args: string[]): { targetVersion: UcodeTargetVersion; rest: string[] } {
    let targetVersion: UcodeTargetVersion = DEFAULT_TARGET_VERSION;
    const rest: string[] = [];
    const valid = UCODE_TARGET_VERSIONS as readonly string[];
    const fail = (val: string) => {
        process.stderr.write(`ucode-lsp: invalid --target-version '${val}'. Valid: ${UCODE_TARGET_VERSIONS.join(', ')}\n`);
        process.exit(2);
    };
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === undefined) continue;
        let val: string | undefined;
        if (a === '--target-version' || a === '-t') {
            val = args[++i]; // consume the next token as the value
        } else if (a.startsWith('--target-version=')) {
            val = a.slice('--target-version='.length);
        } else if (a.startsWith('-t=')) {
            val = a.slice('-t='.length);
        } else {
            rest.push(a);
            continue;
        }
        if (val === undefined || !valid.includes(val)) fail(val ?? '');
        targetVersion = val as UcodeTargetVersion;
    }
    return { targetVersion, rest };
}

/**
 * `--type-coverage` mode: instead of diagnostics, print every variable
 * occurrence whose hover is missing or whose displayed type contains
 * `unknown`, as `file(line,startCol-endCol)` (1-based, end column inclusive),
 * then a coverage summary. Informational — always exits 0.
 */
function runTypeCoverage(files: string[], targetVersion: UcodeTargetVersion): void {
    const cwd = process.cwd();
    let totalProbed = 0;
    let totalNoHover = 0;
    let totalUnknown = 0;
    let skipped = 0;

    for (const file of files.sort()) {
        let analysis: FileAnalysis;
        try {
            analysis = analyzeFile(file, targetVersion);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            process.stderr.write(`ucode-lsp: error analyzing ${file}: ${msg}\n`);
            skipped++;
            continue;
        }

        const relPath = path.relative(cwd, file);
        if (!analysis.result?.ast) {
            process.stderr.write(`ucode-lsp: skipping ${relPath}: file does not parse\n`);
            skipped++;
            continue;
        }

        const { issues, probed } = auditTypeCoverage(analysis);
        totalProbed += probed;

        for (const issue of issues) {
            const start = analysis.document.positionAt(issue.start);
            const end = analysis.document.positionAt(issue.end);
            const loc = `${relPath}(${start.line + 1},${start.character + 1}-${end.character})`;
            if (issue.kind === 'no-hover') {
                totalNoHover++;
                process.stdout.write(`${loc}: no-hover: '${issue.name}' produces no hover\n`);
            } else {
                totalUnknown++;
                process.stdout.write(`${loc}: unknown-type: '${issue.name}' shows as \`${issue.typeStr}\`\n`);
            }
        }
    }

    const flagged = totalNoHover + totalUnknown;
    const covered = totalProbed - flagged;
    const pct = totalProbed > 0 ? ((covered / totalProbed) * 100).toFixed(1) : '100.0';
    const checkedFiles = files.length - skipped;
    process.stderr.write(
        `\nType coverage: ${pct}% — ${covered}/${totalProbed} variable occurrences typed`
        + ` (${totalUnknown} unknown-type, ${totalNoHover} no-hover)`
        + ` in ${checkedFiles} file${checkedFiles !== 1 ? 's' : ''}`
        + (skipped > 0 ? ` (${skipped} skipped)` : '')
        + `.\n`,
    );
    process.exit(0);
}

function runCheck() {
    const allArgs = process.argv.slice(2);

    if (allArgs.includes('--help')) {
        process.stderr.write(HELP);
        process.exit(0);
    }

    if (allArgs.includes('--help-types')) {
        process.stderr.write(HELP_TYPES);
        process.exit(0);
    }

    if (allArgs.includes('--version')) {
        process.stderr.write(`ucode-lsp v${VERSION}\n`);
        process.exit(0);
    }

    // Pull out --target-version (default 25.12) so it isn't treated as an unknown
    // flag or a file path; `args` is everything that remains.
    const { targetVersion, rest: args } = parseTargetVersion(allArgs);

    // Check for unknown flags
    for (const arg of args) {
        if (arg.startsWith('-') && !KNOWN_FLAGS.has(arg) && !arg.startsWith('--socket=')) {
            process.stderr.write(`ucode-lsp: unknown option '${arg}'\n\n`);
            process.stderr.write(HELP);
            process.exit(2);
        }
    }

    const verbose = args.includes('--verbose');
    const typeCoverage = args.includes('--type-coverage');
    const minSeverity = verbose ? DiagnosticSeverity.Hint : DiagnosticSeverity.Warning;

    let targets = args.filter(a => !a.startsWith('-'));

    if (targets.length === 0) {
        targets = [process.cwd()];
    }

    // Expand directories into .uc files, keep explicit .uc files as-is
    const files: string[] = [];
    for (const target of targets) {
        const resolved = path.resolve(target);
        try {
            const stat = fs.statSync(resolved);
            if (stat.isDirectory()) {
                files.push(...collectUcFiles(resolved));
            } else if (stat.isFile()) {
                files.push(resolved);
            }
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            process.stderr.write(`ucode-lsp: cannot access '${target}': ${msg}\n`);
            process.exit(2);
        }
    }

    if (files.length === 0) {
        process.stderr.write('ucode-lsp: no .uc files found\n');
        process.exit(0);
    }

    if (typeCoverage) {
        runTypeCoverage(files, targetVersion);
        return;
    }

    let totalErrors = 0;
    let totalWarnings = 0;
    const cwd = process.cwd();

    for (const file of files.sort()) {
        let diagnostics: Diagnostic[];
        try {
            diagnostics = analyzeFile(file, targetVersion).diagnostics;
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            process.stderr.write(`ucode-lsp: error analyzing ${file}: ${msg}\n`);
            continue;
        }

        const relPath = path.relative(cwd, file);

        for (const d of diagnostics) {
            if (d.severity === undefined) {
                throw new Error(`Diagnostic missing severity: ${d.message}`);
            }
            if (d.severity > minSeverity) continue;

            const line = d.range.start.line + 1;
            const col = d.range.start.character + 1;
            const label = severityLabel(d.severity);
            const code = d.code ? ` ${d.code}` : '';
            process.stdout.write(`${relPath}(${line},${col}): ${label}${code}: ${d.message}\n`);

            if (d.severity === DiagnosticSeverity.Error) totalErrors++;
            else if (d.severity === DiagnosticSeverity.Warning) totalWarnings++;
        }
    }

    // Summary
    if (totalErrors > 0 || totalWarnings > 0) {
        const parts: string[] = [];
        if (totalErrors > 0) parts.push(`${totalErrors} error${totalErrors !== 1 ? 's' : ''}`);
        if (totalWarnings > 0) parts.push(`${totalWarnings} warning${totalWarnings !== 1 ? 's' : ''}`);
        process.stderr.write(`\nFound ${parts.join(' and ')} in ${files.length} file${files.length !== 1 ? 's' : ''}.\n`);
        process.exit(totalErrors > 0 ? 1 : 0);
    } else {
        process.stderr.write(`\nNo errors found in ${files.length} file${files.length !== 1 ? 's' : ''}.\n`);
        process.exit(0);
    }
}

runCheck();
