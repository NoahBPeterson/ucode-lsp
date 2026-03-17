import {
    createConnection,
    TextDocuments,
    ProposedFeatures,
    InitializeParams,
    DidChangeConfigurationNotification,
    TextDocumentSyncKind,
    InitializeResult,
    WorkspaceFoldersChangeEvent,
    DidChangeWatchedFilesParams,
    TextDocumentChangeEvent,
    Diagnostic,
    DiagnosticSeverity,
    FileChangeType,
    DidChangeWatchedFilesNotification,
    CodeActionParams,
    CodeAction,
    CodeActionKind,
    TextEdit,
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';
import * as fs from 'fs';
import * as path from 'path';
// import { validateDocument, createValidationConfig } from './validations/hybrid-validator';
import { handleHover } from './hover';
import { handleCompletion, handleCompletionResolve } from './completion';
import { handleDefinition } from './definition';
import { SemanticAnalyzer, SemanticAnalysisResult } from './analysis';
import { UcodeParser } from './parser';
import { UcodeLexer } from './lexer';
import { FileResolver } from './analysis/fileResolver';

const connection = createConnection(ProposedFeatures.all);

const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

// Analysis cache for storing semantic analysis results with timestamps and tokens
const analysisCache = new Map<string, {result: SemanticAnalysisResult, tokens: any[], timestamp: number}>();

// Debounce timers for document analysis - prevents re-analysis on every keystroke
const analysisTimers = new Map<string, ReturnType<typeof setTimeout>>();
const ANALYSIS_DEBOUNCE_MS = 50;

// Workspace folders for directory scanning
let workspaceFolders: string[] = [];
let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;

// Simple URI to file path conversion for file:// URIs
function uriToFilePath(uri: string): string {
    if (uri.startsWith('file://')) {
        return decodeURIComponent(uri.slice(7)); // Remove 'file://' prefix
    }
    return uri;
}

// Simple file path to URI conversion
function filePathToUri(filePath: string): string {
    // Simple conversion for file:// protocol
    const normalized = path.normalize(filePath);
    return 'file://' + encodeURIComponent(normalized).replace(/%2F/g, '/');
}

// Directory scanning functionality
async function scanWorkspaceForUcodeFiles(workspaceFolders: string[]): Promise<string[]> {
    const ucodeFiles: string[] = [];
    
    for (const folder of workspaceFolders) {
        try {
            await scanDirectoryRecursively(folder, ucodeFiles);
        } catch (error) {
            connection.console.error(`Error scanning workspace folder ${folder}: ${error}`);
        }
    }
    
    connection.console.log(`Found ${ucodeFiles.length} .uc files in workspace`);
    return ucodeFiles;
}

async function scanDirectoryRecursively(dir: string, ucodeFiles: string[]): Promise<void> {
    try {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            
            if (entry.isDirectory()) {
                // Skip common directories that shouldn't contain relevant .uc files
                if (shouldSkipDirectory(entry.name)) {
                    continue;
                }
                await scanDirectoryRecursively(fullPath, ucodeFiles);
            } else if (entry.isFile() && entry.name.endsWith('.uc')) {
                ucodeFiles.push(fullPath);
            }
        }
    } catch (error) {
        // Silently ignore permission errors and continue scanning
        if ((error as any).code !== 'EACCES' && (error as any).code !== 'EPERM') {
            connection.console.warn(`Error reading directory ${dir}: ${error}`);
        }
    }
}

function shouldSkipDirectory(dirName: string): boolean {
    const skipDirs = [
        'node_modules',
        '.git',
        '.vscode',
        'dist',
        'out',
        '.nyc_output',
        'coverage',
        '__pycache__',
        '.pytest_cache',
        'build',
        'target'
    ];
    return skipDirs.includes(dirName) || dirName.startsWith('.');
}

async function analyzeDiscoveredFiles(filePaths: string[]): Promise<void> {
    for (const filePath of filePaths) {
        try {
            const uri = filePathToUri(filePath);
            const content = await fs.promises.readFile(filePath, 'utf8');
            const textDocument = TextDocument.create(uri, 'ucode', 1, content);
            await validateAndAnalyzeDocument(textDocument);
            // Yield to event loop between files so incoming requests aren't blocked
            await new Promise(resolve => setImmediate(resolve));
        } catch (error) {
            // Silently skip files that fail to analyze during background scan
        }
    }
    
    connection.console.log(`Completed analysis of workspace .uc files`);
}

async function scanAndAnalyzeWorkspace(): Promise<void> {
    if (workspaceFolders.length === 0) {
        connection.console.log('No workspace folders to scan');
        return;
    }
    
    connection.console.log(`Starting workspace scan of ${workspaceFolders.length} folders...`);
    const ucodeFiles = await scanWorkspaceForUcodeFiles(workspaceFolders);
    
    if (ucodeFiles.length > 0) {
        await analyzeDiscoveredFiles(ucodeFiles);
    }
}

connection.onInitialize((params: InitializeParams) => {
    connection.console.log('ucode language server initializing...');
    const capabilities = params.capabilities;

    hasConfigurationCapability = !!(
        capabilities.workspace && !!capabilities.workspace.configuration
    );
    hasWorkspaceFolderCapability = !!(
        capabilities.workspace && !!capabilities.workspace.workspaceFolders
    );

    // Initialize workspace folders
    if (params.workspaceFolders) {
        workspaceFolders = params.workspaceFolders.map(folder => uriToFilePath(folder.uri));
        connection.console.log(`Initialized with ${workspaceFolders.length} workspace folders: ${workspaceFolders.join(', ')}`);
    } else if (params.rootUri) {
        workspaceFolders = [uriToFilePath(params.rootUri)];
        connection.console.log(`Initialized with root URI: ${workspaceFolders[0]}`);
    } else if (params.rootPath) {
        workspaceFolders = [params.rootPath];
        connection.console.log(`Initialized with root path: ${workspaceFolders[0]}`);
    }

    const result: InitializeResult = {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,
            completionProvider: {
                resolveProvider: true,
                triggerCharacters: ['.', "'", '"', ',', '@', '{'],
                allCommitCharacters: ['(', '['],
                completionItem: {
                    labelDetailsSupport: true
                }
            },
            hoverProvider: true,
            definitionProvider: true,
            codeActionProvider: {
                codeActionKinds: [CodeActionKind.QuickFix]
            }
        }
    };
    if (hasWorkspaceFolderCapability) {
        result.capabilities.workspace = {
            workspaceFolders: {
                supported: true,
                changeNotifications: true
            }
        };
    }
    return result;
});

connection.onInitialized(async () => {
    if (hasConfigurationCapability) {
        connection.client.register(DidChangeConfigurationNotification.type, undefined);
    }
    if (hasWorkspaceFolderCapability) {
        connection.workspace.onDidChangeWorkspaceFolders(async (event: WorkspaceFoldersChangeEvent) => {
            connection.console.log('Workspace folder change event received.');
            
            // Update workspace folders
            for (const removed of event.removed) {
                const removedPath = uriToFilePath(removed.uri);
                const index = workspaceFolders.indexOf(removedPath);
                if (index > -1) {
                    workspaceFolders.splice(index, 1);
                    connection.console.log(`Removed workspace folder: ${removedPath}`);
                }
            }
            
            for (const added of event.added) {
                const addedPath = uriToFilePath(added.uri);
                if (!workspaceFolders.includes(addedPath)) {
                    workspaceFolders.push(addedPath);
                    connection.console.log(`Added workspace folder: ${addedPath}`);
                }
            }
            
            // Re-scan workspace after changes
            await scanAndAnalyzeWorkspace();
        });
    }

    // Register file watcher for .uc files
    try {
        await connection.client.register(DidChangeWatchedFilesNotification.type, {
            watchers: [
                {
                    globPattern: '**/*.uc',
                    kind: 7 // Create | Change | Delete
                }
            ]
        });
        connection.console.log('File watcher registered for .uc files');
    } catch (error) {
        connection.console.warn(`Failed to register file watcher: ${error}`);
    }

    // Perform initial workspace scan in the background — don't block request handling
    scanAndAnalyzeWorkspace();
});

documents.onDidClose((_e: TextDocumentChangeEvent<TextDocument>) => {
    // Document closed - could clean up any document-specific data here
});

