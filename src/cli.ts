/**
 * CLI check mode for ucode-lsp
 *
 * Scans .uc files and prints diagnostics (like `tsc`).
 * Invoked by bin/ucode-lsp.js when no LSP transport flag is passed.
 */

import * as fs from 'fs';
import * as path from 'path';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { DiagnosticSeverity } from 'vscode-languageserver/node';
import type { Diagnostic } from 'vscode-languageserver/node';
import { UcodeLexer } from './lexer';
import { UcodeParser } from './parser';
import { SemanticAnalyzer } from './analysis';

const VERSION = '0.6.16';

const HELP = `ucode-lsp v${VERSION} — ucode language server and checker

Usage:
  ucode-lsp [options] [paths...]

Modes:
  (default)         Check .uc files and print diagnostics
  --stdio           Start LSP server over stdio (for editors)

Options:
  --verbose         Show all diagnostics including info and hints
  --help            Show this help message
  --help-types      Show the type annotation guide
  --version         Show version

Examples:
  ucode-lsp                     Check all .uc files in current directory
  ucode-lsp src/                Check all .uc files in src/
  ucode-lsp file.uc             Check a specific file
  ucode-lsp --verbose           Include info-level diagnostics
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

const KNOWN_FLAGS = new Set(['--verbose', '--help', '--help-types', '--version', '--stdio', '--pipe', '--node-ipc']);

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

function analyzeFile(filePath: string): Diagnostic[] {
    const content = fs.readFileSync(filePath, 'utf8');
    const uri = 'file://' + encodeURIComponent(path.resolve(filePath)).replace(/%2F/g, '/');
    const textDocument = TextDocument.create(uri, 'ucode', 1, content);

    const lexer = new UcodeLexer(content, { rawMode: true });
    const tokens = lexer.tokenize();
    const parser = new UcodeParser(tokens, content);
    parser.setComments(lexer.comments);
    const parseResult = parser.parse();

    const diagnostics: Diagnostic[] = parseResult.errors.map(err => ({
        severity: DiagnosticSeverity.Error,
        range: {
            start: textDocument.positionAt(err.start),
            end: textDocument.positionAt(err.end),
        },
        message: err.message,
        source: 'ucode-parser',
    }));

    if (parseResult.ast) {
        const analyzer = new SemanticAnalyzer(textDocument, {
            enableTypeChecking: true,
            enableScopeAnalysis: true,
            enableControlFlowAnalysis: true,
            enableUnusedVariableDetection: true,
            enableShadowingWarnings: true,
            workspaceRoot: process.cwd(),
        });
        const result = analyzer.analyze(parseResult.ast);
        diagnostics.push(...result.diagnostics);
    }

    return diagnostics;
}

function runCheck() {
    const args = process.argv.slice(2);

    if (args.includes('--help')) {
        process.stderr.write(HELP);
        process.exit(0);
    }

    if (args.includes('--help-types')) {
        process.stderr.write(HELP_TYPES);
        process.exit(0);
    }

    if (args.includes('--version')) {
        process.stderr.write(`ucode-lsp v${VERSION}\n`);
        process.exit(0);
    }

    // Check for unknown flags
    for (const arg of args) {
        if (arg.startsWith('-') && !KNOWN_FLAGS.has(arg) && !arg.startsWith('--socket=')) {
            process.stderr.write(`ucode-lsp: unknown option '${arg}'\n\n`);
            process.stderr.write(HELP);
            process.exit(2);
        }
    }

    const verbose = args.includes('--verbose');
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
        } catch (e: any) {
            process.stderr.write(`ucode-lsp: cannot access '${target}': ${e.message}\n`);
            process.exit(2);
        }
    }

    if (files.length === 0) {
        process.stderr.write('ucode-lsp: no .uc files found\n');
        process.exit(0);
    }

    let totalErrors = 0;
    let totalWarnings = 0;
    const cwd = process.cwd();

    for (const file of files.sort()) {
        let diagnostics: Diagnostic[];
        try {
            diagnostics = analyzeFile(file);
        } catch (e: any) {
            process.stderr.write(`ucode-lsp: error analyzing ${file}: ${e.message}\n`);
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