documents.onDidChangeContent(async (change: TextDocumentChangeEvent<TextDocument>) => {
    // Debounce analysis — avoid re-running full semantic analysis on every keystroke
    const uri = change.document.uri;
    const existingTimer = analysisTimers.get(uri);
    if (existingTimer) {
        clearTimeout(existingTimer);
    }
    analysisTimers.set(uri, setTimeout(async () => {
        analysisTimers.delete(uri);
        await validateAndAnalyzeDocument(change.document);
    }, ANALYSIS_DEBOUNCE_MS));
});

documents.onDidOpen(async (change: TextDocumentChangeEvent<TextDocument>) => {
    await validateAndAnalyzeDocument(change.document);
});

// Helper function to check if a diagnostic should be converted to lower severity by disable comments
function shouldReduceDiagnosticSeverity(textDocument: TextDocument, diagnostic: Diagnostic): boolean {
    const text = textDocument.getText();
    const lines = text.split(/\r?\n/);
    const startLine = diagnostic.range.start.line;
    const endLine = diagnostic.range.end.line;
    
    // Check if any line in the diagnostic range has a disable comment
    for (let lineIndex = startLine; lineIndex <= endLine; lineIndex++) {
        if (lineIndex < lines.length) {
            const line = lines[lineIndex];
            if (line && line.includes('// ucode-lsp disable')) {
                return true;
            }
        }
    }
    
    return false;
}

async function validateAndAnalyzeDocument(textDocument: TextDocument): Promise<void> {
    const text = textDocument.getText();
    const lexer = new UcodeLexer(text, { rawMode: true });
    const tokens = lexer.tokenize();
    const parser = new UcodeParser(tokens, text);
    parser.setComments(lexer.comments);
    const parseResult = parser.parse();

    let diagnostics: Diagnostic[] = parseResult.errors.map(err => {
        const diagnostic: Diagnostic = {
            severity: DiagnosticSeverity.Error,
            range: {
                start: textDocument.positionAt(err.start),
                end: textDocument.positionAt(err.end),
            },
            message: err.message,
            source: 'ucode-parser'
        };
        
        // Convert to lower severity if there's a disable comment
        if (shouldReduceDiagnosticSeverity(textDocument, diagnostic)) {
            if (diagnostic.severity === DiagnosticSeverity.Error) {
                diagnostic.severity = DiagnosticSeverity.Warning;
            } else if (diagnostic.severity === DiagnosticSeverity.Warning) {
                diagnostic.severity = DiagnosticSeverity.Information;
            }
        }
        
        return diagnostic;
    });

    if (parseResult.ast) {
        const analyzer = new SemanticAnalyzer(textDocument, {
            enableTypeChecking: true,
            enableScopeAnalysis: true,
            enableControlFlowAnalysis: true,
            enableUnusedVariableDetection: true,
            enableShadowingWarnings: true,
            workspaceRoot: workspaceFolders.length > 0 ? workspaceFolders[0] : process.cwd(),
        });
        const analysisResult = analyzer.analyze(parseResult.ast);
        analysisCache.set(textDocument.uri, {result: analysisResult, tokens, timestamp: Date.now()});
        
        // Semantic analysis diagnostics are already filtered by the SemanticAnalyzer itself
        diagnostics.push(...analysisResult.diagnostics);
    } else {
        analysisCache.delete(textDocument.uri);
    }
    
    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

connection.onDidChangeWatchedFiles(async (params: DidChangeWatchedFilesParams) => {
    for (const change of params.changes) {
        const filePath = uriToFilePath(change.uri);

        if (!filePath.endsWith('.uc')) {
            continue;
        }

        switch (change.type) {
            case FileChangeType.Created:
            case FileChangeType.Changed:
                try {
                    const content = await fs.promises.readFile(filePath, 'utf8');
                    const textDocument = TextDocument.create(change.uri, 'ucode', 1, content);
                    await validateAndAnalyzeDocument(textDocument);
                } catch (error) {
                    analysisCache.delete(change.uri);
                }
                break;

            case FileChangeType.Deleted:
                analysisCache.delete(change.uri);
                break;
        }
    }
});

connection.onHover((params) => {
    const cacheEntry = analysisCache.get(params.textDocument.uri);
    if (!cacheEntry?.result) {
        return null;
    }

    return handleHover(params, documents, cacheEntry.result, cacheEntry.tokens);
});

connection.onCompletion(async (params) => {
    let cacheEntry = analysisCache.get(params.textDocument.uri);
    let analysisResult = cacheEntry?.result;

    // If no analysis result is cached, force a fresh analysis
    if (!analysisResult) {
        const document = documents.get(params.textDocument.uri);
        if (document) {
            await validateAndAnalyzeDocument(document);
            cacheEntry = analysisCache.get(params.textDocument.uri);
            analysisResult = cacheEntry?.result;
        }
    }
    
    return handleCompletion(params, documents, connection, analysisResult);
});

connection.onCompletionResolve((item) => {
    return handleCompletionResolve(item);
});

connection.onCodeAction((params: CodeActionParams): CodeAction[] => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return [];
    }

    const codeActions: CodeAction[] = [];

    // Get cached AST for context detection
    const cacheEntry = analysisCache.get(params.textDocument.uri);
    const ast = cacheEntry?.result?.ast;

    // Get diagnostics for the current range
    const diagnostics = params.context.diagnostics;
    const disableLines = new Set<number>();

    for (const diagnostic of diagnostics) {
        // Only provide fix for ucode-semantic diagnostics (our diagnostics)
        if (diagnostic.source === 'ucode-semantic') {
            const line = diagnostic.range.start.line;
            const lineText = document.getText({
                start: { line: line, character: 0 },
                end: { line: line + 1, character: 0 }
            }).replace(/\r?\n$/, ''); // Remove trailing newline

            // Add type narrowing specific quick fixes
            if (diagnostic.code) {
                const typeNarrowingActions = generateTypeNarrowingQuickFixes(
                    diagnostic, document, params.textDocument.uri, lineText, ast
                );
                codeActions.push(...typeNarrowingActions);
            }

            // Add import() type quick fix for UC7001 (unknown type in @param)
            if (diagnostic.code === 'UC7001') {
                const importActions = generateImportTypeQuickFix(
                    diagnostic, document, params.textDocument.uri
                );
                codeActions.push(...importActions);
            }

            // Add JSDoc annotation quick fix for UC7003
            if (diagnostic.code === 'UC7003' && ast && cacheEntry?.result) {
                const diagOffset = document.offsetAt(diagnostic.range.start);
                const jsDocAction = generateJsDocQuickFix(ast, diagOffset, document, params.textDocument.uri, cacheEntry.result);
                if (jsDocAction) {
                    jsDocAction.diagnostics = [diagnostic];
                    codeActions.push(jsDocAction);
                }
            }

            // Check if line already has disable comment
            if (lineText.includes('// ucode-lsp disable')) {
                continue; // Skip if already has disable comment
            }

            // Only add one disable action per line
            if (!disableLines.has(line)) {
                disableLines.add(line);
                codeActions.push({
                    title: 'Disable ucode-lsp for this line',
                    kind: CodeActionKind.QuickFix,
                    diagnostics: [diagnostic],
                    edit: {
                        changes: {
                            [params.textDocument.uri]: [
                                TextEdit.insert(
                                    { line: line, character: lineText.length },
                                    ' // ucode-lsp disable'
                                )
                            ]
                        }
                    }
                });
            }
        }
    }

    return codeActions;
});

connection.onDefinition((params) => {
    // Convert cache format for definition handler
    const legacyCache = new Map<string, SemanticAnalysisResult>();
    for (const [uri, entry] of analysisCache.entries()) {
        legacyCache.set(uri, entry.result);
    }
    return handleDefinition(params, documents, legacyCache);
});

// --- Quick Fix helpers ---

interface EnclosingContext {
    inFunction: boolean;
    inLoop: boolean;
    inLoopHeader: boolean;
    /** Diagnostic is inside the test/condition of a control structure (if/while/for) */
    inCondition: boolean;
    /** Line number of the enclosing control structure whose condition contains the diagnostic */
    conditionOwnerLine: number;
    /** The enclosing control statement node (if/while/for) when diagnostic is in its body */
    enclosingControl: any | null;
    /** The body node of the enclosing control statement */
    enclosingControlBody: any | null;
    /** Line of the nearest enclosing statement. If this differs from the diagnostic line,
     *  the diagnostic is inside a multi-line expression (object literal, array, nested call, etc.)
     *  and guards must be inserted before this line instead. */
    enclosingStatementLine: number;
}

/**
 * Walk the AST top-down to determine if a position is inside a function body,
 * a loop body, or top-level code. When entering a nested function, loop context
 * is reset (continue inside a callback doesn't apply to the outer loop).
 */
function findEnclosingContext(ast: any, document: TextDocument, position: { line: number; character: number }): EnclosingContext {
    const result: EnclosingContext = {
        inFunction: false, inLoop: false, inLoopHeader: false,
        inCondition: false, conditionOwnerLine: -1,
        enclosingControl: null, enclosingControlBody: null,
        enclosingStatementLine: -1
    };
    if (!ast) return result;

    const offset = document.offsetAt(position);

    function walk(node: any, inFunc: boolean, inLoop: boolean, inLoopHeader: boolean, inCondition: boolean, condOwner: any | null): void {
        if (!node || typeof node !== 'object' || typeof node.start !== 'number') return;
        if (offset < node.start || offset > node.end) return;

        const isFunc = node.type === 'FunctionDeclaration' ||
                       node.type === 'FunctionExpression' ||
                       node.type === 'ArrowFunctionExpression';
        const isLoop = node.type === 'ForStatement' ||
                       node.type === 'ForInStatement' ||
                       node.type === 'WhileStatement' ||
                       node.type === 'DoWhileStatement';
        const isControl = isLoop || node.type === 'IfStatement';

        const newInFunc = isFunc || inFunc;
        // Reset loop flag when entering nested function
        const newInLoop = isFunc ? false : (isLoop || inLoop);

        result.inFunction = newInFunc;
        result.inLoop = newInLoop;
        result.inLoopHeader = inLoopHeader;
        result.inCondition = inCondition;
        if (condOwner) {
            result.conditionOwnerLine = document.positionAt(condOwner.start).line;
        }

        // Track enclosing control structure for body-position diagnostics
        if (isControl) {
            const bodyNode = node.type === 'IfStatement' ? node.consequent : node.body;
            if (bodyNode && offset >= bodyNode.start && offset <= bodyNode.end) {
                result.enclosingControl = node;
                result.enclosingControlBody = bodyNode;
            }
        }

        // Track the nearest enclosing statement — if the diagnostic is on a different
        // line than its enclosing statement, guards must be inserted before the statement.
        const isStatement = node.type === 'ExpressionStatement' ||
            node.type === 'ReturnStatement' ||
            node.type === 'VariableDeclaration' ||
            node.type === 'IfStatement' ||
            node.type === 'WhileStatement' ||
            node.type === 'ForStatement' ||
            node.type === 'ForInStatement' ||
            node.type === 'DoWhileStatement' ||
            node.type === 'SwitchStatement' ||
            node.type === 'TryStatement' ||
            node.type === 'ThrowStatement' ||
            node.type === 'BreakStatement' ||
            node.type === 'ContinueStatement';
        if (isStatement) {
            result.enclosingStatementLine = document.positionAt(node.start).line;
        }

        // Visit all child nodes
        for (const key of Object.keys(node)) {
            if (key === 'type' || key === 'start' || key === 'end') continue;
            const val = node[key];
            // Only set inLoop for the loop body, not the header (init/test/update/right).
            const isHeader = isLoop && key !== 'body';
            const childInLoop = isHeader ? inLoop : newInLoop;
            const childInLoopHeader = isHeader ? true : (isLoop && key === 'body' ? false : inLoopHeader);
            // Track condition position for ALL control structures (if/while/for)
            const isCondKey = (isControl && key === 'test') ||
                              (isLoop && (key === 'init' || key === 'update' || key === 'right'));
            const childInCondition = isCondKey ? true : (isControl && (key === 'body' || key === 'consequent' || key === 'alternate') ? false : inCondition);
            const childCondOwner = isCondKey ? node : (isControl && !isCondKey ? null : condOwner);
            if (Array.isArray(val)) {
                for (const item of val) {
                    if (item && typeof item === 'object' && typeof item.start === 'number') {
                        walk(item, newInFunc, childInLoop, childInLoopHeader, childInCondition, childCondOwner);
                    }
                }
            } else if (val && typeof val === 'object' && typeof val.start === 'number') {
                walk(val, newInFunc, childInLoop, childInLoopHeader, childInCondition, childCondOwner);
            }
        }
    }

    walk(ast, false, false, false, false, null);
    return result;
}

/**
 * Check if a guard condition already exists above the diagnostic line.
 * Looks for `if (guardCondition) return/continue;` in the preceding code.
 */
function guardAlreadyExists(document: TextDocument, beforeLine: number, guardCondition: string): boolean {
    for (let i = Math.max(0, beforeLine - 50); i < beforeLine; i++) {
        const lineText = document.getText({
            start: { line: i, character: 0 },
            end: { line: i + 1, character: 0 }
        });
        if (lineText.includes(guardCondition)) {
            // Check if this line or the next has return/continue (handles multi-line guards)
            const nextLine = i + 1 < beforeLine ? document.getText({
                start: { line: i + 1, character: 0 },
                end: { line: i + 2, character: 0 }
            }) : '';
            if (/\b(return|continue)\b/.test(lineText) || /\b(return|continue)\b/.test(nextLine)) {
                return true;
            }
        }
    }
    return false;
}

/** Check whether the diagnostic is about null in a union (vs a wrong-type problem) */
function isNullProblem(data: any): boolean {
    if (!data.actualType) return true;
    const actualStr = typeof data.actualType === 'string' ? data.actualType : '';
    const types = actualStr.split(' | ').map((t: string) => t.trim());
    return types.includes('null');
}

/**
 * Parse a one-liner control structure into prefix and body.
 * Handles: else if (...) body; | else body; | for (...) body; | while (...) body; | if (...) body;
 * e.g. "    else if (x) doStuff();" → { indent: "    ", prefix: "else if (x)", body: "doStuff();" }
 */
function parseOneLinerControl(lineText: string): { indent: string; prefix: string; body: string } | null {
    const indent = lineText.match(/^(\s*)/)?.[1] || '';
    const trimmed = lineText.trimStart();

    // Keywords that use parenthesised conditions
    const parenKeywords = ['else if', 'for', 'while', 'if'];

    for (const kw of parenKeywords) {
        if (!trimmed.startsWith(kw)) continue;
        // Ensure it's a keyword boundary (not a prefix of a longer word)
        const after = trimmed[kw.length];
        if (after && after !== ' ' && after !== '\t' && after !== '(') continue;

        const parenStart = trimmed.indexOf('(', kw.length);
        if (parenStart === -1) continue;
        let depth = 0;
        let parenEnd = -1;
        for (let i = parenStart; i < trimmed.length; i++) {
            if (trimmed[i] === '(') depth++;
            else if (trimmed[i] === ')') { depth--; if (depth === 0) { parenEnd = i; break; } }
        }
        if (parenEnd === -1) continue;
        const prefix = trimmed.substring(0, parenEnd + 1);
        const rest = trimmed.substring(parenEnd + 1).trim();
        if (rest.startsWith('{') || !rest) return null; // already a block or empty
        return { indent, prefix, body: rest };
    }

    // Plain else (no condition)
    if (trimmed.startsWith('else')) {
        const rest = trimmed.substring(4).trim();
        if (rest.startsWith('{') || rest.startsWith('if') || !rest) return null;
        return { indent, prefix: 'else', body: rest };
    }

    return null;
}

/**
 * Check if the diagnostic is on the body of a braceless control structure
 * that spans multiple lines (body on the next line).
 * e.g.:
 *     for (let x in items)
 *         push(arr, x);       ← diagnostic here
 */
function findBracelessParent(
    document: TextDocument, line: number
): { parentIndent: string; prefix: string; parentLine: number } | null {
    for (let prevLine = line - 1; prevLine >= Math.max(0, line - 3); prevLine--) {
        const prevText = document.getText({
            start: { line: prevLine, character: 0 },
            end: { line: prevLine + 1, character: 0 }
        }).replace(/\r?\n$/, '');

        const trimmed = prevText.trim();
        if (!trimmed) continue; // skip empty lines

        // Check for control structure ending with ) and no {
        const parenKeywords = ['for', 'while', 'if', 'else if'];
        for (const kw of parenKeywords) {
            if (!trimmed.startsWith(kw)) continue;
            const after = trimmed[kw.length];
            if (after && after !== ' ' && after !== '\t' && after !== '(') continue;
            // Verify it ends with ) (no opening brace)
            if (trimmed.endsWith(')')) {
                const parentIndent = prevText.match(/^(\s*)/)?.[1] || '';
                return { parentIndent, prefix: trimmed, parentLine: prevLine };
            }
        }
        // Plain else without brace
        if (trimmed === 'else') {
            const parentIndent = prevText.match(/^(\s*)/)?.[1] || '';
            return { parentIndent, prefix: 'else', parentLine: prevLine };
        }
        break; // found a non-empty line that's not a braceless control structure
    }
    return null;
}

/** Create a code action that inserts text before a given line */
function makeInsertBeforeAction(
    title: string, insertText: string, line: number,
    uri: string, diagnostic: any, document?: TextDocument
): CodeAction {
    if (document) {
        // Use a replace of the target line (prepending the guard) instead of a bare insert.
        // A bare TextEdit.insert at {line, 0} causes VS Code to misplace the viewport
        // on undo (CMD+Z). Replacing the line keeps the undo anchored correctly.
        const origLine = document.getText({
            start: { line, character: 0 },
            end: { line: line + 1, character: 0 }
        });
        return {
            title,
            kind: CodeActionKind.QuickFix,
            diagnostics: [diagnostic],
            edit: {
                changes: {
                    [uri]: [TextEdit.replace(
                        { start: { line, character: 0 }, end: { line: line + 1, character: 0 } },
                        insertText + origLine
                    )]
                }
            }
        };
    }
    return {
        title,
        kind: CodeActionKind.QuickFix,
        diagnostics: [diagnostic],
        edit: {
            changes: {
                [uri]: [TextEdit.insert({ line, character: 0 }, insertText)]
            }
        }
    };
}

/** Create a code action that replaces a full line */
function makeReplaceLineAction(
    title: string, newText: string, line: number, lineLength: number,
    uri: string, diagnostic: any
): CodeAction {
    return {
        title,
        kind: CodeActionKind.QuickFix,
        diagnostics: [diagnostic],
        edit: {
            changes: {
                [uri]: [TextEdit.replace(
                    { start: { line, character: 0 }, end: { line, character: lineLength } },
                    newText
                )]
            }
        }
    };
}

/** Replace an expression at a specific character position in a string, not just the first match */
function replaceAt(text: string, search: string, replacement: string, charPos: number): string {
    const idx = text.indexOf(search, charPos);
    if (idx === -1) return text.replace(search, replacement); // fallback to first match
    return text.substring(0, idx) + replacement + text.substring(idx + search.length);
}

/** Create a code action that replaces a range of lines (startLine..endLine inclusive) */
function makeReplaceRangeAction(
    title: string, newText: string,
    startLine: number, endLine: number, endLineLength: number,
    uri: string, diagnostic: any
): CodeAction {
    return {
        title,
        kind: CodeActionKind.QuickFix,
        diagnostics: [diagnostic],
        edit: {
            changes: {
                [uri]: [TextEdit.replace(
                    { start: { line: startLine, character: 0 }, end: { line: endLine, character: endLineLength } },
                    newText
                )]
            }
        }
    };
}

// Generate JSDoc annotation quick fix for functions with unknown-typed parameters
function generateJsDocQuickFix(
    ast: any, cursorOffset: number, document: TextDocument, uri: string,
    analysisResult: SemanticAnalysisResult
): CodeAction | null {
    // Walk AST to find function declarations/expressions containing cursor
    const funcNode = findFunctionAtOffset(ast, cursorOffset);
    if (!funcNode) return null;
    if (!funcNode.params || funcNode.params.length === 0) return null;
    if (funcNode.leadingJsDoc) return null; // Already has JSDoc

    // Check if any params are unknown-typed
    const symbolTable = analysisResult.symbolTable;
    const unknownParams: string[] = [];
    for (const param of funcNode.params) {
        const sym = symbolTable.lookupAtPosition ? symbolTable.lookupAtPosition(param.name, param.start) : symbolTable.lookup(param.name);
        if (!sym || sym.dataType === 'unknown') {
            unknownParams.push(param.name);
        }
    }
    if (unknownParams.length === 0) return null;

    // Build JSDoc comment text
    const funcStartPos = document.positionAt(funcNode.start);
    const funcLine = funcStartPos.line;
    const indentText = document.getText({
        start: { line: funcLine, character: 0 },
        end: { line: funcLine, character: funcStartPos.character }
    });

    const jsDocLines = [`${indentText}/**`];
    for (const paramName of funcNode.params.map((p: any) => p.name)) {
        jsDocLines.push(`${indentText} * @param {unknown} ${paramName}`);
    }
    jsDocLines.push(`${indentText} */`);
    const finalJsDoc = jsDocLines.join('\n') + '\n';

    return {
        title: `Add JSDoc type annotations for ${unknownParams.length} parameter${unknownParams.length > 1 ? 's' : ''}`,
        kind: CodeActionKind.QuickFix,
        edit: {
            changes: {
                [uri]: [TextEdit.insert(
                    { line: funcLine, character: 0 },
                    finalJsDoc
                )]
            }
        }
    };
}

// Walk AST to find the innermost function declaration/expression containing the given offset
function findFunctionAtOffset(node: any, offset: number): any | null {
    if (!node || typeof node !== 'object') return null;
    if (node.start > offset || node.end < offset) return null;

    // Check if this node is a function
    const isFunctionNode = node.type === 'FunctionDeclaration' ||
                           node.type === 'FunctionExpression' ||
                           node.type === 'ArrowFunctionExpression';

    let deepest: any | null = isFunctionNode ? node : null;

    // Recurse into children
    for (const key of Object.keys(node)) {
        if (key === 'leadingJsDoc') continue;
        const child = node[key];
        if (Array.isArray(child)) {
            for (const item of child) {
                if (item && typeof item === 'object' && 'type' in item) {
                    const found = findFunctionAtOffset(item, offset);
                    if (found) deepest = found;
                }
            }
        } else if (child && typeof child === 'object' && 'type' in child) {
            const found = findFunctionAtOffset(child, offset);
            if (found) deepest = found;
        }
    }

    return deepest;
}

/**
 * Generate quick fix for UC7001 (unknown type in @param annotation).
 * If the unknown type name matches a resolvable module, offer import() replacement.
 */
function generateImportTypeQuickFix(
    diagnostic: any, document: TextDocument, uri: string
): CodeAction[] {
    const actions: CodeAction[] = [];

    // Extract type name from message: "Unknown type 'xxx' in @param annotation"
    const typeMatch = /Unknown type '([^']+)'/.exec(diagnostic.message);
    if (!typeMatch) return actions;
    const typeName = typeMatch[1]!;

    // Find the {typeName} in the JSDoc comment to get exact replacement range
    // The diagnostic range covers the JSDoc comment
    const diagStartOffset = document.offsetAt(diagnostic.range.start);
    const commentText = document.getText({
        start: diagnostic.range.start,
        end: diagnostic.range.end
    });

    // Find {typeName} in the comment text
    const bracePattern = new RegExp(`\\{${typeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}`);
    const braceMatch = bracePattern.exec(commentText);
    if (!braceMatch) return actions;

    const replaceStart = document.positionAt(diagStartOffset + braceMatch.index + 1); // +1 to skip {
    const replaceEnd = document.positionAt(diagStartOffset + braceMatch.index + braceMatch[0].length - 1); // -1 to skip }

    // Try to resolve as a module file
    const workspaceRoot = workspaceFolders.length > 0 ? workspaceFolders[0]! : path.dirname(uri.replace('file://', ''));
    const fileResolver = new FileResolver(workspaceRoot);
    const resolvedUri = fileResolver.resolveImportPath(typeName, uri);

    if (resolvedUri && resolvedUri.startsWith('file://')) {
        // Module found — offer import() replacement
        // Get the module's exports to offer property-specific replacements
        const exportInfo = fileResolver.getDefaultExportPropertyTypes(resolvedUri);
        if (exportInfo?.propertyTypes && exportInfo.propertyTypes.size > 0) {
            // Offer import('module').property for each exported property
            for (const [propName, propType] of exportInfo.propertyTypes) {
                const typeStr = typeof propType === 'string' ? propType : 'object';
                actions.push({
                    title: `Replace with import('${typeName}').${propName} (${typeStr})`,
                    kind: CodeActionKind.QuickFix,
                    diagnostics: [diagnostic],
                    edit: {
                        changes: {
                            [uri]: [TextEdit.replace(
                                { start: replaceStart, end: replaceEnd },
                                `import('${typeName}').${propName}`
                            )]
                        }
                    }
                });
            }
        }

        // Always offer the bare import('module') option
        actions.push({
            title: `Replace with import('${typeName}')`,
            kind: CodeActionKind.QuickFix,
            diagnostics: [diagnostic],
            edit: {
                changes: {
                    [uri]: [TextEdit.replace(
                        { start: replaceStart, end: replaceEnd },
                        `import('${typeName}')`
                    )]
                }
            }
        });
    }

    return actions;
}

// Generate quick fixes for type narrowing diagnostics
function generateTypeNarrowingQuickFixes(
    diagnostic: any, document: TextDocument, uri: string, lineText: string, ast?: any
): CodeAction[] {
    const actions: CodeAction[] = [];

    if (!diagnostic.code || !diagnostic.data) {
        return actions;
    }

    const { code, data } = diagnostic;
    const line = diagnostic.range.start.line;
    const indent = lineText.match(/^(\s*)/)?.[1] || '';
    const trimmedContent = lineText.trim();
    const lineLength = lineText.length;

    // Determine enclosing context
    const ctx = findEnclosingContext(ast, document, diagnostic.range.start);

    const varName: string | null = data.variableName || null;
    const expectedType: string = data.expectedType || data.expectedTypes?.[0] || '';

    // If the diagnostic is on a different line than its enclosing statement,
    // it's inside a multi-line expression (object literal, array, nested call, etc.)
    // and guards must be inserted before the statement, not before the diagnostic line.
    const stmtLine = ctx.enclosingStatementLine;
    const needsStatementRedirect = stmtLine >= 0 && stmtLine < line;

    // --- AST-aware structure detection ---
    // If the diagnostic is in the condition of a control structure (if/while/for),
    // the guard must go BEFORE the control structure, not inside its body.
    // If the diagnostic is in the body of a braceless control structure,
    // the body must be expanded to a block to insert the guard.
    const oneLiner = ctx.inCondition ? null : parseOneLinerControl(lineText);
    const bracelessParent = !oneLiner && !ctx.inCondition ? findBracelessParent(document, line) : null;
    // AST-based: check if the body of the enclosing control structure is not a block.
    // This covers both same-line (one-liner) and next-line braceless bodies.
    const bodyNeedsBlock = ctx.enclosingControlBody != null &&
        ctx.enclosingControlBody.type !== 'BlockStatement';
    const needsBlockExpansion = !ctx.inCondition && (bodyNeedsBlock || !!(oneLiner || bracelessParent));
    const nullish = isNullProblem(data);

    // Handle all three diagnostic codes uniformly
    if (code !== 'nullable-argument' && code !== 'incompatible-function-argument' && code !== 'nullable-in-operator') {
        return actions;
    }

    // Check if the line declares a variable that is used later (wrapping would
    // scope it inside the if-block, making it inaccessible afterwards).
    const declaredVar = trimmedContent.match(/^(?:let|const)\s+(\w+)\s*=/)?.[1];
    const varUsedLater = declaredVar ? isVariableUsedAfterLine(document, line, declaredVar) : false;

    if (varName) {
        // === SIMPLE IDENTIFIER ===

        // Check if the variable is declared on the same line before the diagnostic.
        // This happens in one-liner functions: function f(x) { let _p = foo(x); return bar(_p); }
        // or when the variable is a parameter: function f(iface) { return index(iface, 'x'); }
        // In that case, "insert before line" would place the guard outside the function.
        // Instead, insert inline after the declaration or function body opening brace.
        const escapedName = varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const diagChar = diagnostic.range.start.character;
        let inlineDeclPos: number | null = null;

        // Case 1: let/const/var declaration on the same line before the diagnostic
        const declRegex = new RegExp(`(?:let|const|var)\\s+${escapedName}\\s*=[^;]*;`);
        const declMatch = lineText.match(declRegex);
        if (declMatch && declMatch.index != null && declMatch.index + declMatch[0].length <= diagChar) {
            inlineDeclPos = declMatch.index + declMatch[0].length;
        }

        // Case 2: variable is a function parameter and the function body is on the same line
        // e.g. function foo(iface) { return index(iface, 'x'); }
        if (inlineDeclPos == null) {
            const paramRegex = new RegExp(`function\\s+\\w*\\s*\\([^)]*\\b${escapedName}\\b[^)]*\\)\\s*\\{`);
            const paramMatch = lineText.match(paramRegex);
            if (paramMatch && paramMatch.index != null && paramMatch.index + paramMatch[0].length <= diagChar) {
                inlineDeclPos = paramMatch.index + paramMatch[0].length;
            }
        }

        if (nullish) {
            const guardCond = `${varName} == null`;
            const wrapCond = `${varName} != null`;
            const guardLabel = 'Add null guard';
            const wrapLabel = 'Wrap in null guard';

            // Skip if this exact guard already exists above
            if (guardAlreadyExists(document, line, guardCond)) {
                return actions;
            }

            const keyword = ctx.inLoop ? 'continue' : 'return';
            if (needsStatementRedirect) {
                const tl = stmtLine;
                const tlText = document.getText({ start: { line: tl, character: 0 }, end: { line: tl + 1, character: 0 } }).replace(/\r?\n$/, '');
                const tlIndent = tlText.match(/^(\s*)/)?.[1] || '';
                actions.push(makeInsertBeforeAction(guardLabel,
                    `${tlIndent}if (${guardCond})\n${tlIndent}\treturn;\n`, tl, uri, diagnostic, document));
            } else if (ctx.inCondition) {
                // Diagnostic is in the condition of a control structure (if/while/for).
                // Guard must go BEFORE the entire control structure.
                const targetLine = ctx.conditionOwnerLine >= 0 ? ctx.conditionOwnerLine : line;
                const targetLineText = document.getText({ start: { line: targetLine, character: 0 }, end: { line: targetLine + 1, character: 0 } }).replace(/\r?\n$/, '');
                const targetIndent = targetLineText.match(/^(\s*)/)?.[1] || '';
                actions.push(makeInsertBeforeAction(guardLabel,
                    `${targetIndent}if (${guardCond})\n${targetIndent}\t${keyword};\n`, targetLine, uri, diagnostic, document));
            } else if (inlineDeclPos != null) {
                actions.push({
                    title: guardLabel,
                    kind: CodeActionKind.QuickFix,
                    diagnostics: [diagnostic],
                    edit: { changes: { [uri]: [TextEdit.insert({ line, character: inlineDeclPos }, ` if (${guardCond}) ${keyword};`)] } }
                });
            } else if (oneLiner) {
                actions.push(makeReplaceLineAction(
                    guardLabel,
                    `${oneLiner.indent}${oneLiner.prefix} {\n${oneLiner.indent}\tif (${guardCond}) ${keyword};\n${oneLiner.indent}\t${oneLiner.body}\n${oneLiner.indent}}`,
                    line, lineLength, uri, diagnostic
                ));
            } else if (bracelessParent) {
                const bp = bracelessParent;
                actions.push(makeReplaceRangeAction(
                    guardLabel,
                    `${bp.parentIndent}${bp.prefix} {\n${indent}if (${guardCond}) ${keyword};\n${lineText}\n${bp.parentIndent}}`,
                    bp.parentLine, line, lineLength, uri, diagnostic
                ));
            } else if (ctx.inLoop) {
                actions.push(makeInsertBeforeAction(guardLabel,
                    `${indent}if (${guardCond})\n${indent}\tcontinue;\n`, line, uri, diagnostic, document));
            } else if (ctx.inFunction) {
                actions.push(makeInsertBeforeAction(guardLabel,
                    `${indent}if (${guardCond})\n${indent}\treturn;\n`, line, uri, diagnostic, document));
            }

            if (!needsStatementRedirect && !varUsedLater && !ctx.inLoopHeader && !needsBlockExpansion && inlineDeclPos == null) {
                actions.push(makeReplaceLineAction(
                    wrapLabel,
                    `${indent}if (${wrapCond}) {\n${indent}\t${trimmedContent}\n${indent}}`,
                    line, lineLength, uri, diagnostic
                ));
            }
        } else {
            // Type mismatch (not null)
            // Filter out "null" — type(x) never returns "null" in ucode, so it can't be used in a type guard.
            // e.g. expected "object | null" → guard only on "object".
            let expectedTypes: string[] = (data.expectedTypes || expectedType.split(' | ').map((s: string) => s.trim()))
                .filter((t: string) => t !== 'null');
            if (expectedTypes.length === 0) return actions;

            // Tighten the expected types by looking at all downstream usages of the variable.
            // e.g. length(x) expects string|array|object, but join('\n', x) expects array →
            // intersect to just array, producing a single clean guard.
            if (ast && varName) {
                const diagOffset = document.offsetAt(diagnostic.range.start);
                const tighter = findTightestTypeConstraint(ast, varName, diagOffset, expectedTypes);
                if (tighter) expectedTypes = tighter;
            }

            const isUnionExpected = expectedTypes.length > 1;

            const earlyReturnGuard = isUnionExpected
                ? expectedTypes.map((t: string) => `type(${varName}) != "${t}"`).join(' && ')
                : `type(${varName}) != "${expectedTypes[0]}"`;
            const wrapGuard = isUnionExpected
                ? expectedTypes.map((t: string) => `type(${varName}) == "${t}"`).join(' || ')
                : `type(${varName}) == "${expectedTypes[0]}"`;

            // Skip if this exact guard already exists above
            if (guardAlreadyExists(document, line, earlyReturnGuard)) {
                return actions;
            }

            const keyword2 = ctx.inLoop ? 'continue' : 'return';
            if (needsStatementRedirect) {
                const tl = stmtLine;
                const tlText = document.getText({ start: { line: tl, character: 0 }, end: { line: tl + 1, character: 0 } }).replace(/\r?\n$/, '');
                const tlIndent = tlText.match(/^(\s*)/)?.[1] || '';
                actions.push(makeInsertBeforeAction(`Add type guard`,
                    `${tlIndent}if (${earlyReturnGuard})\n${tlIndent}\treturn;\n`, tl, uri, diagnostic, document));
            } else if (ctx.inCondition) {
                const targetLine = ctx.conditionOwnerLine >= 0 ? ctx.conditionOwnerLine : line;
                const targetLineText = document.getText({ start: { line: targetLine, character: 0 }, end: { line: targetLine + 1, character: 0 } }).replace(/\r?\n$/, '');
                const targetIndent = targetLineText.match(/^(\s*)/)?.[1] || '';
                actions.push(makeInsertBeforeAction(`Add type guard`,
                    `${targetIndent}if (${earlyReturnGuard})\n${targetIndent}\t${keyword2};\n`, targetLine, uri, diagnostic, document));
            } else if (inlineDeclPos != null) {
                actions.push({
                    title: `Add type guard`,
                    kind: CodeActionKind.QuickFix,
                    diagnostics: [diagnostic],
                    edit: { changes: { [uri]: [TextEdit.insert({ line, character: inlineDeclPos }, ` if (${earlyReturnGuard}) ${keyword2};`)] } }
                });
            } else if (oneLiner) {
                actions.push(makeReplaceLineAction(
                    `Add type guard`,
                    `${oneLiner.indent}${oneLiner.prefix} {\n${oneLiner.indent}\tif (${earlyReturnGuard}) ${keyword2};\n${oneLiner.indent}\t${oneLiner.body}\n${oneLiner.indent}}`,
                    line, lineLength, uri, diagnostic
                ));
            } else if (bracelessParent) {
                const bp = bracelessParent;
                actions.push(makeReplaceRangeAction(
                    `Add type guard`,
                    `${bp.parentIndent}${bp.prefix} {\n${indent}if (${earlyReturnGuard}) ${keyword2};\n${lineText}\n${bp.parentIndent}}`,
                    bp.parentLine, line, lineLength, uri, diagnostic
                ));
            } else if (ctx.inLoop) {
                actions.push(makeInsertBeforeAction(`Add type guard`,
                    `${indent}if (${earlyReturnGuard})\n${indent}\tcontinue;\n`, line, uri, diagnostic, document));
            } else if (ctx.inFunction) {
                actions.push(makeInsertBeforeAction(`Add type guard`,
                    `${indent}if (${earlyReturnGuard})\n${indent}\treturn;\n`, line, uri, diagnostic, document));
            }

            // "Type guard with default" — when the arg is `expr || fallback`,
            // extract expr, guard its type, assign fallback if wrong type, then use it.
            // e.g. int(s.timeout || '600') →
            //   let _val = s.timeout;
            //   if (type(_val) != "string" && ...) _val = '600';
            //   let timeout = int(_val);
            if (data.fallbackStart != null && data.fullExprStart != null) {
                const leftExprText = varName || document.getText(diagnostic.range).trim();
                const fallbackText = document.getText({
                    start: document.positionAt(data.fallbackStart),
                    end: document.positionAt(data.fallbackEnd)
                });
                const fullExprText = document.getText({
                    start: document.positionAt(data.fullExprStart),
                    end: document.positionAt(data.fullExprEnd)
                });
                const vn = uniqueValName(document, line);
                const guardCond = isUnionExpected
                    ? expectedTypes.map((t: string) => `type(${vn}) != "${t}"`).join(' && ')
                    : `type(${vn}) != "${expectedTypes[0]}"`;
                const fullExprCharPos = document.positionAt(data.fullExprStart).character;
                const replacedLine = replaceAt(lineText, fullExprText, vn, fullExprCharPos);
                if (replacedLine !== lineText) {
                    if (needsStatementRedirect) {
                        // Insert extraction + guard before the statement containing the object literal
                        const tl = stmtLine;
                        const tlText = document.getText({ start: { line: tl, character: 0 }, end: { line: tl + 1, character: 0 } }).replace(/\r?\n$/, '');
                        const tlIndent = tlText.match(/^(\s*)/)?.[1] || '';
                        actions.push({
                            title: `Add type guard with default`,
                            kind: CodeActionKind.QuickFix,
                            diagnostics: [diagnostic],
                            edit: {
                                changes: {
                                    [uri]: [
                                        TextEdit.insert({ line: tl, character: 0 },
                                            `${tlIndent}let ${vn} = ${leftExprText};\n${tlIndent}if (${guardCond})\n${tlIndent}\t${vn} = ${fallbackText};\n`),
                                        TextEdit.replace(
                                            { start: { line, character: 0 }, end: { line, character: lineLength } },
                                            replacedLine
                                        )
                                    ]
                                }
                            }
                        });
                    } else {
                        actions.push(makeReplaceLineAction(
                            `Add type guard with default`,
                            `${indent}let ${vn} = ${leftExprText};\n${indent}if (${guardCond})\n${indent}\t${vn} = ${fallbackText};\n${replacedLine}`,
                            line, lineLength, uri, diagnostic
                        ));
                    }
                }
            }

            if (!needsStatementRedirect && !varUsedLater && !ctx.inLoopHeader && !needsBlockExpansion && inlineDeclPos == null) {
                actions.push(makeReplaceLineAction(
                    `Wrap in type guard`,
                    `${indent}if (${wrapGuard}) {\n${indent}\t${trimmedContent}\n${indent}}`,
                    line, lineLength, uri, diagnostic
                ));
            }
        }
    } else if (!ctx.inLoopHeader) {
        // === COMPLEX EXPRESSION (no variable name) ===
        // Skip extract-and-replace actions in loop headers — replacing the for-in
        // line would break the loop structure.
        const exprText = document.getText(diagnostic.range);
        if (!exprText) return actions;

        // For function call expressions like keys(env.netifd_mark) whose result is nullable,
        // trace through the AST to find the inner argument that needs a type guard.
        if (!needsBlockExpansion && ast && data.argumentOffset != null) {
            const innerInfo = findInnerGuardTarget(ast, data.argumentOffset);
            if (innerInfo) {
                const innerExpectedTypes = innerInfo.expectedTypes.filter((t: string) => t !== 'null');
                if (innerExpectedTypes.length === 0) return actions;
                const innerIsUnion = innerExpectedTypes.length > 1;
                const innerExpected = innerExpectedTypes.join(' | ');
                const innerEarlyGuard = innerIsUnion
                    ? innerExpectedTypes.map((t: string) => `type(${innerInfo.varName}) != "${t}"`).join(' && ')
                    : `type(${innerInfo.varName}) != "${innerExpected}"`;

                // Skip if this exact guard already exists above — fall through to extract-to-variable
                if (!guardAlreadyExists(document, line, innerEarlyGuard)) {
                    if (needsStatementRedirect) {
                        const tl = stmtLine;
                        const tlText = document.getText({ start: { line: tl, character: 0 }, end: { line: tl + 1, character: 0 } }).replace(/\r?\n$/, '');
                        const tlIndent = tlText.match(/^(\s*)/)?.[1] || '';
                        actions.push(makeInsertBeforeAction(`Add type guard`,
                            `${tlIndent}if (${innerEarlyGuard})\n${tlIndent}\treturn;\n`, tl, uri, diagnostic, document));
                    } else if (ctx.inCondition) {
                        const targetLine = ctx.conditionOwnerLine >= 0 ? ctx.conditionOwnerLine : line;
                        const targetLineText = document.getText({ start: { line: targetLine, character: 0 }, end: { line: targetLine + 1, character: 0 } }).replace(/\r?\n$/, '');
                        const targetIndent = targetLineText.match(/^(\s*)/)?.[1] || '';
                        const kw2 = ctx.inLoop ? 'continue' : 'return';
                        actions.push(makeInsertBeforeAction(`Add type guard`,
                            `${targetIndent}if (${innerEarlyGuard})\n${targetIndent}\t${kw2};\n`, targetLine, uri, diagnostic, document));
                    } else if (ctx.inLoop) {
                        actions.push(makeInsertBeforeAction(`Add type guard`,
                            `${indent}if (${innerEarlyGuard})\n${indent}\tcontinue;\n`, line, uri, diagnostic, document));
                    } else if (ctx.inFunction) {
                        actions.push(makeInsertBeforeAction(`Add type guard`,
                            `${indent}if (${innerEarlyGuard})\n${indent}\treturn;\n`, line, uri, diagnostic, document));
                    }
                    return actions;
                }
                // Guard already exists — fall through to extract-to-variable path
            }
        }

        const vn = uniqueValName(document, line);
        const kw = ctx.inLoop ? 'continue' : 'return';

        // Build guard condition (filter out "null" — type(x) never returns "null")
        const exExpectedTypes: string[] = (data.expectedTypes || expectedType.split(' | ').map((s: string) => s.trim()))
            .filter((t: string) => t !== 'null');
        if (!nullish && exExpectedTypes.length === 0) return actions;
        const exIsUnion = exExpectedTypes.length > 1;
        const exEarlyGuard = nullish
            ? `${vn} == null`
            : (exIsUnion
                ? exExpectedTypes.map((t: string) => `type(${vn}) != "${t}"`).join(' && ')
                : `type(${vn}) != "${expectedType}"`);
        const actionLabel = nullish ? 'Extract to variable and add null guard' : 'Extract to variable and add type guard';

        // Replace the expression at the diagnostic position, not the first match on the line.
        const exprCharPos = diagnostic.range.start.character;

        if (needsStatementRedirect) {
            // Extract before the statement containing the object literal
            const tl = stmtLine;
            const tlText = document.getText({ start: { line: tl, character: 0 }, end: { line: tl + 1, character: 0 } }).replace(/\r?\n$/, '');
            const tlIndent = tlText.match(/^(\s*)/)?.[1] || '';
            // If there's a || fallback, replace the full expression (not just left side)
            // and use the fallback in the type guard default instead
            let replaceExpr = exprText;
            let replaceCharPos = exprCharPos;
            if (data.fullExprStart != null && data.fullExprEnd != null) {
                replaceExpr = document.getText({
                    start: document.positionAt(data.fullExprStart),
                    end: document.positionAt(data.fullExprEnd)
                });
                replaceCharPos = document.positionAt(data.fullExprStart).character;
            }
            const replaced = replaceAt(lineText, replaceExpr, vn, replaceCharPos);
            if (replaced !== lineText) {
                // If fallback exists, offer "type guard with default" instead of early return
                if (data.fallbackStart != null) {
                    const fallbackText = document.getText({
                        start: document.positionAt(data.fallbackStart),
                        end: document.positionAt(data.fallbackEnd)
                    });
                    const defaultGuardCond = nullish ? `${vn} == null`
                        : (exIsUnion
                            ? exExpectedTypes.map((t: string) => `type(${vn}) != "${t}"`).join(' && ')
                            : `type(${vn}) != "${expectedType}"`);
                    actions.push({
                        title: `Add type guard with default`,
                        kind: CodeActionKind.QuickFix,
                        diagnostics: [diagnostic],
                        edit: {
                            changes: {
                                [uri]: [
                                    TextEdit.insert({ line: tl, character: 0 },
                                        `${tlIndent}let ${vn} = ${exprText};\n${tlIndent}if (${defaultGuardCond})\n${tlIndent}\t${vn} = ${fallbackText};\n`),
                                    TextEdit.replace(
                                        { start: { line, character: 0 }, end: { line, character: lineLength } },
                                        replaced
                                    )
                                ]
                            }
                        }
                    });
                }
                // Also offer extract + early return
                actions.push({
                    title: actionLabel,
                    kind: CodeActionKind.QuickFix,
                    diagnostics: [diagnostic],
                    edit: {
                        changes: {
                            [uri]: [
                                TextEdit.insert({ line: tl, character: 0 },
                                    `${tlIndent}let ${vn} = ${exprText};\n${tlIndent}if (${exEarlyGuard})\n${tlIndent}\treturn;\n`),
                                TextEdit.replace(
                                    { start: { line, character: 0 }, end: { line, character: lineLength } },
                                    replaced
                                )
                            ]
                        }
                    }
                });
            }
        } else if (oneLiner) {
            // In the one-liner body, offset by the prefix position on the line
            const bodyStart = lineText.indexOf(oneLiner.body);
            const replacedBody = replaceAt(oneLiner.body, exprText, vn, exprCharPos - (bodyStart >= 0 ? bodyStart : 0));
            if (replacedBody !== oneLiner.body) {
                actions.push(makeReplaceLineAction(actionLabel,
                    `${oneLiner.indent}${oneLiner.prefix} {\n${oneLiner.indent}\tlet ${vn} = ${exprText};\n${oneLiner.indent}\tif (${exEarlyGuard}) ${kw};\n${oneLiner.indent}\t${replacedBody}\n${oneLiner.indent}}`,
                    line, lineLength, uri, diagnostic));
            }
        } else if (bracelessParent) {
            const bp = bracelessParent;
            const replacedLine = replaceAt(lineText, exprText, vn, exprCharPos);
            if (replacedLine !== lineText) {
                actions.push(makeReplaceRangeAction(actionLabel,
                    `${bp.parentIndent}${bp.prefix} {\n${indent}let ${vn} = ${exprText};\n${indent}if (${exEarlyGuard}) ${kw};\n${replacedLine}\n${bp.parentIndent}}`,
                    bp.parentLine, line, lineLength, uri, diagnostic));
            }
        } else if (ctx.inLoop || ctx.inFunction) {
            const replaced = replaceAt(lineText, exprText, vn, exprCharPos);
            if (replaced !== lineText) {
                actions.push(makeReplaceLineAction(actionLabel,
                    `${indent}let ${vn} = ${exprText};\n${indent}if (${exEarlyGuard})\n${indent}\t${kw};\n${replaced}`,
                    line, lineLength, uri, diagnostic));
            }
        } else {
            const replaced = replaceAt(lineText, exprText, vn, exprCharPos);
            if (replaced !== lineText) {
                const wrapCond = nullish
                    ? `${vn} != null`
                    : (exIsUnion
                        ? exExpectedTypes.map((t: string) => `type(${vn}) == "${t}"`).join(' || ')
                        : `type(${vn}) == "${expectedType}"`);
                actions.push(makeReplaceLineAction(actionLabel,
                    `${indent}let ${vn} = ${exprText};\n${indent}if (${wrapCond}) {\n${indent}\t${replaced.trim()}\n${indent}}`,
                    line, lineLength, uri, diagnostic));
            }
        }
    }

    return actions;
}

/** Expected first-argument types for common builtins that return nullable results */
const builtinArgTypes: Record<string, string[]> = {
    keys: ['object'], values: ['object'],
    push: ['array'], pop: ['array'], shift: ['array'], unshift: ['array'],
    splice: ['array'], sort: ['array'], reverse: ['array'],
    join: ['array'], split: ['string'], substr: ['string'], substring: ['string'],
    trim: ['string'], ltrim: ['string'], rtrim: ['string'],
    match: ['string'], replace: ['string'],
    index: ['string', 'array'], rindex: ['string', 'array'],
    length: ['string', 'array', 'object'],
    lc: ['string'], uc: ['string'], ucfirst: ['string'], lcfirst: ['string'],
    chr: ['integer'], ord: ['string'], hex: ['string'],
};

/**
 * Expected types by (functionName, argIndex 0-based) for builtins.
 * Used to compute the tightest type constraint for a variable across all its usages.
 */
const builtinArgTypesByPos: Record<string, Record<number, string[]>> = {
    // Array functions
    push: { 0: ['array'] }, pop: { 0: ['array'] }, shift: { 0: ['array'] }, unshift: { 0: ['array'] },
    splice: { 0: ['array'] }, sort: { 0: ['array'], 1: ['function'] },
    reverse: { 0: ['array', 'string'] },
    filter: { 0: ['array'], 1: ['function'] }, map: { 0: ['array'], 1: ['function'] },
    join: { 0: ['string'], 1: ['array'] },
    slice: { 0: ['array'] },
    uniq: { 0: ['array'] },
    // Object functions
    keys: { 0: ['object'] }, values: { 0: ['object'] },
    // String functions
    split: { 0: ['string'], 1: ['string', 'regex'] },
    substr: { 0: ['string'] }, match: { 0: ['string'], 1: ['regex'] },
    replace: { 0: ['string'], 1: ['string', 'regex'], 2: ['string', 'function'] },
    trim: { 0: ['string'] }, ltrim: { 0: ['string'] }, rtrim: { 0: ['string'] },
    lc: { 0: ['string'] }, uc: { 0: ['string'] }, ucfirst: { 0: ['string'] }, lcfirst: { 0: ['string'] },
    index: { 0: ['string', 'array'] }, rindex: { 0: ['string', 'array'] },
    ord: { 0: ['string'] }, hex: { 0: ['string'] },
    // Multi-type
    length: { 0: ['string', 'array', 'object'] },
    // IO / misc
    writefile: { 0: ['string'] },
    call: { 0: ['function'], 2: ['object', 'null'] },
    exists: { 0: ['object'], 1: ['string'] },
    loadstring: { 0: ['string'] },
    regexp: { 0: ['string'] },
    sprintf: { 0: ['string'] }, printf: { 0: ['string'] },
};

/**
 * Walk the AST forward from a given offset and collect type constraints on a variable
 * from all downstream builtin call sites.  Returns the intersection of all expected
 * type sets, or null if no downstream constraints found.
 *
 * For example, if `lines` is used in `length(lines)` (expects string|array|object)
 * AND `join('\n', lines)` (expects array), the intersection is just ['array'].
 */
function findTightestTypeConstraint(ast: any, varName: string, afterOffset: number, expectedTypes: string[]): string[] | null {
    if (!ast || !varName) return null;
    // Simple variable names only (not member expressions)
    if (varName.includes('.')) return null;

    const constraints: string[][] = [];

    function walk(node: any): void {
        if (!node || typeof node !== 'object') return;
        if (typeof node.start === 'number' && node.start < afterOffset) {
            // Skip nodes entirely before the diagnostic — but still descend
            // into container nodes that may span past afterOffset
            if (typeof node.end === 'number' && node.end < afterOffset) return;
        }

        if (node.type === 'CallExpression' && node.callee?.type === 'Identifier') {
            const funcName: string = node.callee.name;
            const argTypes = builtinArgTypesByPos[funcName];
            if (argTypes && node.arguments) {
                for (let i = 0; i < node.arguments.length; i++) {
                    const arg = node.arguments[i];
                    const expected = argTypes[i];
                    if (arg?.type === 'Identifier' && arg.name === varName && expected) {
                        constraints.push(expected);
                    }
                }
            }
        }

        for (const key of Object.keys(node)) {
            if (key === 'type' || key === 'start' || key === 'end') continue;
            const val = node[key];
            if (Array.isArray(val)) {
                for (const item of val) walk(item);
            } else if (val && typeof val === 'object' && typeof val.type === 'string') {
                walk(val);
            }
        }
    }

    walk(ast);

    if (constraints.length === 0) return null;

    // Start with the diagnostic's expected types and intersect with all downstream constraints
    let result = new Set<string>(expectedTypes);
    for (const c of constraints) {
        const cSet = new Set<string>(c);
        result = new Set([...result].filter(t => cSet.has(t)));
    }

    const arr = [...result];
    // Only use the tighter constraint if it's actually tighter
    if (arr.length > 0 && arr.length < expectedTypes.length) return arr;
    return null;
}

/**
 * Trace through a function call chain to find the innermost identifier/member expression
 * that needs a type guard. For example, for `keys(env.netifd_mark)`, returns
 * { varName: "env.netifd_mark", expectedTypes: ["object"] }.
 */
function findInnerGuardTarget(ast: any, offset: number): { varName: string; expectedTypes: string[] } | null {
    const node = findCallExpressionAtOffset(ast, offset);
    if (!node) return null;
    return traceCallToGuardTarget(node);
}

function traceCallToGuardTarget(node: any): { varName: string; expectedTypes: string[] } | null {
    if (node.type !== 'CallExpression') return null;
    if (node.callee?.type !== 'Identifier') return null;

    const funcName: string = node.callee.name;
    const arg = node.arguments?.[0];
    if (!arg) return null;

    // If the argument is a simple identifier or member expression, return it
    const varName = getDottedPath(arg);
    if (varName) {
        const expectedTypes = builtinArgTypes[funcName];
        if (expectedTypes) {
            return { varName, expectedTypes };
        }
    }

    // If the argument is another function call, recurse into it
    if (arg.type === 'CallExpression') {
        return traceCallToGuardTarget(arg);
    }

    // If the argument is X || fallback, check X
    if (arg.type === 'BinaryExpression' && (arg.operator === '||' || arg.operator === '??')) {
        const leftName = getDottedPath(arg.left);
        if (leftName) {
            const expectedTypes = builtinArgTypes[funcName];
            if (expectedTypes) {
                return { varName: leftName, expectedTypes };
            }
        }
    }

    return null;
}

function getDottedPath(node: any): string | null {
    if (node.type === 'Identifier') return node.name;
    if (node.type === 'MemberExpression' && !node.computed) {
        const objPath = getDottedPath(node.object);
        if (objPath && node.property?.type === 'Identifier') {
            return `${objPath}.${node.property.name}`;
        }
    }
    return null;
}

/** Find the innermost CallExpression at or containing the given offset */
function findCallExpressionAtOffset(node: any, offset: number): any | null {
    if (!node || typeof node !== 'object' || typeof node.start !== 'number') return null;
    if (offset < node.start || offset > node.end) return null;

    // If this is a computed MemberExpression wrapping a CallExpression (e.g., match(...)[1]),
    // don't recurse into the call — the null comes from the member access, not the call's args.
    // Guarding the inner call's argument won't fix the nullable result of indexing.
    if (node.type === 'MemberExpression' && node.computed &&
        node.object?.type === 'CallExpression') {
        return null;
    }

    // Try to find a more specific CallExpression in children
    for (const key of Object.keys(node)) {
        if (key === 'type' || key === 'start' || key === 'end') continue;
        const val = node[key];
        if (Array.isArray(val)) {
            for (const item of val) {
                const found = findCallExpressionAtOffset(item, offset);
                if (found) return found;
            }
        } else if (val && typeof val === 'object' && typeof val.start === 'number') {
            const found = findCallExpressionAtOffset(val, offset);
            if (found) return found;
        }
    }

    // No child CallExpression found — return this node if it's a CallExpression
    return node.type === 'CallExpression' ? node : null;
}

/** Find a unique variable name like _val, _val2, _val3... that isn't already used nearby */
function uniqueValName(document: TextDocument, _line: number): string {
    // Scan the entire document to avoid collisions with any existing _val declarations.
    // Uses regex with word boundary to avoid matching _val2 when checking _val.
    const fullText = document.getText();
    let name = '_val';
    let suffix = 2;
    while (new RegExp(`(?:let|const|var)\\s+${name}\\b`).test(fullText)) {
        name = `_val${suffix}`;
        suffix++;
    }
    return name;
}

/** Check if a variable declared on `line` is referenced on any subsequent line */
function isVariableUsedAfterLine(document: TextDocument, line: number, varName: string): boolean {
    const totalLines = document.lineCount;
    const pattern = new RegExp(`\\b${varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    for (let i = line + 1; i < totalLines; i++) {
        const text = document.getText({
            start: { line: i, character: 0 },
            end: { line: i + 1, character: 0 }
        });
        if (pattern.test(text)) return true;
    }
    return false;
}

documents.listen(connection);

connection.listen();