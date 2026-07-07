import {
    createConnection,
    TextDocuments,
    ProposedFeatures,
    type InitializeParams,
    DidChangeConfigurationNotification,
    TextDocumentSyncKind,
    type InitializeResult,
    type WorkspaceFoldersChangeEvent,
    type DidChangeWatchedFilesParams,
    type TextDocumentChangeEvent,
    Diagnostic,
    DiagnosticSeverity,
    FileChangeType,
    DidChangeWatchedFilesNotification,
    type CodeActionParams,
    CodeAction,
    CodeActionKind,
    TextEdit,
    CodeLens,
    type CodeLensParams,
    Command,
    Location,
    type ReferenceParams,
    Range,
    DocumentSymbol,
    type DocumentSymbolParams,
    type RenameParams,
    type PrepareRenameParams,
    WorkspaceEdit,
    DocumentHighlight,
    DocumentHighlightKind,
    type DocumentHighlightParams,
    type SignatureHelp,
    type SignatureHelpParams,
    SymbolInformation,
    type WorkspaceSymbolParams,
    InlayHint,
    type InlayHintParams,
    FoldingRange,
    DocumentLink,
    CompletionItem,
    CompletionItemKind,
    MarkupKind,
    type FoldingRangeParams,
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';
import * as fs from 'fs';
import * as path from 'path';
import { isUcodeSourceFile, isUcodeSourceFileAsync } from './shebang';
import { collectCodeLensFunctions, getFunctionGitSummary, formatSummaryTitle } from './gitHistory';
import { findFunctionReferences, findNamespaceMemberReferences, findFactoryMethodReferences, formatReferencesTitle, getImportBindings, type ImportBinding } from './references';
import { handleHover } from './hover';
import { handleCompletion, handleCompletionResolve } from './completion';
import { handleDefinition } from './definition';
import { buildDocumentSymbols } from './documentSymbols';
import { provideSignatureHelp, resolveMemberCallParameterTypes } from './signatureHelp';
import { computeRawInlayHints, shiftRawHints, materializeRawHints, type RawInlayHint } from './inlayHints';
import { provideFoldingRanges } from './foldingRanges';
import { provideDocumentLinks } from './documentLinks';
import { computeImportInsertEdit, computeNamedImportEdit } from './importEdit';
import { parseDisableDirectives, anyDirectiveCovers } from './analysis/disableDirectives';
import { allBuiltinFunctions } from './builtins';
import { SemanticAnalyzer, type SemanticAnalysisResult, SymbolType, type SymbolTable, type Symbol } from './analysis';
import type {
    AstNode,
    ProgramNode,
    IdentifierNode,
    MemberExpressionNode,
    FunctionDeclarationNode,
    FunctionExpressionNode,
    ArrowFunctionExpressionNode,
    ImportDeclarationNode,
    JsDocCommentNode,
    ObjectExpressionNode,
    PropertyNode,
    VariableDeclarationNode,
    LiteralNode,
} from './ast/nodes';
import { UCODE_TARGET_VERSIONS, type UcodeTargetVersion, DEFAULT_TARGET_VERSION } from './analysis/ucodeVersions';
import { UcodeErrorCode } from './analysis/errorConstants';
import { stringSourceToRegexLiteral } from './analysis/checkers/builtinValidation';
import { UcodeParser } from './parser';
import { UcodeLexer, TokenType, detectTemplateMode, bridgeTemplateTokens, type Token } from './lexer';
import { buildIncludeScopeIndex, checkIncludeScopes, computeFreeVariables, type IncludeScopeEntry } from './analysis/includeScope';
import { runIncremental, type CleanBody } from './analysis/incrementalAnalysis';
import { type IncrementalCacheEntry } from './analysis/incrementalCache';
import { isKnownModule } from './analysis/moduleDispatch';
import { THROWING_BUILTINS } from './analysis/throwingBuiltins';
import { FileResolver } from './analysis/fileResolver';
import { MODULE_REGISTRIES } from './analysis/moduleDispatch';
import { Option } from 'effect';
import { setOpenDocumentContent, clearOpenDocumentContent } from './analysis/openDocuments';

const connection = createConnection(ProposedFeatures.all);

// The shape of the `data` payload our semantic diagnostics carry (set by the analyzer/checkers).
// The LSP `Diagnostic.data` field is typed `unknown`, so handlers narrow to this before reading.
// Every field is optional — different diagnostic codes populate different subsets.
interface DiagnosticData {
    coerceToString?: boolean;
    argNeedsParens?: boolean;
    convertStringToRegex?: boolean;
    variableName?: string;
    expectedType?: string;
    expectedTypes?: string[];
    actualType?: string;
    narrowable?: boolean;
    argumentOffset?: number;
    fallbackStart?: number;
    fallbackEnd?: number;
    fullExprStart?: number;
    fullExprEnd?: number;
    nullAccess?: {
        objStart: number;
        objEnd: number;
        propStart: number;
        computed: boolean;
        isWrite: boolean;
        isIdentifier: boolean;
    };
    /** UC8001: offsets of the statements to wrap in try/catch (throwing-call statement
     *  through the end of its enclosing block), plus the throwing builtin's name (drives a
     *  require-specific catch body listing the available modules). */
    wrapTryCatch?: { start: number; end: number; fn?: string };
}

/** Narrow a diagnostic's opaque `data` payload to our known shape. */
function diagData(diagnostic: Diagnostic): DiagnosticData {
    return (diagnostic.data ?? {}) as DiagnosticData;
}

// The generic AST walkers in this file descend via `Object.keys(node)`, indexing
// fields by name. `AstNode` only exposes type/start/end, so this view lets a walker
// read arbitrary child fields (which are themselves nodes, node arrays, or scalars)
// without resorting to `any`. Specific field reads after a `node.type` check are done
// through a cast to the matching node interface instead.
type WalkableNode = AstNode & Record<string, unknown>;
const asWalkable = (node: AstNode): WalkableNode => node as WalkableNode;

/** Top-level statement list of a Program-shaped node, as walkable nodes (empty if absent). */
const astBody = (ast: AstNode | null | undefined): WalkableNode[] => {
    const body = ast ? asWalkable(ast).body : undefined;
    return Array.isArray(body) ? (body as WalkableNode[]) : [];
};

// The three function-shaped nodes (declaration / expression / arrow), which share
// `params`, `restParam`, and `body` — what the JSDoc/guard quick-fix walkers operate on.
type FunctionLikeNode = FunctionDeclarationNode | FunctionExpressionNode | ArrowFunctionExpressionNode;

// #117 — every feature-provider handler runs its OWN recursive AST walk (folding, document
// links, code lens, signature help, hover, …) and is otherwise unguarded, so a deeply-nested
// document overflows the stack INSIDE the handler and surfaces as an LSP -32603 error on every
// request. Patch each request-registration method here, once, so any handler that overflows
// returns an empty result (the safe "nothing here" answer) instead of failing the request.
{
    const ARRAY_RESULT = ['onCompletion', 'onCodeAction', 'onCodeLens', 'onReferences',
        'onFoldingRanges', 'onDocumentLinks', 'onDocumentHighlight', 'onDocumentSymbol',
        'onWorkspaceSymbol'];
    const NULL_RESULT = ['onHover', 'onDefinition', 'onSignatureHelp', 'onPrepareRename',
        'onRenameRequest'];
    const wrapRegistration = (name: string, fallback: unknown) => {
        const orig = (connection as any)[name];
        if (typeof orig !== 'function') return;
        (connection as any)[name] = (handler: (...a: unknown[]) => unknown) =>
            orig.call(connection, (...args: unknown[]) => {
                const onErr = (e: unknown) => {
                    if (isStackOverflow(e)) {
                        connection.console.warn(`ucode-lsp: ${name} skipped — document too deeply nested to analyze`);
                        return fallback;
                    }
                    throw e;
                };
                try {
                    const r = handler(...args);
                    return r instanceof Promise ? r.catch(onErr) : r;
                } catch (e) { return onErr(e); }
            });
    };
    for (const n of ARRAY_RESULT) wrapRegistration(n, []);
    for (const n of NULL_RESULT) wrapRegistration(n, null);
}

const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

// Analysis cache for storing semantic analysis results with timestamps and tokens.
// `imports` is the set of file:// URIs this entry depends on; combined with
// `reverseDeps`, it lets us invalidate dependents when one of their imports
// changes (otherwise A.uc keeps using a stale view of B.uc's exports after
// B.uc is edited or its on-disk content changes).
const analysisCache = new Map<string, {result: SemanticAnalysisResult, tokens: Token[], timestamp: number, imports: Set<string>, comments: Token[]}>();
// Offset-anchored inlay hints from the last analysis, plus the document version and
// text they were computed against. Lets the inlayHint handler shift hints through
// edits (shiftRawHints) when a request arrives before re-analysis catches up, so
// hints stay glued to the code instead of blanking or overlapping. See inlayHints.ts.
const inlayCache = new Map<string, {version: number, text: string, raw: RawInlayHint[]}>();
const reverseDeps = new Map<string, Set<string>>(); // importedUri → set of importer URIs

// Debounce timers for document analysis - prevents re-analysis on every keystroke
const analysisTimers = new Map<string, ReturnType<typeof setTimeout>>();
const ANALYSIS_DEBOUNCE_MS = 50;
// Analysis is synchronous CPU work; a large file (e.g. fw4.uc ~540ms) blocks the event loop
// for its whole duration. A fixed 50ms debounce then runs that 540ms block on every brief
// pause, making the editor feel frozen. So debounce ADAPTIVELY: at least 50ms, but never more
// often than the file's own last analysis cost (capped), so a slow file re-analyzes at most
// ~once per its analysis time instead of fighting every keystroke. Fast files stay at 50ms.
const ADAPTIVE_DEBOUNCE_CAP_MS = 750;
const lastAnalysisMs = new Map<string, number>();

// Function-level incremental analysis: per-document cache + the set of documents whose last
// analysis SKIPPED some body type-checking (so their cached types are degraded inside unchanged
// bodies). A cursor-context request (hover/completion/…) on a degraded document triggers one
// full re-analysis first (ensureFullAnalysis), so those features never see degraded types.
const incrementalCacheByUri = new Map<string, IncrementalCacheEntry>();
const degradedUris = new Set<string>();
function debounceForDocument(uri: string): number {
  const last = lastAnalysisMs.get(uri) ?? 0;
  return Math.min(ADAPTIVE_DEBOUNCE_CAP_MS, Math.max(ANALYSIS_DEBOUNCE_MS, last));
}

// (uri → version) that onDidOpen just analyzed synchronously. vscode-languageserver
// fires onDidChangeContent on open too (the initial content counts as a change),
// so without this an open would analyze TWICE: immediately (onDidOpen) AND again
// 50ms later (the debounced onDidChangeContent) — redundant work plus a delayed
// duplicate publish. The marker lets onDidChangeContent recognise and skip that
// open-induced change. Genuine edits (where onDidOpen does NOT fire) never match
// the marker and debounce normally; if a re-open ever fails to fire onDidOpen,
// the marker simply won't match and we fall back to debounced analysis (safe).
const openAnalyzedVersion = new Map<string, number>();

// Workspace folders for directory scanning
let workspaceFolders: string[] = [];
let hasConfigurationCapability = false;
let hasInlayHintRefreshSupport = false;
// Cached `ucode.inlayHints.enable` setting (refreshed on config change). The
// inlayHint handler is synchronous, so we can't fetch config per request — we keep
// the latest value here and re-pull it when the client signals a settings change.
let inlayHintsEnabled = true;

// Ask the editor to re-request inlay hints, ignoring failures. refresh() returns a
// promise that rejects if the client can't service it; an uncaught rejection here
// would surface as an unhandled rejection, so always swallow it.
function requestInlayHintRefresh(): void {
    if (!hasInlayHintRefreshSupport) return;
    connection.languages.inlayHint.refresh().catch(() => { /* best-effort */ });
}

// Pull the current inlay-hint setting from the client and cache it. Falls back to
// enabled if the client doesn't support workspace/configuration or the read fails.
async function refreshInlayHintSetting(): Promise<void> {
    if (!hasConfigurationCapability) { inlayHintsEnabled = true; return; }
    try {
        const cfg = await connection.workspace.getConfiguration({ section: 'ucode.inlayHints' });
        inlayHintsEnabled = cfg?.enable !== false; // default true when unset
    } catch {
        inlayHintsEnabled = true;
    }
}

// Cached `ucode.targetVersion` — which OpenWrt release's ucode the diagnostics
// target. Drives version-gated diagnostics (see analysis/ucodeVersions.ts). The
// analyzer runs synchronously, so we keep the latest value and re-pull on change.
let ucodeTargetVersion: UcodeTargetVersion = DEFAULT_TARGET_VERSION;
// Cached `ucode.strictUnknownArguments` — whether an unverifiable (UNKNOWN) builtin
// argument errors under 'use strict' (default true). See analysis/checkers/builtinValidation.ts.
let ucodeStrictUnknownArguments = true;
// Cached `ucode.warnUnguardedThrowingCalls` — flag throwing builtins (json/loadfile/…)
// outside try/catch with a "wrap in try/catch" fix (UC8001). Default off (opt-in).
let ucodeWarnUnguardedThrowingCalls = true;
// Cached `ucode.warnResolvableThrowingCalls` — also warn require()/loadfile() when the module/
// path provably resolves (they can still throw on a compile error). Default off.
let ucodeWarnResolvableThrowingCalls = false;
// Cached `ucode.strictThrowingCalls` — escalate ALL unguarded throwing-builtin calls to errors
// under 'use strict' (default off → only json() escalates).
let ucodeStrictThrowingCalls = false;
// Cached `ucode.assumeUndefinedGlobalsDefined` — treat any unexplained read as an implicit
// global (suppress UC1001) instead of flagging it. Default off (opt-in; hides typos).
let ucodeAssumeUndefinedGlobalsDefined = false;
// Cached `ucode.uncertainGlobalScope` — Case-2 read-before-definition check (UC8002).
// 'errorInStrict' (default) = warn, error under 'use strict'; 'warn' = always warn; 'off'.
let ucodeUncertainGlobalScope: 'off' | 'warn' | 'errorInStrict' = 'errorInStrict';

async function refreshTargetVersion(): Promise<{ targetChanged: boolean; strictChanged: boolean }> {
    const prevVersion = ucodeTargetVersion;
    const prevStrictUnknown = ucodeStrictUnknownArguments;
    const prevWarnThrowing = ucodeWarnUnguardedThrowingCalls;
    const prevWarnResolvable = ucodeWarnResolvableThrowingCalls;
    const prevStrictThrowing = ucodeStrictThrowingCalls;
    const prevAssumeGlobals = ucodeAssumeUndefinedGlobalsDefined;
    const prevUncertainScope = ucodeUncertainGlobalScope;
    let nextVersion: UcodeTargetVersion = DEFAULT_TARGET_VERSION;
    let nextStrictUnknown = true;
    let nextWarnThrowing = true;
    let nextWarnResolvable = false;
    let nextStrictThrowing = false;
    let nextAssumeGlobals = false;
    let nextUncertainScope: 'off' | 'warn' | 'errorInStrict' = 'errorInStrict';
    if (hasConfigurationCapability) {
        try {
            const cfg = await connection.workspace.getConfiguration({ section: 'ucode' });
            const v = cfg?.targetVersion;
            if (typeof v === 'string' && (UCODE_TARGET_VERSIONS as readonly string[]).includes(v)) {
                nextVersion = v as UcodeTargetVersion;
            }
            if (typeof cfg?.strictUnknownArguments === 'boolean') {
                nextStrictUnknown = cfg.strictUnknownArguments;
            }
            if (typeof cfg?.warnUnguardedThrowingCalls === 'boolean') {
                nextWarnThrowing = cfg.warnUnguardedThrowingCalls;
            }
            if (typeof cfg?.warnResolvableThrowingCalls === 'boolean') {
                nextWarnResolvable = cfg.warnResolvableThrowingCalls;
            }
            if (typeof cfg?.strictThrowingCalls === 'boolean') {
                nextStrictThrowing = cfg.strictThrowingCalls;
            }
            if (typeof cfg?.assumeUndefinedGlobalsDefined === 'boolean') {
                nextAssumeGlobals = cfg.assumeUndefinedGlobalsDefined;
            }
            if (cfg?.uncertainGlobalScope === 'off' || cfg?.uncertainGlobalScope === 'warn' || cfg?.uncertainGlobalScope === 'errorInStrict') {
                nextUncertainScope = cfg.uncertainGlobalScope;
            }
        } catch { /* keep defaults */ }
    }
    ucodeTargetVersion = nextVersion;
    ucodeStrictUnknownArguments = nextStrictUnknown;
    ucodeWarnUnguardedThrowingCalls = nextWarnThrowing;
    ucodeWarnResolvableThrowingCalls = nextWarnResolvable;
    ucodeStrictThrowingCalls = nextStrictThrowing;
    ucodeAssumeUndefinedGlobalsDefined = nextAssumeGlobals;
    ucodeUncertainGlobalScope = nextUncertainScope;
    return {
        targetChanged: nextVersion !== prevVersion,
        strictChanged: nextStrictUnknown !== prevStrictUnknown
            || nextWarnThrowing !== prevWarnThrowing
            || nextWarnResolvable !== prevWarnResolvable
            || nextStrictThrowing !== prevStrictThrowing
            || nextAssumeGlobals !== prevAssumeGlobals
            || nextUncertainScope !== prevUncertainScope,
    };
}
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
            } else if (entry.isFile() && await isUcodeSourceFileAsync(fullPath)) {
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
    hasInlayHintRefreshSupport = !!(
        capabilities.workspace && capabilities.workspace.inlayHint &&
        capabilities.workspace.inlayHint.refreshSupport
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
            referencesProvider: true,
            documentSymbolProvider: true,
            workspaceSymbolProvider: true,
            documentHighlightProvider: true,
            inlayHintProvider: true,
            foldingRangeProvider: true,
            documentLinkProvider: { resolveProvider: false },
            renameProvider: {
                prepareProvider: true
            },
            signatureHelpProvider: {
                triggerCharacters: ['(', ','],
                retriggerCharacters: [',']
            },
            codeActionProvider: {
                codeActionKinds: [CodeActionKind.QuickFix]
            },
            codeLensProvider: {
                resolveProvider: true
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
    // Cache the initial inlay-hint setting. Fire-and-forget: awaiting a pull-based
    // getConfiguration inside the initialized handler can stall the connection, so we
    // let it resolve in the background and refresh hints once the value is known.
    refreshInlayHintSetting().then(() => requestInlayHintRefresh());
    // Pull the initial target ucode version; re-validate open docs if it isn't the
    // default (so version-gated diagnostics reflect a configured older target).
    refreshTargetVersion().then(({ targetChanged, strictChanged }) => {
        if (targetChanged || strictChanged)
            for (const doc of documents.all()) validateAndAnalyzeDocument(doc, strictChanged);
    });
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

documents.onDidClose((e: TextDocumentChangeEvent<TextDocument>) => {
    // Drop the open-buffer override so cross-file resolution falls back to disk.
    clearOpenDocumentContent(e.document.uri);
    openAnalyzedVersion.delete(e.document.uri);
    lastAnalysisMs.delete(e.document.uri);
    // Inlay hints only matter for open documents (no cross-file role like
    // analysisCache), so drop the cache to avoid leaking entries for closed files.
    inlayCache.delete(e.document.uri);
    // The closed file reverts from its (possibly edited) buffer to disk — its
    // exports may differ, so refresh the auto-import index.
    invalidateExportIndex();
});

documents.onDidChangeContent(async (change: TextDocumentChangeEvent<TextDocument>) => {
    // Keep the open-buffer registry current immediately (not debounced) so other
    // files resolving imports of this one see the latest, unsaved content.
    const uri = change.document.uri;
    setOpenDocumentContent(uri, change.document.getText());

    // Skip the change-event that is really just the initial open: onDidOpen
    // already analyzed this exact (uri, version) synchronously. Consume the
    // marker so a genuine later edit (new version) still debounces.
    if (openAnalyzedVersion.get(uri) === change.document.version) {
        openAnalyzedVersion.delete(uri);
        return;
    }

    // Debounce analysis — avoid re-running full semantic analysis on every keystroke
    const existingTimer = analysisTimers.get(uri);
    if (existingTimer) {
        clearTimeout(existingTimer);
    }
    analysisTimers.set(uri, setTimeout(async () => {
        analysisTimers.delete(uri);
        await validateAndAnalyzeDocument(change.document);
        await invalidateDependents(change.document.uri);
    }, debounceForDocument(uri)));
});

documents.onDidOpen(async (change: TextDocumentChangeEvent<TextDocument>) => {
    setOpenDocumentContent(change.document.uri, change.document.getText());
    // Mark this (uri, version) as analyzed so the open-induced onDidChangeContent
    // that fires right after this skips its redundant debounced re-analysis.
    openAnalyzedVersion.set(change.document.uri, change.document.version);
    await validateAndAnalyzeDocument(change.document);
});

/** True for a native stack overflow (deeply-nested input) or our analyzer's depth-guard bail.
 *  Used to degrade gracefully instead of crashing the server. (#117) */
function isStackOverflow(e: unknown): boolean {
    return (e instanceof RangeError && /call stack|Maximum call stack/i.test(e.message))
        || (e instanceof Error && e.name === 'AnalysisDepthExceeded');
}

async function validateAndAnalyzeDocument(textDocument: TextDocument, forceFull = false): Promise<void> {
  try {
    const started = Date.now();
    await validateAndAnalyzeDocumentInner(textDocument, forceFull);
    // Remember how long THIS file took so the next edit's debounce can adapt (see
    // debounceForDocument) — a 540ms file shouldn't re-analyze on every keystroke.
    lastAnalysisMs.set(textDocument.uri, Date.now() - started);
  } catch (e) {
    // Final containment net: no document — however pathological — may kill the server. A
    // deeply-nested expression that overflows a traversal we don't individually guard lands
    // here; surface one honest warning instead of crashing the process. (#117)
    if (!isStackOverflow(e)) throw e;
    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics: [{
        severity: DiagnosticSeverity.Warning,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        message: 'This file is too deeply nested for the ucode language server to analyze fully. The code may still be valid; analysis was skipped to avoid a crash.',
        source: 'ucode-semantic',
    }] });
  }
}

// If the document's last analysis skipped body type-checking (degraded types inside unchanged
// bodies), run one FULL analysis so cursor-context features (hover/completion/definition/…)
// see complete types. No-op when not degraded. Called at the top of those handlers.
async function ensureFullAnalysis(uri: string): Promise<void> {
    if (!degradedUris.has(uri)) return;
    const doc = documents.get(uri);
    if (!doc) { degradedUris.delete(uri); return; }
    await validateAndAnalyzeDocument(doc, true); // forceFull clears the degraded flag
}

async function validateAndAnalyzeDocumentInner(textDocument: TextDocument, forceFull = false): Promise<void> {
    const text = textDocument.getText();
    // Template files (`{% %}`/`{{ }}`) lex in template mode and have their framing
    // tokens bridged to statement separators so the ordinary parser can consume them;
    // raw scripts are unchanged. (ucode template-mode bring-up, phase 3.)
    const isTemplate = detectTemplateMode(text);
    const lexer = new UcodeLexer(text, { rawMode: !isTemplate });
    const tokens = isTemplate ? bridgeTemplateTokens(lexer.tokenize()) : lexer.tokenize();
    const parser = new UcodeParser(tokens, text);
    parser.setComments(lexer.comments);
    const parseResult = parser.parse();

    // Lexer side-channel errors (e.g. unsupported regex flag, #56) are surfaced here alongside
    // parser errors — the lexer emits a valid token for them so the AST/arg-count stays intact.
    // Disable directives (`// ucode-lsp disable[-next-line] [UC####...]`) parsed once for this
    // document. A directive REMOVES (not demotes) a covered diagnostic — ticket 08 — and the
    // semantic analyzer applies the same directives to its own diagnostics via the shared module.
    const disableDirectives = parseDisableDirectives(textDocument.getText());
    let diagnostics: Diagnostic[] = [...lexer.errors, ...parseResult.errors].map(err => {
        const diagnostic: Diagnostic = {
            severity: (err as { severity?: string }).severity === 'warning' ? DiagnosticSeverity.Warning : DiagnosticSeverity.Error,
            range: {
                start: textDocument.positionAt(err.start),
                end: textDocument.positionAt(err.end),
            },
            message: err.message,
            source: 'ucode-parser',
            // Every parser diagnostic carries a stable code (#103); UC6001 is the
            // umbrella fallback if an emission site didn't set a more specific one.
            code: err.code ?? UcodeErrorCode.SYNTAX_ERROR,
        };
        return diagnostic;
    }).filter(d => !anyDirectiveCovers(disableDirectives, d.range.start.line, d.code));

    if (parseResult.ast) {
        // One analysis pass with a given skip set; reused by runIncremental (which may invoke
        // it twice: incremental, then a sound full fall-back if a signature/shape changed).
        const runAnalysis = (cleanBodies: Map<number, CleanBody>) => {
            const analyzer = new SemanticAnalyzer(textDocument, {
                enableTypeChecking: true,
                enableScopeAnalysis: true,
                enableControlFlowAnalysis: true,
                enableUnusedVariableDetection: true,
                enableShadowingWarnings: true,
                workspaceRoot: workspaceFolders.length > 0 ? workspaceFolders[0] : process.cwd(),
                targetVersion: ucodeTargetVersion,
                strictUnknownArguments: ucodeStrictUnknownArguments,
                warnUnguardedThrowingCalls: ucodeWarnUnguardedThrowingCalls,
                warnResolvableThrowingCalls: ucodeWarnResolvableThrowingCalls,
                strictThrowingCalls: ucodeStrictThrowingCalls,
                assumeUndefinedGlobalsDefined: ucodeAssumeUndefinedGlobalsDefined,
                uncertainGlobalScope: ucodeUncertainGlobalScope,
            });
            // Template render scope: if some file include()s THIS file with a scope object,
            // those keys are injected globals here — suppress UC1001 for them. (phase 4b)
            try {
                const selfPath = path.resolve(uriToFilePath(textDocument.uri));
                const scope = getWorkspaceIncludeScopeIndex().get(selfPath);
                if (scope) analyzer.setInjectedScope(scope.injectedNames, scope.injectedTypes);
            } catch { /* index/path failure must never break analysis */ }
            if (cleanBodies.size > 0) analyzer.setCleanBodies(cleanBodies);
            return analyzer.analyze(parseResult.ast!);
        };
        // Function-level incremental analysis (sound — verified by
        // tests/test-incremental-analysis.test.js). forceFull disables it so cursor-context
        // requests get full types. Best-effort: any failure falls back to a plain full run.
        let analysisResult: SemanticAnalysisResult;
        let cleanCount = 0;
        try {
            const prev = forceFull ? undefined : incrementalCacheByUri.get(textDocument.uri);
            const inc = runIncremental(textDocument, parseResult.ast as any, prev, runAnalysis);
            analysisResult = inc.result;
            cleanCount = inc.skipped;
            incrementalCacheByUri.set(textDocument.uri, inc.cache);
        } catch {
            analysisResult = runAnalysis(new Map());
            incrementalCacheByUri.delete(textDocument.uri);
        }
        if (cleanCount > 0) degradedUris.add(textDocument.uri); else degradedUris.delete(textDocument.uri);
        const newImports = analysisResult.resolvedImports ?? new Set<string>();
        updateImportDeps(textDocument.uri, newImports);
        analysisCache.set(textDocument.uri, {result: analysisResult, tokens, timestamp: Date.now(), imports: newImports, comments: lexer.comments});

        // Precompute offset-anchored inlay hints for the whole document and cache
        // them with this version + text, so the inlayHint handler can serve (and
        // shift) them without re-walking the AST per request. This is a full-AST walk
        // OUTSIDE the analyzer's containment, so on a deeply-nested expression it can
        // overflow the stack — skip the hints rather than crash. (#117)
        try {
            const rawHints = computeRawInlayHints(parseResult.ast, analysisResult.symbolTable, allBuiltinFunctions);
            inlayCache.set(textDocument.uri, {version: textDocument.version, text, raw: rawHints});
        } catch (e) {
            inlayCache.delete(textDocument.uri);
            if (!isStackOverflow(e)) throw e;
        }

        // Semantic analysis diagnostics are already filtered by the SemanticAnalyzer itself
        diagnostics.push(...analysisResult.diagnostics);

        // Host-side render-scope enforcement: for each include("tmpl", { … }) in THIS file,
        // flag a template free variable the scope fails to provide (sound — verified vs the
        // oracle). Best-effort + contained; never let it break the main diagnostics. (phase 4b)
        try {
            const includerPath = path.resolve(uriToFilePath(textDocument.uri));
            const freeVarCache = new Map<string, Set<string> | null>();
            const getTargetFreeVars = (target: string): Set<string> | null => {
                if (freeVarCache.has(target)) return freeVarCache.get(target)!;
                let result: Set<string> | null = null;
                const wf = getWorkspaceFile(target);
                if (wf?.ast) result = computeFreeVariables(wf.ast);
                freeVarCache.set(target, result);
                return result;
            };
            // The includer's own transitive injected scope leaks into the children it includes,
            // so pass it as "provided" (else we'd falsely flag a leaked var like fw4). (phase 4b)
            const selfEntry = getWorkspaceIncludeScopeIndex().get(includerPath);
            const includerScope = selfEntry ? { names: selfEntry.injectedNames, complete: selfEntry.complete } : undefined;
            for (const d of checkIncludeScopes(parseResult.ast, includerPath, getTargetFreeVars, (n) => allBuiltinFunctions.has(n), includerScope)) {
                const startLine = textDocument.positionAt(d.start).line;
                if (anyDirectiveCovers(disableDirectives, startLine, UcodeErrorCode.UNDEFINED_VARIABLE)) continue;
                diagnostics.push({
                    severity: DiagnosticSeverity.Warning,
                    range: { start: textDocument.positionAt(d.start), end: textDocument.positionAt(d.end) },
                    message: d.message,
                    source: 'ucode-semantic',
                    code: UcodeErrorCode.UNDEFINED_VARIABLE,
                });
            }
        } catch { /* enforcement is best-effort; never break primary diagnostics */ }
    } else {
        purgeImportDeps(textDocument.uri);
        analysisCache.delete(textDocument.uri);
        inlayCache.delete(textDocument.uri);
    }

    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });

    // The analysisCache (the source of inlay-hint positions) just changed. Inlay
    // hint requests are debounced behind edits, so without an explicit refresh the
    // editor keeps showing hints computed against the previous AST — their offsets
    // no longer line up with the edited text and render on top of real code. Ask the
    // editor to re-request now that the cache matches the current document version.
    requestInlayHintRefresh();
}

/** Diff the file's previous and new import sets, updating reverseDeps so
 *  "who depends on this URI?" stays accurate without scanning. */
function updateImportDeps(importerUri: string, newImports: Set<string>): void {
    const prev = analysisCache.get(importerUri)?.imports ?? new Set<string>();
    for (const oldDep of prev) {
        if (!newImports.has(oldDep)) {
            const set = reverseDeps.get(oldDep);
            if (set) {
                set.delete(importerUri);
                if (set.size === 0) reverseDeps.delete(oldDep);
            }
        }
    }
    for (const newDep of newImports) {
        if (!prev.has(newDep)) {
            let set = reverseDeps.get(newDep);
            if (!set) { set = new Set(); reverseDeps.set(newDep, set); }
            set.add(importerUri);
        }
    }
}

/** Drop this file's entries from reverseDeps (file was deleted / un-parseable). */
function purgeImportDeps(importerUri: string): void {
    const prev = analysisCache.get(importerUri)?.imports;
    if (!prev) return;
    for (const dep of prev) {
        const set = reverseDeps.get(dep);
        if (set) {
            set.delete(importerUri);
            if (set.size === 0) reverseDeps.delete(dep);
        }
    }
}

/** Re-analyze every open document that imports `changedUri`. Walks transitively
 *  so a chain A → B → C invalidates A when C changes. Cycles are bounded by
 *  the visited set. We only re-analyze documents that are currently open in
 *  the editor — closed-file caches are dropped instead so they get a fresh
 *  parse next time they're opened. */
async function invalidateDependents(changedUri: string): Promise<void> {
    const visited = new Set<string>([changedUri]);
    const queue = [changedUri];
    while (queue.length > 0) {
        const cur = queue.shift()!;
        const importers = reverseDeps.get(cur);
        if (!importers) continue;
        for (const dep of importers) {
            if (visited.has(dep)) continue;
            visited.add(dep);
            queue.push(dep);
            const openDoc = documents.get(dep);
            if (openDoc) {
                // forceFull: the dependent's OWN text is unchanged, so its incremental
                // cache would skip its (structurally-identical) function bodies and
                // replay diagnostics computed against the CHANGED import's OLD exports
                // — a stale cross-file result. The semantic fingerprint is intra-file
                // only and can't see that an imported return type moved, so we must
                // re-type-check the dependent in full. (regression: cross-file body skip)
                await validateAndAnalyzeDocument(openDoc, true);
            } else {
                // Closed dependent: re-analyze from disk so its workspace-wide
                // diagnostics stay fresh — an export it relied on may have changed
                // (e.g. now-missing import) — and the result is re-published. forceFull
                // for the same stale-cross-file-cache reason as the open path above.
                try {
                    const depPath = uriToFilePath(dep);
                    const content = await fs.promises.readFile(depPath, 'utf8');
                    await validateAndAnalyzeDocument(TextDocument.create(dep, 'ucode', 1, content), true);
                } catch {
                    // File gone/unreadable: drop caches and clear its problems.
                    purgeImportDeps(dep);
                    analysisCache.delete(dep);
                    connection.sendDiagnostics({ uri: dep, diagnostics: [] });
                }
            }
        }
    }
}

connection.onDidChangeWatchedFiles(async (params: DidChangeWatchedFilesParams) => {
    for (const change of params.changes) {
        const filePath = uriToFilePath(change.uri);

        // Accept .uc files and extensionless ucode shebang scripts. On a Delete the
        // file is gone (can't peek the shebang), so also accept any extensionless path
        // so a removed script's stale diagnostics get cleared (clearing is a no-op for
        // a non-ucode file).
        const isUcode = isUcodeSourceFile(filePath)
            || (change.type === FileChangeType.Deleted && !path.basename(filePath).includes('.'));
        if (!isUcode) {
            continue;
        }

        // A .uc file was created/changed/deleted — its exports may have changed, so
        // drop the auto-import index (and file list) so the next completion rebuilds.
        invalidateExportIndex();
        wsFileListCache = null;

        switch (change.type) {
            case FileChangeType.Created:
            case FileChangeType.Changed:
                try {
                    const content = await fs.promises.readFile(filePath, 'utf8');
                    const textDocument = TextDocument.create(change.uri, 'ucode', 1, content);
                    await validateAndAnalyzeDocument(textDocument);
                    await invalidateDependents(change.uri);
                } catch (error) {
                    purgeImportDeps(change.uri);
                    analysisCache.delete(change.uri);
                }
                break;

            case FileChangeType.Deleted:
                purgeImportDeps(change.uri);
                analysisCache.delete(change.uri);
                inlayCache.delete(change.uri);
                // Clear the file's published problems — otherwise its diagnostics
                // from the startup scan linger in the Problems panel after deletion.
                connection.sendDiagnostics({ uri: change.uri, diagnostics: [] });
                await invalidateDependents(change.uri);
                break;
        }
    }
});

connection.onHover(async (params) => {
    await ensureFullAnalysis(params.textDocument.uri); // full types inside unchanged bodies
    const cacheEntry = analysisCache.get(params.textDocument.uri);
    if (!cacheEntry?.result) {
        return null;
    }

    return handleHover(params, documents, cacheEntry.result, cacheEntry.tokens);
});

connection.onCompletion(async (params) => {
    await ensureFullAnalysis(params.textDocument.uri); // full types inside unchanged bodies
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
    
    const base = handleCompletion(params, documents, connection, analysisResult);
    try {
        const document = documents.get(params.textDocument.uri);
        if (document && analysisResult?.ast) {
            const offset = document.offsetAt(params.position);
            return appendCrossFileAutoImports(base, params.textDocument.uri, document, analysisResult.ast, offset);
        }
    } catch (e) {
        connection.console.log('auto-import error: ' + e);
    }
    return base;
});

// Append completion items for named exports of OTHER workspace files that aren't
// already in scope, each carrying an `additionalTextEdits` that inserts the import.
// Only fires in general (statement/expression) context — detected by the presence
// of keyword items, which handleCompletion emits only there (never after `.`, in a
// function-name slot, or inside an import).
function appendCrossFileAutoImports(
    base: CompletionItem[], uri: string, document: TextDocument, ast: ProgramNode, offset: number
): CompletionItem[] {
    if (!base.some(i => i.kind === CompletionItemKind.Keyword)) return base;
    if (workspaceFolders.length === 0) return base;
    const text = document.getText();

    // Never inside a string literal (e.g. the module path of an `import … from '…'`):
    // scan the current line tracking quote state up to the cursor.
    const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
    let inStr: string | null = null;
    for (let j = lineStart; j < offset; j++) {
        const ch = text[j];
        if (inStr) {
            if (ch === '\\') { j++; continue; }
            if (ch === inStr) inStr = null;
        } else if (ch === '"' || ch === "'" || ch === '`') {
            inStr = ch;
        }
    }
    if (inStr) return base;

    // Never in member position (`o.foo|` / `o.|`, including across whitespace and
    // newlines like `o.\n  foo|`): a property is not a top-level name.
    let i = offset - 1;
    while (i >= 0 && /[A-Za-z0-9_$]/.test(text[i]!)) i--;
    while (i >= 0 && /\s/.test(text[i]!)) i--; // skip whitespace incl. newlines/CR
    if (i >= 0 && text[i] === '.') return base;

    const inScope = new Set(base.map(i => i.label)); // locals, builtins, existing imports
    const currentPath = path.resolve(uriToFilePath(uri));
    const currentDir = path.dirname(currentPath);
    const additions: CompletionItem[] = [];
    const MAX = 500;

    // Iterate the cached workspace export index (no per-keystroke disk reads).
    for (const entry of getWorkspaceExportIndex()) {
        if (entry.filePath === currentPath) continue; // don't import from the current file
        if (inScope.has(entry.name)) continue; // already imported / a local / a builtin
        let rel = path.relative(currentDir, entry.filePath).replace(/\\/g, '/');
        if (!rel.startsWith('.')) rel = './' + rel;
        const importText = `import { ${entry.name} } from '${rel}';`;
        // Merge into an existing `import { … } from '${rel}'` when present (ticket 93).
        const importEdit = computeNamedImportEdit(ast, document, rel, entry.name);
        additions.push({
            label: entry.name,
            kind: entry.isFunction ? CompletionItemKind.Function : CompletionItemKind.Variable,
            detail: `Auto-import from ${rel}`,
            documentation: { kind: MarkupKind.Markdown, value: `Named export from \`${rel}\`. Selecting this adds:\n\n\`\`\`\n${importText}\n\`\`\`` },
            sortText: `8${entry.name}`, // rank below locals/builtins/keywords
            ...(importEdit ? { additionalTextEdits: [importEdit] } : {}),
        });
        if (additions.length >= MAX) {
            connection.console.log(`auto-import: capped at ${MAX} candidates`);
            return base.concat(additions);
        }
    }
    return base.concat(additions);
}

connection.onCompletionResolve((item) => {
    return handleCompletionResolve(item);
});

/** The innermost ExpressionStatement node containing `offset` (for the null-guard fix —
 *  wrapping a declaration would change scoping, so only statements qualify). */
function findEnclosingExpressionStatement(ast: AstNode, offset: number): AstNode | null {
    let found: AstNode | null = null;
    const walk = (node: AstNode) => {
        if (!node || typeof node !== 'object') return;
        if (typeof node.start === 'number' && typeof node.end === 'number'
            && offset >= node.start && offset <= node.end && node.type === 'ExpressionStatement') {
            found = node; // keep descending so the innermost wins
        }
        for (const k of Object.keys(node)) {
            const v = asWalkable(node)[k];
            if (Array.isArray(v)) { for (const e of v) walk(e as AstNode); }
            else if (v && typeof v === 'object' && typeof (v as AstNode).type === 'string') walk(v as AstNode);
        }
    };
    walk(ast);
    return found;
}

/** Quick fixes for UC5005 (null) / UC5006 (possibly-null) member access:
 *   1. Optional chaining — replace `.` with `?.` (or `[` with `?.[`). Not offered for an
 *      assignment LHS (`?.` is invalid there).
 *   2. Null guard — wrap the statement in `if (receiver) …`. Only for a bare-identifier
 *      receiver (a direct call like `cursor()` would be evaluated twice) inside a statement. */
/** Quick-fix for a non-string argument to a string-coercing builtin (uc/lc, #30): wrap the
 *  argument in an explicit `"" + …` coercion. The diagnostic range IS the argument node's span,
 *  and argNeedsParens was decided from the arg's AST node type — so this is AST-based, not a
 *  line-text reparse. */
function generateCoerceToStringQuickFix(diagnostic: Diagnostic, document: TextDocument, uri: string): CodeAction[] {
    const data = diagData(diagnostic);
    if (!data?.coerceToString) return [];
    const argText = document.getText(diagnostic.range);
    const wrapped = data.argNeedsParens ? `"" + (${argText})` : `"" + ${argText}`;
    return [{
        title: 'Coerce to string ("" + value)',
        kind: CodeActionKind.QuickFix,
        diagnostics: [diagnostic],
        isPreferred: true,
        edit: { changes: { [uri]: [TextEdit.replace(diagnostic.range, wrapped)] } },
    }];
}

/** Convert a string-literal `match` pattern to the regex literal the author meant (#32). Built
 *  from the SOURCE text between the quotes so escapes (`\d`, `\b`, …) survive exactly as written —
 *  the decoded value would corrupt them (`"a\b"` decodes to a+backspace). The `/` delimiter is
 *  escaped (only where not already escaped). */
function generateStringToRegexQuickFix(diagnostic: Diagnostic, document: TextDocument, uri: string): CodeAction[] {
    const src = document.getText(diagnostic.range); // includes the surrounding quote chars
    // Same source→regex conversion the diagnostic message used (shared helper), so the title and
    // the message always show the identical regex literal.
    const regexLiteral = stringSourceToRegexLiteral(src);
    if (!regexLiteral) return [];
    return [{
        title: `Convert to regex literal ${regexLiteral}`,
        kind: CodeActionKind.QuickFix,
        diagnostics: [diagnostic],
        isPreferred: true,
        edit: { changes: { [uri]: [TextEdit.replace(diagnostic.range, regexLiteral)] } },
    }];
}

function generateNullAccessQuickFixes(diagnostic: Diagnostic, document: TextDocument, uri: string, ast: ProgramNode | undefined): CodeAction[] {
    const data = diagData(diagnostic).nullAccess;
    if (!data) return [];
    const { objStart, objEnd, propStart, computed, isWrite, isIdentifier } = data;
    const fullText: string = document.getText();
    const actions: CodeAction[] = [];

    // 1. Optional chaining (invalid on an assignment LHS).
    if (!isWrite) {
        let editRange: Range | null = null;
        let title = '';
        if (!computed) {
            const dot = fullText.indexOf('.', objEnd);
            if (dot >= 0 && dot < propStart) {
                editRange = { start: document.positionAt(dot), end: document.positionAt(dot + 1) };
                title = "Use optional chaining ('?.')";
            }
        } else {
            const br = fullText.indexOf('[', objEnd);
            if (br >= 0 && br < propStart) {
                editRange = { start: document.positionAt(br), end: document.positionAt(br) };
                title = "Use optional chaining ('?.[')";
            }
        }
        if (editRange) {
            actions.push({
                title,
                kind: CodeActionKind.QuickFix,
                diagnostics: [diagnostic],
                isPreferred: true,
                edit: { changes: { [uri]: [TextEdit.replace(editRange, '?.')] } },
            });
        }
    }

    // 2. Null guard — `if (receiver) <statement>` (identifier receiver only; no double-eval).
    if (isIdentifier && ast) {
        const stmt = findEnclosingExpressionStatement(ast, document.offsetAt(diagnostic.range.start));
        if (stmt) {
            const objText = fullText.slice(objStart, objEnd);
            const stmtText = fullText.slice(stmt.start, stmt.end);
            const range = { start: document.positionAt(stmt.start), end: document.positionAt(stmt.end) };
            actions.push({
                title: `Guard with 'if (${objText})'`,
                kind: CodeActionKind.QuickFix,
                diagnostics: [diagnostic],
                edit: { changes: { [uri]: [TextEdit.replace(range, `if (${objText}) ${stmtText}`)] } },
            });
        }
    }

    return actions;
}


// UC8001: wrap a throwing builtin call AND the rest of its enclosing block in try/catch.
// The diagnostic carries the statement range to wrap (first throwing statement → end of
// block); everything in between is re-indented one level under the new `try {`.
function generateWrapTryCatchQuickFix(diagnostic: Diagnostic, document: TextDocument, uri: string): CodeAction[] {
    const data = diagData(diagnostic).wrapTryCatch;
    if (!data || typeof data.start !== 'number' || typeof data.end !== 'number') return [];

    const startPos = document.positionAt(data.start);
    const lineStartOffset = document.offsetAt({ line: startPos.line, character: 0 });
    // Base indentation = the leading whitespace of the first statement's line.
    const firstLine = document.getText({
        start: { line: startPos.line, character: 0 },
        end: { line: startPos.line + 1, character: 0 },
    });
    const baseIndent = (firstLine.match(/^[ \t]*/) || [''])[0];
    const unit = baseIndent.includes('\t') ? '\t' : '    ';

    const range: Range = { start: document.positionAt(lineStartOffset), end: document.positionAt(data.end) };
    const original = document.getText(range);
    // Shift every non-blank line one level deeper (each line already carries its own
    // indentation, so a uniform +unit keeps relative structure intact).
    const indented = original.split('\n').map(l => (l.trim().length ? unit + l : l)).join('\n');

    // Builtins whose spec requests it (require) get a catch body listing the modules actually on
    // the require search path (globbed from the filesystem), so the fix doubles as a reference
    // for the correct name to require.
    let catchBody: string;
    if (data.fn && THROWING_BUILTINS.get(data.fn)?.catchStyle === 'modules') {
        // Emit RUNTIME ucode that enumerates the modules actually on the require search path,
        // so the failure prints what IS available (needs `fs` in scope — import it if absent).
        catchBody =
            `${baseIndent}${unit}// require() failed — module not found. Available modules on the search path:\n` +
            `${baseIndent}${unit}for (let searchdir in REQUIRE_SEARCH_PATH)\n` +
            `${baseIndent}${unit}${unit}for (let modpath in fs.glob(searchdir))\n` +
            `${baseIndent}${unit}${unit}${unit}warn(\`available module: \${modpath}\\n\`);\n` +
            `${baseIndent}${unit}warn(\`require failed: \${e}\\n\`);\n`;
    } else {
        catchBody =
            `${baseIndent}${unit}// handle the exception — e.message / e.stacktrace\n` +
            `${baseIndent}${unit}warn(\`caught: \${e}\\n\`);\n`;
    }
    const wrapped =
        `${baseIndent}try {\n` +
        `${indented}\n` +
        `${baseIndent}} catch (e) {\n` +
        catchBody +
        `${baseIndent}}`;

    return [{
        title: 'Wrap in try/catch (through end of block)',
        kind: CodeActionKind.QuickFix,
        diagnostics: [diagnostic],
        isPreferred: true,
        edit: { changes: { [uri]: [TextEdit.replace(range, wrapped)] } },
    }];
}

// Diagnostic-independent action: a `./`/`../` relative import whose target lives under a
// share/ucode- or lib/ucode-style install root can instead use the ecosystem-conventional
// dotted module form ("cli.utils") — the spelling installed packages use to address each
// other, which also works for runtime require() (relative paths never do: the search-path
// templates reject '/' in module names). Verified convention: 36 dotted vs 9 relative
// intra-package imports across the OpenWrt corpus, with relative used only OUTSIDE search
// roots (/lib/netifd scripts loaded by explicit path). Offered only when the dotted form
// provably resolves back to the SAME file through the resolver, so the fix can never
// produce a broken import. AST-based: replaces the import's source literal by node
// offsets. (docs/dotted-module-search-root.md)
function generateRelativeToDottedImportActions(
    ast: ProgramNode,
    document: TextDocument,
    uri: string,
    requestRange: Range
): CodeAction[] {
    const actions: CodeAction[] = [];
    if (!uri.startsWith('file://')) return actions;
    const importerPath = uriToFilePath(uri);
    const reqStart = document.offsetAt(requestRange.start);
    const reqEnd = document.offsetAt(requestRange.end);

    for (const stmt of ast.body) {
        if (stmt.type !== 'ImportDeclaration') continue;
        const imp = stmt as ImportDeclarationNode;
        if (imp.end < reqStart || imp.start > reqEnd) continue;
        const source = imp.source;
        const raw = typeof source.value === 'string' ? source.value : null;
        if (!raw || !(raw.startsWith('./') || raw.startsWith('../')) || !raw.endsWith('.uc')) continue;

        const targetPath = path.resolve(path.dirname(importerPath), raw);
        let exists = false;
        try { exists = fs.existsSync(targetPath); } catch { /* unreadable → no action */ }
        if (!exists) continue;

        // Nearest install-root mirror above the target.
        let root = path.dirname(targetPath);
        while (!root.endsWith(`${path.sep}share${path.sep}ucode`)
               && !root.endsWith(`${path.sep}lib${path.sep}ucode`)) {
            const parent = path.dirname(root);
            if (parent === root) { root = ''; break; }
            root = parent;
        }
        if (!root) continue;

        // Dotted name = target's path from the root, '/' → '.', '.uc' dropped. Every
        // segment must be a valid module-name segment (the runtime's template splice
        // accepts [A-Za-z0-9_.] only).
        const segments = path.relative(root, targetPath).slice(0, -3).split(path.sep);
        if (!segments.every(s => /^[A-Za-z_][A-Za-z0-9_]*$/.test(s))) continue;
        const dotted = segments.join('.');

        // Round-trip guard: the dotted form must resolve to the very same file (it could
        // instead hit a same-named module under the workspace root or importer's dir).
        const resolved = getCrossRefResolver().resolveImportPath(dotted, uri);
        if (!resolved || !resolved.startsWith('file://')
            || path.normalize(uriToFilePath(resolved)) !== path.normalize(targetPath)) continue;

        const q = document.getText({
            start: document.positionAt(source.start),
            end: document.positionAt(source.start + 1),
        }) === "'" ? "'" : '"';
        actions.push({
            title: `Convert to dotted module import ${q}${dotted}${q}`,
            kind: CodeActionKind.QuickFix,
            edit: { changes: { [uri]: [TextEdit.replace(
                { start: document.positionAt(source.start), end: document.positionAt(source.end) },
                `${q}${dotted}${q}`
            )] } },
        });
    }
    return actions;
}

// The top-of-file insertion point for a global declaration/definition: after a shebang line
// and after a `'use strict'` prologue (inserting above the directive would silently disable
// strict mode for the whole file).
function topInsertPosition(document: TextDocument): { line: number; character: number } {
    let line = 0;
    const lineText = (l: number) => document.getText({ start: { line: l, character: 0 }, end: { line: l + 1, character: 0 } });
    if (lineText(line).startsWith('#!')) line++;
    if (/^\s*(['"])use strict\1\s*;?\s*$/.test(lineText(line).replace(/\r?\n$/, ''))) line++;
    return { line, character: 0 };
}

// UC1001/UC1002: the name isn't declared here, but it may be a host-injected global (uhttpd,
// ubus, …). UC8004: the global IS assigned in-file, but non-deterministically — declaring it
// `@global` is the sanctioned "the environment guarantees it" opt-out. Either way, offer a
// JSDoc `@global` tag, which the LSP recognizes so the diagnostic stops. Inserts
// `/** @global <name> */` at the top of the file (after shebang / 'use strict').
function generateDeclareGlobalQuickFix(diagnostic: Diagnostic, document: TextDocument, uri: string): CodeAction[] {
    // UC8004 carries the exact name (the range covers the whole `global.X = …` assignment);
    // UC1001/UC1002 ranges start at the bare name or the call — take the leading identifier.
    const carried = (diagnostic.data as { globalName?: string } | undefined)?.globalName;
    const m = carried ? [carried] : document.getText(diagnostic.range).match(/^[A-Za-z_]\w*/);
    if (!m) return [];
    const name = m[0];
    const at = topInsertPosition(document);
    return [{
        title: `Declare '${name}' as an injected global (@global)`,
        kind: CodeActionKind.QuickFix,
        diagnostics: [diagnostic],
        edit: { changes: { [uri]: [TextEdit.insert(at, `/** @global ${name} */\n`)] } },
    }];
}

// UC8004: seed the global with a default at top level so its existence becomes deterministic
// (the conditional site then merely reassigns it). Inserts `global.X = null;` at the top of
// the file (after shebang / 'use strict').
function generateSeedGlobalDefaultQuickFix(diagnostic: Diagnostic, document: TextDocument, uri: string): CodeAction[] {
    const data = diagnostic.data as { globalName?: string; implicit?: boolean } | undefined;
    const name = data?.globalName;
    if (!name) return [];
    const at = topInsertPosition(document);
    return [{
        title: `Assign a default at top level (global.${name} = null;)`,
        kind: CodeActionKind.QuickFix,
        // Preferred for an explicit `global.x = …` (a real global); for a bare `x = …` the
        // declare-local fix is the preferred one instead.
        ...(data?.implicit === false ? { isPreferred: true } : {}),
        diagnostics: [diagnostic],
        edit: { changes: { [uri]: [TextEdit.insert(at, `global.${name} = null;\n`)] } },
    }];
}

// UC8004/UC8005: usually the name was meant to be a module-scoped LOCAL and the `let` was
// forgotten — a bare `x = …` then leaks an implicit global. Offer to declare it: `let <name>;`
// at the top of the file (after shebang / 'use strict'), making it a real module-local shared by
// the file's functions. Preferred over the explicit-global options (the common intent).
function generateDeclareLocalQuickFix(diagnostic: Diagnostic, document: TextDocument, uri: string): CodeAction[] {
    const data = diagnostic.data as { globalName?: string; implicit?: boolean } | undefined;
    const name = data?.globalName;
    // Only for a bare `x = …` (a forgotten `let`); an explicit `global.x = …` is a real global.
    if (!name || data?.implicit === false) return [];
    const at = topInsertPosition(document);
    return [{
        title: `Declare '${name}' as a local (let ${name};)`,
        kind: CodeActionKind.QuickFix,
        isPreferred: true,
        diagnostics: [diagnostic],
        edit: { changes: { [uri]: [TextEdit.insert(at, `let ${name};\n`)] } },
    }];
}

connection.onCodeAction((params: CodeActionParams): CodeAction[] => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
        return [];
    }

    const codeActions: CodeAction[] = [];

    // Get cached AST for context detection
    const cacheEntry = analysisCache.get(params.textDocument.uri);
    const ast = cacheEntry?.result?.ast;

    // Get diagnostics for the current range, sorted by range size (smallest/innermost first).
    // This ensures inner diagnostic fixes (root causes) take priority during deduplication.
    const diagnostics = [...params.context.diagnostics].sort((a: Diagnostic, b: Diagnostic) => {
        const sizeA = (a.range.end.line - a.range.start.line) * 10000 + (a.range.end.character - a.range.start.character);
        const sizeB = (b.range.end.line - b.range.start.line) * 10000 + (b.range.end.character - b.range.start.character);
        return sizeA - sizeB;
    });
    const disableLines = new Set<number>();

    for (const diagnostic of diagnostics) {
        // UC6015 is a PARSER diagnostic (source 'ucode-parser') — a colon-block keyword whose
        // opener is missing its `:`. Offer to insert the colon. Handled outside the
        // 'ucode-semantic' gate below.
        if (diagnostic.code === 'UC6015') {
            const colonFix = generateColonBlockQuickFix(diagnostic, document, params.textDocument.uri);
            if (colonFix) codeActions.push(colonFix);
        }

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
                    diagnostic, document, params.textDocument.uri, ast, cacheEntry?.result?.symbolTable
                );
                codeActions.push(...typeNarrowingActions);
            }

            // A string-coercing builtin (uc/lc, or match's subject) got a non-string arg → offer
            // to make the coercion explicit: wrap the argument in `"" + …`. (#30/#32)
            if (diagnostic.code === 'incompatible-function-argument' && diagnostic.data?.coerceToString) {
                codeActions.push(...generateCoerceToStringQuickFix(diagnostic, document, params.textDocument.uri));
            }

            // match(s, "…") with a string pattern → offer to convert it to the regex literal the
            // author almost certainly meant (ucode never treats a string as a regex). (#32)
            if (diagnostic.data?.convertStringToRegex) {
                codeActions.push(...generateStringToRegexQuickFix(diagnostic, document, params.textDocument.uri));
            }

            // Add import() type quick fix for UC7001 (unknown type in @param)
            if (diagnostic.code === 'UC7001') {
                const importActions = generateImportTypeQuickFix(
                    diagnostic, document, params.textDocument.uri
                );
                codeActions.push(...importActions);
            }

            // UC3006: a known module used without importing it → offer to add the import.
            if (diagnostic.code === 'UC3006' && ast) {
                codeActions.push(...generateAddImportQuickFix(diagnostic, document, ast, params.textDocument.uri));
            }

            // UC5005/UC5006: member access on a null / possibly-null receiver →
            // offer optional chaining (`.`→`?.`) and a null guard (`if (x) …`).
            if (diagnostic.code === 'UC5005' || diagnostic.code === 'UC5006') {
                codeActions.push(...generateNullAccessQuickFixes(diagnostic, document, params.textDocument.uri, ast));
            }

            // UC8001: throwing builtin outside try/catch → wrap it (and the rest of its
            // block) in a try/catch.
            if (diagnostic.code === 'UC8001') {
                codeActions.push(...generateWrapTryCatchQuickFix(diagnostic, document, params.textDocument.uri));
            }

            // UC8009: relative loadfile() path resolves against the PROCESS's launch dir
            // (CWD footgun). Two rewrites of the path literal (AST offsets from data):
            //  1. (preferred) file-relative via sourcepath(0, true) — the current file's
            //     directory at runtime, works from any launch dir (interpreter-verified)
            //  2. the deployed absolute path, when the target sits in an OpenWrt package
            //     `files/` tree (…/files/lib/netifd/x.uc installs at /lib/netifd/x.uc)
            if (diagnostic.code === UcodeErrorCode.LOADFILE_CWD_RELATIVE_PATH
                && (diagnostic as any).data?.loadfileRelPath) {
                const { raw, litStart, litEnd } = (diagnostic as any).data.loadfileRelPath;
                const litRange = { start: document.positionAt(litStart), end: document.positionAt(litEnd) };
                const q = document.getText({
                    start: litRange.start, end: document.positionAt(litStart + 1),
                }) === "'" ? "'" : '"';
                const tail = String(raw).replace(/^\.\//, '');
                codeActions.push({
                    title: `Make file-relative: sourcepath(0, true) + ${q}/${tail}${q}`,
                    kind: CodeActionKind.QuickFix,
                    diagnostics: [diagnostic],
                    isPreferred: true,
                    edit: { changes: { [params.textDocument.uri]: [
                        TextEdit.replace(litRange, `sourcepath(0, true) + ${q}/${tail}${q}`),
                    ] } },
                });
                const importerPath = uriToFilePath(params.textDocument.uri);
                const targetLocal = path.resolve(path.dirname(importerPath), String(raw));
                const filesIdx = targetLocal.indexOf(`${path.sep}files${path.sep}`);
                let deployedExists = false;
                try { deployedExists = filesIdx >= 0 && fs.existsSync(targetLocal); } catch { /* no fix */ }
                if (deployedExists) {
                    const deployed = targetLocal.substring(filesIdx + `${path.sep}files`.length);
                    codeActions.push({
                        title: `Use deployed absolute path ${q}${deployed}${q}`,
                        kind: CodeActionKind.QuickFix,
                        diagnostics: [diagnostic],
                        edit: { changes: { [params.textDocument.uri]: [
                            TextEdit.replace(litRange, `${q}${deployed}${q}`),
                        ] } },
                    });
                }
            }

            // UC8010: blocking recv() on a socketpair → offer to add MSG_DONTWAIT (making the
            // read non-blocking), auto-importing socket's MSG_DONTWAIT when it isn't in scope.
            if (diagnostic.code === UcodeErrorCode.BLOCKING_SOCKETPAIR_RECV
                && (diagnostic as any).data?.blockingRecv) {
                const fx = (diagnostic as any).data.blockingRecv as {
                    flagText: string; needsImport: boolean; mode: 'append' | 'or';
                    insertOffset?: number; arg1Start?: number; arg1End?: number;
                };
                const edits: TextEdit[] = [];
                if (fx.mode === 'append' && typeof fx.insertOffset === 'number') {
                    edits.push(TextEdit.insert(document.positionAt(fx.insertOffset), `, ${fx.flagText}`));
                } else if (fx.mode === 'or' && typeof fx.arg1Start === 'number' && typeof fx.arg1End === 'number') {
                    const existing = document.getText({
                        start: document.positionAt(fx.arg1Start), end: document.positionAt(fx.arg1End),
                    });
                    edits.push(TextEdit.replace(
                        { start: document.positionAt(fx.arg1Start), end: document.positionAt(fx.arg1End) },
                        `${existing} | ${fx.flagText}`));
                }
                if (edits.length > 0) {
                    if (fx.needsImport && ast) {
                        edits.push(computeImportInsertEdit(ast, document, `import { MSG_DONTWAIT } from 'socket';`));
                    }
                    codeActions.push({
                        title: `Make the read non-blocking: add ${fx.flagText}`,
                        kind: CodeActionKind.QuickFix,
                        diagnostics: [diagnostic],
                        isPreferred: true,
                        edit: { changes: { [params.textDocument.uri]: edits } },
                    });
                }
            }

            // UC6017: `/*/` lexes as a complete empty comment, not a regex matching '*'.
            // Offer to escape the star so it becomes the regex the author almost
            // certainly meant. The diagnostic's range IS the 3-char `/*/` span.
            if (diagnostic.code === UcodeErrorCode.SUSPICIOUS_EMPTY_COMMENT) {
                codeActions.push({
                    title: `Escape the '*' to make this a regex: /\\*/`,
                    kind: CodeActionKind.QuickFix,
                    diagnostics: [diagnostic],
                    isPreferred: true,
                    edit: { changes: { [params.textDocument.uri]: [
                        TextEdit.replace(diagnostic.range, `/\\*/`),
                    ] } },
                });
            }

            // UC8012 (FN-1): a handler registered outside a `{%` template → offer to wrap the
            // file in `{% … %}`. UC8013 (FN-2): a wrong-form entry point → convert to
            // `global.handle_request = …`.
            if (diagnostic.code === UcodeErrorCode.HANDLER_NOT_A_TEMPLATE
                && (diagnostic as any).data?.handlerFormFix?.mode === 'wrap') {
                const text = document.getText();
                // Keep a leading shebang line outside the template block.
                const shebang = /^#![^\n]*\n/.exec(text);
                const openAt = shebang ? shebang[0].length : 0;
                const needsNL = text.length > 0 && !text.endsWith('\n');
                codeActions.push({
                    title: 'Wrap the handler in a `{% … %}` template',
                    kind: CodeActionKind.QuickFix,
                    diagnostics: [diagnostic],
                    isPreferred: true,
                    edit: { changes: { [params.textDocument.uri]: [
                        TextEdit.insert(document.positionAt(openAt), '{%\n'),
                        TextEdit.insert(document.positionAt(text.length), `${needsNL ? '\n' : ''}%}\n`),
                    ] } },
                });
            }
            if (diagnostic.code === UcodeErrorCode.HANDLER_ENTRY_WRONG_FORM
                && (diagnostic as any).data?.handlerFormFix) {
                const fx = (diagnostic as any).data.handlerFormFix;
                const edits: TextEdit[] = [];
                if (fx.mode === 'toGlobalFunc') {
                    edits.push(TextEdit.replace(
                        { start: document.positionAt(fx.replaceStart), end: document.positionAt(fx.replaceEnd) },
                        'global.handle_request = function'));
                    edits.push(TextEdit.insert(document.positionAt(fx.appendAt), ';'));
                } else if (fx.mode === 'toGlobalVar') {
                    edits.push(TextEdit.replace(
                        { start: document.positionAt(fx.replaceStart), end: document.positionAt(fx.replaceEnd) },
                        'global.handle_request'));
                }
                if (edits.length > 0) {
                    codeActions.push({
                        title: 'Register as `global.handle_request`',
                        kind: CodeActionKind.QuickFix,
                        diagnostics: [diagnostic],
                        isPreferred: true,
                        edit: { changes: { [params.textDocument.uri]: edits } },
                    });
                }
            }

            // UC1001/UC1002: an undefined name may be a host-injected global → offer to
            // declare it with a JSDoc `@global` tag (silences the diagnostic).
            // UC8004 (shaky def) / UC8005 (read of a shaky global) additionally get the
            // preferred fix: seed a top-level default so the definition becomes deterministic.
            if (diagnostic.code === 'UC1001' || diagnostic.code === 'UC1002'
                || diagnostic.code === 'UC8004' || diagnostic.code === 'UC8005') {
                if (diagnostic.code === 'UC8004' || diagnostic.code === 'UC8005') {
                    // Declare-as-local first (preferred: usually a forgotten `let`), then the
                    // explicit-global options.
                    codeActions.push(...generateDeclareLocalQuickFix(diagnostic, document, params.textDocument.uri));
                    codeActions.push(...generateSeedGlobalDefaultQuickFix(diagnostic, document, params.textDocument.uri));
                }
                codeActions.push(...generateDeclareGlobalQuickFix(diagnostic, document, params.textDocument.uri));
            }

            // UC6005: syntax valid in newer ucode but not the configured target. Offer
            // the compat fix (here: add the trailing `;`) plus a command to retarget.
            if (diagnostic.code === 'UC6005') {
                codeActions.push({
                    title: `Add ';' (compatible with OpenWrt ${ucodeTargetVersion})`,
                    kind: CodeActionKind.QuickFix,
                    diagnostics: [diagnostic],
                    isPreferred: true,
                    edit: { changes: { [params.textDocument.uri]: [TextEdit.insert(diagnostic.range.end, ';')] } },
                });
                codeActions.push({
                    title: 'Change ucode target version…',
                    kind: CodeActionKind.QuickFix,
                    diagnostics: [diagnostic],
                    command: { title: 'Change ucode target version', command: 'ucode.selectTargetVersion' },
                });
            }

            // UC6007: `!x = y` parses as `!(x = y)`. Offer to add the clarifying parens
            // around the assignment (AST-based: uses the assignment node's offsets).
            if (diagnostic.code === 'UC6007' && (diagnostic as any).data?.unaryAssign) {
                const { assignStart, assignEnd } = (diagnostic as any).data.unaryAssign;
                codeActions.push({
                    title: 'Add parentheses around the assignment',
                    kind: CodeActionKind.QuickFix,
                    diagnostics: [diagnostic],
                    isPreferred: true,
                    edit: { changes: { [params.textDocument.uri]: [
                        TextEdit.insert(document.positionAt(assignStart), '('),
                        TextEdit.insert(document.positionAt(assignEnd), ')'),
                    ] } },
                });
            }

            // UC7005: an `@returns {T}` annotation that doesn't match the body. Offer to set
            // the type expression to the TRUE inferred return type (the full union of returns;
            // `null` when there's no return). AST-based: replaces the `{…}` span the analyzer
            // located in the JSDoc, never line-string parsing.
            if (diagnostic.code === 'UC7005' && (diagnostic as any).data?.ucReturnsFix) {
                const fix = (diagnostic as any).data.ucReturnsFix;
                const range = { start: document.positionAt(fix.exprStart), end: document.positionAt(fix.exprEnd) };
                codeActions.push({
                    title: `Change @returns to '{${fix.suggested}}'`,
                    kind: CodeActionKind.QuickFix,
                    diagnostics: [diagnostic],
                    isPreferred: true,
                    edit: { changes: { [params.textDocument.uri]: [TextEdit.replace(range, `{${fix.suggested}}`)] } },
                });
            }

            // Quick-fix for the UC2009 type()-string mismatch: replace the wrong
            // type string (e.g. "number", "integer", "boolean") with the correct
            // ucode type name(s) ("int"/"double", "int", "bool").
            if (diagnostic.code === 'UC2009' && (diagnostic as any).data?.typeStringFix) {
                const fixData = (diagnostic as any).data;
                const range = {
                    start: document.positionAt(fixData.litStart),
                    end: document.positionAt(fixData.litEnd),
                };
                const suggestions: string[] = fixData.typeStringFix;
                for (const suggestion of suggestions) {
                    codeActions.push({
                        title: `Change to "${suggestion}"`,
                        kind: CodeActionKind.QuickFix,
                        diagnostics: [diagnostic],
                        isPreferred: suggestions.length === 1,
                        edit: { changes: { [params.textDocument.uri]: [TextEdit.replace(range, `"${suggestion}"`)] } },
                    });
                }
            }

            // Add JSDoc annotation quick fix.
            //   - UC7003 fires this directly on the function declaration.
            //   - incompatible-function-argument / nullable-argument also fire it when
            //     the offending arg is a parameter identifier — annotating the
            //     enclosing function is a zero-runtime alternative to the type-guard
            //     fixes offered by generateTypeNarrowingQuickFixes above.
            const isJsDocTrigger =
                diagnostic.code === 'UC7003'
                || ((diagnostic.code === 'incompatible-function-argument' || diagnostic.code === 'nullable-argument')
                    && (diagnostic as any).data
                    && typeof (diagnostic as any).data.variableName === 'string');
            if (isJsDocTrigger && ast && cacheEntry?.result) {
                const diagOffset = document.offsetAt(diagnostic.range.start);
                const jsDocAction = generateJsDocQuickFix(ast, diagOffset, document, params.textDocument.uri, cacheEntry.result);
                if (jsDocAction) {
                    // For call-site triggers, only offer the fix when the flagged
                    // variable actually IS a parameter of the enclosing function —
                    // otherwise the JSDoc edit wouldn't help (the unknown arg came
                    // from somewhere else like a local or property access).
                    if (diagnostic.code === 'UC7003') {
                        jsDocAction.diagnostics = [diagnostic];
                        codeActions.push(jsDocAction);
                    } else {
                        const varName = (diagnostic as any).data.variableName;
                        const funcNode = findFunctionAtOffset(ast, diagOffset);
                        const isParam = funcNode?.params?.some((p: IdentifierNode) => p.name === varName);
                        if (isParam) {
                            jsDocAction.diagnostics = [diagnostic];
                            codeActions.push(jsDocAction);
                        }
                    }
                }
            }

            // Track lines needing disable action (added after all other actions)
            if (!lineText.includes('// ucode-lsp disable') && !disableLines.has(line)) {
                disableLines.add(line);
            }
        }
    }

    // Add "Disable ucode-lsp" actions last so they appear at the bottom of the Quick Fix menu
    for (const line of disableLines) {
        const lineText = document.getText({
            start: { line: line, character: 0 },
            end: { line: line + 1, character: 0 }
        }).replace(/\r?\n$/, '');
        codeActions.push({
            title: 'Disable ucode-lsp for this line',
            kind: CodeActionKind.QuickFix,
            diagnostics: params.context.diagnostics.filter(
                (d: Diagnostic) => d.source === 'ucode-semantic' && d.range.start.line === line
            ),
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

    // Diagnostic-independent: offer to rewrite a `./`-relative import of a file under a
    // mirrored install root (share/ucode | lib/ucode) into the conventional dotted form.
    if (ast) {
        codeActions.push(...generateRelativeToDottedImportActions(ast, document, params.textDocument.uri, params.range));
    }

    // Deduplicate actions with the same title — overlapping diagnostics
    // (e.g., length(iptoarr(m[0]))) can produce identical "Extract to variable"
    // actions from both the inner and outer diagnostic.
    const seen = new Set<string>();
    const dedupedActions: typeof codeActions = [];
    for (const action of codeActions) {
        if (!seen.has(action.title)) {
            seen.add(action.title);
            dedupedActions.push(action);
        }
    }

    return dedupedActions;
});

// ── Cross-file reference search (for the "N references" CodeLens) ───────────
// Parses each workspace .uc file once (cached by mtime) and, per target export,
// walks files that import it for real usages of the imported binding. Import
// statements themselves are excluded by findFunctionReferences.
interface RefLocation {
    uri: string;
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
}

let crossRefResolver: FileResolver | null = null;
function getCrossRefResolver(): FileResolver {
    if (!crossRefResolver) crossRefResolver = new FileResolver(workspaceFolders[0] || process.cwd());
    return crossRefResolver;
}

interface WorkspaceFileEntry { mtimeMs: number; ast: AstNode | null; doc: TextDocument; bindings: ImportBinding[]; openVersion?: number }
const workspaceFileCache = new Map<string, WorkspaceFileEntry | null>();
let wsFileListCache: { files: string[]; at: number } | null = null;
const WS_FILE_TTL_MS = 10000;

function listWorkspaceUcodeFiles(): string[] {
    const now = Date.now();
    if (wsFileListCache && now - wsFileListCache.at < WS_FILE_TTL_MS) return wsFileListCache.files;
    const files: string[] = [];
    const walk = (dir: string): void => {
        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) { if (!shouldSkipDirectory(e.name)) walk(full); }
            else if (e.isFile() && isUcodeSourceFile(full)) files.push(full);
        }
    };
    for (const folder of workspaceFolders) walk(folder);
    wsFileListCache = { files, at: now };
    return files;
}

// Cached flat index of every NAMED export across the workspace, for auto-import.
// Building it reads each file (via getModuleExports' content-cached parse) once;
// completion then iterates this in memory instead of re-reading N files per
// keystroke. Invalidated on file save/create/delete + close (invalidateExportIndex)
// with the same TTL as the file list as a backstop. Entries are unique per
// (name, filePath), so a name exported by two files yields two pickable sources.
interface ExportIndexEntry { name: string; filePath: string; isFunction: boolean; }
let exportIndexCache: { entries: ExportIndexEntry[]; at: number } | null = null;

function getWorkspaceExportIndex(): ExportIndexEntry[] {
    const now = Date.now();
    if (exportIndexCache && now - exportIndexCache.at < WS_FILE_TTL_MS) return exportIndexCache.entries;
    const resolver = getCrossRefResolver();
    const entries: ExportIndexEntry[] = [];
    for (const filePath of listWorkspaceUcodeFiles()) {
        const exports = resolver.getModuleExports(filePathToUri(filePath));
        if (!exports) continue;
        const resolved = path.resolve(filePath); // normalize for current-file comparison
        for (const exp of exports) {
            if (exp.type === 'named') entries.push({ name: exp.name, filePath: resolved, isFunction: exp.isFunction });
        }
    }
    exportIndexCache = { entries, at: now };
    return entries;
}

// Cross-file include() render-scope index (template phase 4b): resolved-target-path →
// the scope its includers inject. Built from the workspace ASTs (template-parsed via
// getWorkspaceFile), cached like the export index and cleared by invalidateExportIndex.
let includeScopeIndexCache: { index: Map<string, IncludeScopeEntry>; at: number } | null = null;

function getWorkspaceIncludeScopeIndex(): Map<string, IncludeScopeEntry> {
    const now = Date.now();
    if (includeScopeIndexCache && now - includeScopeIndexCache.at < WS_FILE_TTL_MS) return includeScopeIndexCache.index;
    const entries: Array<{ path: string; ast: AstNode | null }> = [];
    for (const filePath of listWorkspaceUcodeFiles()) {
        const wf = getWorkspaceFile(filePath);
        if (wf?.ast) entries.push({ path: path.resolve(filePath), ast: wf.ast });
    }
    // resolveRequireType: a scope value `require("mod")` injects that module's type when mod
    // is a builtin module (e.g. fs/uci/math); user-module requires stay unknown.
    const index = buildIncludeScopeIndex(entries, {
        resolveRequireType: (mod) => (isKnownModule(mod) ? mod : null),
    });
    includeScopeIndexCache = { index, at: now };
    return index;
}

function invalidateExportIndex(): void { exportIndexCache = null; includeScopeIndexCache = null; }

function getWorkspaceFile(filePath: string): WorkspaceFileEntry | null {
    const uri = filePathToUri(filePath);
    const parseEntry = (content: string, doc: TextDocument, key: Partial<WorkspaceFileEntry>): WorkspaceFileEntry | null => {
        try {
            const isTemplate = detectTemplateMode(content);
            const lexer = new UcodeLexer(content, { rawMode: !isTemplate });
            const tokens = isTemplate ? bridgeTemplateTokens(lexer.tokenize()) : lexer.tokenize();
            const parser = new UcodeParser(tokens, content);
            parser.setComments(lexer.comments);
            const ast = parser.parse().ast;
            return { mtimeMs: -1, ...key, ast, doc, bindings: getImportBindings(ast) };
        } catch { return null; }
    };

    // Prefer the live (possibly unsaved) editor buffer so cross-file refs/rename use
    // current content, not stale disk. Cache by document version.
    const openDoc = documents.get(uri);
    if (openDoc) {
        const cached = workspaceFileCache.get(filePath);
        if (cached && cached.openVersion === openDoc.version) return cached;
        const entry = parseEntry(openDoc.getText(), openDoc, { openVersion: openDoc.version });
        workspaceFileCache.set(filePath, entry);
        return entry;
    }

    // Closed file: read from disk, cached by mtime.
    let mtimeMs = 0;
    try { mtimeMs = fs.statSync(filePath).mtimeMs; } catch { return null; }
    const cached = workspaceFileCache.get(filePath);
    if (cached && cached.mtimeMs === mtimeMs) return cached;
    let entry: WorkspaceFileEntry | null = null;
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        entry = parseEntry(content, TextDocument.create(uri, 'ucode', 1, content), { mtimeMs });
    } catch { entry = null; }
    workspaceFileCache.set(filePath, entry);
    return entry;
}

// Find usages of `fnName` (exported from `targetUri`) in OTHER workspace files.
function findCrossFileReferences(targetUri: string, fnName: string): RefLocation[] {
    const out: RefLocation[] = [];
    if (workspaceFolders.length === 0) return out;
    const resolver = getCrossRefResolver();
    const exports = resolver.getModuleExports(targetUri);
    if (!exports) return out;
    const isDefault = exports.some(e => e.name === 'default' && e.exportedName === fnName);
    const isNamed = exports.some(e => e.name === fnName);
    // fnName may instead be a METHOD of the object some exported FACTORY returns —
    // reached cross-file as `recv.fnName` where `recv = <factory>(…)`. The factory
    // can be the default export (`export default create_sys`) OR a named export
    // (`export function create_widget() { return { do_thing }; }`).
    const factories: Array<{ kind: 'default' | 'named'; exportName: string }> = [];
    if (!isDefault) {
        const defInfo = resolver.getDefaultExportFunctionReturnInfo(targetUri);
        if (defInfo?.returnPropertyTypes?.has(fnName)) factories.push({ kind: 'default', exportName: 'default' });
    }
    for (const e of exports) {
        if (e.type === 'named' && e.isFunction && e.name !== fnName) {
            const ni = resolver.getNamedExportFunctionReturnInfo(targetUri, e.name);
            if (ni?.returnPropertyTypes?.has(fnName)) factories.push({ kind: 'named', exportName: e.name });
        }
    }
    const isFactoryMethod = factories.length > 0;
    if (!isDefault && !isNamed && !isFactoryMethod) return out; // not reachable cross-file

    const targetPath = path.resolve(uriToFilePath(targetUri));
    for (const filePath of listWorkspaceUcodeFiles()) {
        if (path.resolve(filePath) === targetPath) continue; // in-file handled separately
        const entry = getWorkspaceFile(filePath);
        if (!entry || !entry.ast || entry.bindings.length === 0) continue;
        const entryAst = entry.ast;
        const fileUri = filePathToUri(filePath);
        for (const b of entry.bindings) {
            const resolved = resolver.resolveImportPath(b.source, fileUri);
            if (!resolved || path.resolve(uriToFilePath(resolved)) !== targetPath) continue;
            // Namespace import (`import * as ns`): count `ns.fn` member accesses
            // of the named export.
            if (isNamed && b.namespaceLocal) {
                for (const r of findNamespaceMemberReferences(entryAst, b.namespaceLocal, fnName)) {
                    out.push({ uri: fileUri, range: { start: entry.doc.positionAt(r.start), end: entry.doc.positionAt(r.end) } });
                }
            }
            // Factory-returned method: find `recv.fnName` where `recv` comes from
            // calling the imported factory (default import, or a named import of
            // the specific factory export).
            for (const fd of factories) {
                const factoryLocal = fd.kind === 'default'
                    ? b.defaultLocal
                    : b.named.find(n => n.imported === fd.exportName)?.local;
                if (!factoryLocal) continue;
                for (const r of findFactoryMethodReferences(entryAst, factoryLocal, fnName)) {
                    out.push({ uri: fileUri, range: { start: entry.doc.positionAt(r.start), end: entry.doc.positionAt(r.end) } });
                }
            }
            // Default or named import bound to a local name: count plain usages.
            let localName: string | undefined;
            if (isDefault && b.defaultLocal) localName = b.defaultLocal;
            else if (isNamed) localName = b.named.find(n => n.imported === fnName)?.local;
            if (!localName) continue;
            for (const r of findFunctionReferences(entryAst, localName, null)) {
                out.push({ uri: fileUri, range: { start: entry.doc.positionAt(r.start), end: entry.doc.positionAt(r.end) } });
            }
        }
    }
    // Dedup: a location could be reached by more than one path (e.g. a method
    // name returned by two factories, or factory-method + plain-usage overlap).
    const seen = new Set<string>();
    return out.filter(loc => {
        const key = `${loc.uri}:${loc.range.start.line}:${loc.range.start.character}:${loc.range.end.line}:${loc.range.end.character}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

// Does `ast` (a file at `callerFilePath`) contain a `loadfile(<literal>)()` whose path
// resolves to `targetPath`? (Relative to the caller's dir, matching getLoadfileGlobals.)
function fileLoadfilesTarget(ast: AstNode, callerFilePath: string, targetPath: string): boolean {
    let found = false;
    const walk = (n: any): void => {
        if (found || !n || typeof n.type !== 'string') return;
        if (n.type === 'CallExpression' && n.callee?.type === 'CallExpression') {
            const lf = n.callee;
            if (lf.callee?.type === 'Identifier' && lf.callee.name === 'loadfile'
                && lf.arguments?.[0]?.type === 'Literal' && typeof lf.arguments[0].value === 'string') {
                const raw: string = lf.arguments[0].value;
                const resolved = raw.startsWith('/') ? path.normalize(raw) : path.normalize(path.join(path.dirname(callerFilePath), raw));
                if (path.resolve(resolved) === targetPath) { found = true; return; }
            }
        }
        for (const k of Object.keys(n)) {
            if (k === 'leadingJsDoc' || found) continue;
            const v = (n as Record<string, unknown>)[k];
            if (Array.isArray(v)) { for (const it of v) walk(it); }
            else if (v && typeof v === 'object' && typeof (v as { type?: unknown }).type === 'string') walk(v);
        }
    };
    walk(ast);
    return found;
}

// References to a `loadfile()()`-injected GLOBAL (`global.X = fn` / bare `X = fn`) defined in
// `targetUri`: its callers reach it as a bare `X(...)`, so find every workspace file that
// loadfile()s the target and collect bare references to the name there. (Import-edge search
// in findCrossFileReferences can't see loadfile callers — no import binding, no export.)
function findLoadfileCallerReferences(targetUri: string, fnName: string): RefLocation[] {
    const out: RefLocation[] = [];
    if (workspaceFolders.length === 0) return out;
    const targetPath = path.resolve(uriToFilePath(targetUri));
    for (const filePath of listWorkspaceUcodeFiles()) {
        if (path.resolve(filePath) === targetPath) continue;
        const entry = getWorkspaceFile(filePath);
        if (!entry?.ast || !fileLoadfilesTarget(entry.ast, filePath, targetPath)) continue;
        const fileUri = filePathToUri(filePath);
        for (const r of findFunctionReferences(entry.ast, fnName, null)) {
            out.push({ uri: fileUri, range: { start: entry.doc.positionAt(r.start), end: entry.doc.positionAt(r.end) } });
        }
    }
    return out;
}

// CodeLens: a per-function git-history annotation. onCodeLens enumerates the
// functions and returns lenses WITHOUT running git (fast); the git call happens
// lazily in onCodeLensResolve, only for lenses the editor actually displays.
connection.onCodeLens(async (params: CodeLensParams): Promise<CodeLens[]> => {
    let cacheEntry = analysisCache.get(params.textDocument.uri);
    if (!cacheEntry?.result?.ast) {
        const doc = documents.get(params.textDocument.uri);
        if (doc) {
            await validateAndAnalyzeDocument(doc);
            cacheEntry = analysisCache.get(params.textDocument.uri);
        }
    }
    const document = documents.get(params.textDocument.uri);
    const ast = cacheEntry?.result?.ast;
    if (!document || !ast) return [];

    const lenses: CodeLens[] = [];
    for (const fn of collectCodeLensFunctions(ast)) {
        // Anchor the lens directly on the definition line — never above a leading
        // comment/JSDoc block, which would float the lens far from what it describes.
        const anchorLine = document.positionAt(fn.anchorStart).line;
        // node.end is EXCLUSIVE, so step back one char to land on the last line.
        const startLine = document.positionAt(fn.defStart).line + 1; // git -L is 1-based
        const endLine = document.positionAt(Math.max(fn.defStart, fn.defEnd - 1)).line + 1;
        const range = { start: { line: anchorLine, character: 0 }, end: { line: anchorLine, character: 0 } };
        const uri = params.textDocument.uri;
        // Two lenses per function (rendered side by side): git history + references.
        // `nameStart` keys the target stably across the serialize/resolve round-trip.
        lenses.push(CodeLens.create(range, { kind: 'git', uri, startLine, endLine, name: fn.name }));
        lenses.push(CodeLens.create(range, { kind: 'refs', uri, nameStart: fn.nameStart, name: fn.name }));
    }
    return lenses;
});

connection.onCodeLensResolve((lens: CodeLens): CodeLens => {
    const data = lens.data as any;
    if (!data) return lens;

    // References lens: count in-file references to the function and wire a peek.
    if (data.kind === 'refs') {
        const cacheEntry = analysisCache.get(data.uri);
        const ast = cacheEntry?.result?.ast;
        const document = documents.get(data.uri);
        const fn = ast ? collectCodeLensFunctions(ast).find((f) => f.nameStart === data.nameStart) : undefined;
        if (!ast || !document || !fn) {
            lens.command = Command.create('no references', '');
            return lens;
        }
        // Scope-aware in-file resolution: keep a name-matched candidate only if
        // it resolves to THIS function's binding (not a shadowing param/local),
        // using the symbol table's position-aware lookup + declaration offset.
        // (Skipped for function-valued globals — they have no in-table symbol; a plain
        // name match plus the def-identifier exclusion is correct there.)
        const symbolTable = cacheEntry?.result?.symbolTable;
        let isReference: ((node: { start: number }) => boolean) | undefined;
        if (symbolTable && typeof symbolTable.lookupAtPosition === 'function') {
            const targetSym = symbolTable.lookupAtPosition(fn.name, fn.nameStart) ?? symbolTable.lookup(fn.name);
            const targetDeclaredAt = targetSym?.declaredAt;
            if (targetDeclaredAt !== undefined) {
                isReference = (node: { start: number }): boolean => {
                    const s = symbolTable.lookupAtPosition(fn.name, node.start) ?? symbolTable.lookup(fn.name);
                    return !!s && s.declaredAt === targetDeclaredAt;
                };
            }
        }
        // Object-literal methods are called as `<memberOf>.name` (member access), so count
        // member references through the binding; an unbound `return {…}` (memberOf === '')
        // has no in-file base. Plain functions/globals are bare-name calls.
        const inFileRefs = fn.memberOf !== undefined
            ? (fn.memberOf ? findNamespaceMemberReferences(ast, fn.memberOf, fn.name) : [])
            : findFunctionReferences(ast, fn.name, fn.idNode, isReference);
        // Cross-file fan-out is the bare-name/global case only; member-through-binding
        // cross-file resolution is out of scope here. A function-valued GLOBAL also fans out
        // through loadfile()() callers (no import edge), so follow those too.
        const crossFileRefs = fn.memberOf !== undefined
            ? []
            : [...findCrossFileReferences(data.uri, fn.name),
               ...(fn.isGlobal ? findLoadfileCallerReferences(data.uri, fn.name) : [])];
        const total = inFileRefs.length + crossFileRefs.length;
        const title = formatReferencesTitle(total);
        if (total === 0) {
            lens.command = Command.create(title, ''); // non-clickable label
            return lens;
        }
        const declPosition = document.positionAt(fn.nameStart);
        const locations = [
            ...inFileRefs.map(r => ({
                uri: data.uri,
                range: { start: document.positionAt(r.start), end: document.positionAt(r.end) }
            })),
            ...crossFileRefs
        ];
        lens.command = Command.create(title, 'ucode.showFunctionReferences', data.uri, declPosition, locations);
        return lens;
    }

    // Git history lens (default).
    const filePath = uriToFilePath(data.uri);
    const summary = getFunctionGitSummary(filePath, data.startLine, data.endLine);
    if (!summary) {
        // Muted, non-clickable text (empty command id renders as plain label).
        lens.command = Command.create('No git history', '');
        return lens;
    }
    lens.command = Command.create(
        formatSummaryTitle(summary),
        'ucode.showFunctionHistory',
        data.uri, data.startLine, data.endLine, data.name
    );
    return lens;
});

connection.onDefinition(async (params) => {
    await ensureFullAnalysis(params.textDocument.uri); // full types inside unchanged bodies
    // Convert cache format for definition handler
    const legacyCache = new Map<string, SemanticAnalysisResult>();
    for (const [uri, entry] of analysisCache.entries()) {
        legacyCache.set(uri, entry.result);
    }
    return handleDefinition(params, documents, legacyCache);
});

// ── Symbol resolution shared by references / rename / highlight ─────────────

interface ResolvedSymbol {
    name: string;
    /** offset of the binding's declaration id, if known (for include-declaration
     *  handling and rename safety). */
    declaredAt: number | undefined;
    /** scope-aware predicate: is this name-matched identifier node the SAME
     *  binding as the one under the cursor (vs a shadowing local/param)? */
    isReference: (node: { start: number }) => boolean;
}

/** The identifier name at `offset`, using the cached lexer tokens. */
function identifierNameAt(tokens: Token[], offset: number): { name: string; start: number; end: number } | null {
    if (!Array.isArray(tokens)) return null;
    const tok = tokens.find(t => t && t.type === TokenType.TK_LABEL && t.pos <= offset && offset <= t.end);
    return tok && typeof tok.value === 'string' ? { name: tok.value, start: tok.pos, end: tok.end } : null;
}

/** Resolve the symbol under the cursor into a name + scope-aware reference
 *  predicate. Returns null when there's no identifier there. */
function resolveSymbolAt(uri: string, position: { line: number; character: number }): ResolvedSymbol | null {
    const entry = analysisCache.get(uri);
    const document = documents.get(uri);
    if (!entry || !document) return null;
    const offset = document.offsetAt(position);
    const ident = identifierNameAt(entry.tokens, offset);
    if (!ident) return null;
    const name = ident.name;
    const symbolTable: SymbolTable = entry.result.symbolTable;
    const targetSym = symbolTable?.lookupAtPosition?.(name, offset) ?? symbolTable?.lookup?.(name);
    const declaredAt: number | undefined = targetSym?.declaredAt;

    // Scope-aware predicate (mirrors the references CodeLens): a name match counts
    // only when it resolves to the SAME binding (same declaredAt). Without a
    // symbol/declaredAt, fall back to plain name matching.
    let isReference: (node: { start: number }) => boolean = () => true;
    if (declaredAt !== undefined && typeof symbolTable?.lookupAtPosition === 'function') {
        isReference = (node) => {
            const s = symbolTable.lookupAtPosition(name, node.start) ?? symbolTable.lookup(name);
            return !!s && s.declaredAt === declaredAt;
        };
    }
    return { name, declaredAt, isReference };
}

/** All references to the symbol at `position` — in-file (scope-aware) plus, when
 *  this file exports the name, cross-file usages. `includeDeclaration` controls
 *  whether the binding's own declaration is included. */
/** When `name` in `uri` is an imported symbol, resolve it to the file that declares
 *  it and the name it has THERE (the export name). Lets a references/rename query
 *  from an import site fan out across the whole workspace via findCrossFileReferences,
 *  which keys on (exporter file, export name). Handles named (incl. `as` aliases)
 *  and default imports; namespace member access (`ns.foo`) is not routed here. */
function resolveImportedCanonical(uri: string, name: string): { canonicalUri: string; canonicalName: string } | null {
    const entry = analysisCache.get(uri);
    if (!entry) return null;
    const resolver = getCrossRefResolver();
    for (const b of getImportBindings(entry.result.ast)) {
        const named = b.named.find(n => n.local === name);
        if (named) {
            const su = resolver.resolveImportPath(b.source, uri);
            if (su) return { canonicalUri: su, canonicalName: named.imported };
            return null;
        }
        if (b.defaultLocal === name) {
            const su = resolver.resolveImportPath(b.source, uri);
            // The default export's local name in the source (e.g. `export default create_sys`).
            const cn = su ? resolver.getModuleExports(su)?.find(e => e.type === 'default')?.exportedName : undefined;
            if (su && cn) return { canonicalUri: su, canonicalName: cn };
            return null;
        }
    }
    return null;
}

/** Offset span of a top-level declaration of `name` (function or variable), so a
 *  reference/rename query includes the declaration itself — findFunctionReferences
 *  intentionally omits declaration ids. */
function findTopLevelDeclId(ast: AstNode | null | undefined, name: string): { start: number; end: number } | null {
    if (!ast) return null;
    const body = (asWalkable(ast).body ?? []) as WalkableNode[];
    for (const stmt of body) {
        const decl = (stmt?.type === 'ExportNamedDeclaration' || stmt?.type?.startsWith('ExportDefault'))
            ? (stmt.declaration as WalkableNode | undefined) : stmt;
        const declId = decl?.id as WalkableNode | undefined;
        if (decl?.type === 'FunctionDeclaration' && declId?.name === name) return { start: declId.start, end: declId.end };
        if (decl?.type === 'VariableDeclaration') {
            for (const d of ((decl.declarations as WalkableNode[] | undefined) ?? [])) {
                const id = d?.id as WalkableNode | undefined;
                if (id?.type === 'Identifier' && id.name === name) return { start: id.start, end: id.end };
            }
        }
    }
    return null;
}

/** References to `name` WITHIN `targetUri` (the declaration + local usages). Uses the
 *  open-file scope-aware analysis when available, else a parse-only name walk of the
 *  workspace-cached AST. findCrossFileReferences excludes the exporter itself, so this
 *  supplies the source file's own occurrences (including its declaration). */
function collectInFileRefsByName(targetUri: string, name: string): Array<{ uri: string; range: Range }> {
    const open = analysisCache.get(targetUri);
    const openDoc = documents.get(targetUri);
    const ast = open?.result.ast ?? getWorkspaceFile(uriToFilePath(targetUri))?.ast;
    const doc = openDoc ?? getWorkspaceFile(uriToFilePath(targetUri))?.doc;
    if (!ast || !doc) return [];
    const out = findFunctionReferences(ast, name, null)
        .map(s => ({ uri: targetUri, range: { start: doc.positionAt(s.start), end: doc.positionAt(s.end) } }));
    const decl = findTopLevelDeclId(ast, name);
    if (decl) out.push({ uri: targetUri, range: { start: doc.positionAt(decl.start), end: doc.positionAt(decl.end) } });
    return out;
}

/** The non-computed member expression whose `.property` identifier spans `offset`. */
function findMemberPropertyAt(ast: AstNode | null | undefined, offset: number): { object: AstNode; property: IdentifierNode } | null {
    let found: { object: AstNode; property: IdentifierNode } | null = null;
    const visit = (node: AstNode): void => {
        if (found || !node || typeof node !== 'object' || typeof node.type !== 'string') return;
        const mem = node as MemberExpressionNode;
        if (node.type === 'MemberExpression' && !mem.computed && (mem.property as AstNode)?.type === 'Identifier'
            && offset >= mem.property.start && offset <= mem.property.end) {
            found = { object: mem.object, property: mem.property as IdentifierNode };
            return;
        }
        for (const k of Object.keys(node)) {
            if (k === 'leadingJsDoc') continue;
            const v = asWalkable(node)[k];
            if (Array.isArray(v)) { for (const it of v) visit(it as AstNode); }
            else if (v && typeof v === 'object' && typeof (v as AstNode).type === 'string') visit(v as AstNode);
        }
    };
    if (ast) visit(ast);
    return found;
}

/** When the cursor is on a member property `X.prop` whose receiver `X` is a namespace
 *  import or a factory-returned local, resolve it to the file that declares `prop` so
 *  references can fan out — clicking `lib.foo` / `sh.exec` in an importer otherwise
 *  resolves to nothing (the bare name isn't an imported symbol). */
function resolveMemberCanonical(uri: string, position: { line: number; character: number }): { canonicalUri: string; canonicalName: string } | null {
    const entry = analysisCache.get(uri);
    const document = documents.get(uri);
    if (!entry || !document) return null;
    const member = findMemberPropertyAt(entry.result.ast, document.offsetAt(position));
    if (!member || member.object.type !== 'Identifier') return null;
    const objName = (member.object as IdentifierNode).name;
    const propName = member.property.name;

    // Namespace import: `import * as lib` → `lib.prop` is the named export `prop`.
    const resolver = getCrossRefResolver();
    for (const b of getImportBindings(entry.result.ast)) {
        if (b.namespaceLocal === objName) {
            const su = resolver.resolveImportPath(b.source, uri);
            return su ? { canonicalUri: su, canonicalName: propName } : null;
        }
    }
    // Factory-returned local: `let sh = make()` → `sh.prop` is a method whose source
    // file is recorded on the receiver symbol's propertyDefinitionLocations.
    const objSym: Symbol | null | undefined = entry.result.symbolTable?.lookupAtPosition?.(objName, member.object.start)
        ?? entry.result.symbolTable?.lookup?.(objName);
    const loc = objSym?.propertyDefinitionLocations?.get?.(propName);
    if (loc?.uri) return { canonicalUri: loc.uri, canonicalName: propName };
    return null;
}

/** The KEY node of a function-valued property `methodName` on an object-literal node,
 *  or null when the node isn't an object literal or has no such function-valued member.
 *  Mirrors signatureHelp's localObjectLiteralMethodParams but returns the key span so
 *  references can surface the definition site. */
function objectLiteralMethodKey(objLit: AstNode | undefined, methodName: string): { start: number; end: number } | null {
    if (!objLit || objLit.type !== 'ObjectExpression') return null;
    for (const p of (objLit as ObjectExpressionNode).properties || []) {
        if (!p || p.type !== 'Property' || (p as PropertyNode).computed) continue;
        const key = (p as PropertyNode).key;
        const keyName = key?.type === 'Identifier' ? (key as IdentifierNode).name
            : key?.type === 'Literal' && typeof (key as LiteralNode).value === 'string' ? (key as LiteralNode).value as string
            : null;
        if (keyName !== methodName) continue;
        const val = (p as PropertyNode).value;
        if ((val?.type === 'FunctionExpression' || val?.type === 'ArrowFunctionExpression') && key) {
            return { start: key.start, end: key.end };
        }
        return null;
    }
    return null;
}

/** Cursor on an object-literal property KEY (`run:` in `let o = { run: fn }`): find the
 *  local variable the object literal is bound to and the method name, so references on
 *  the definition site resolve just like a call-site click. Handles `let/const o = {…}`
 *  and `o = {…}` bindings. Null when the key isn't a function-valued member of a
 *  directly-bound object literal. */
function findObjectMethodKeyBinding(ast: AstNode | null | undefined, offset: number): { objName: string; methodName: string } | null {
    let found: { objName: string; methodName: string } | null = null;
    const check = (objName: string, init: AstNode | null | undefined): boolean => {
        if (!init || init.type !== 'ObjectExpression') return false;
        for (const p of (init as ObjectExpressionNode).properties || []) {
            if (!p || p.type !== 'Property' || (p as PropertyNode).computed) continue;
            const key = (p as PropertyNode).key;
            if (!key || offset < key.start || offset > key.end) continue;
            const val = (p as PropertyNode).value;
            const keyName = key.type === 'Identifier' ? (key as IdentifierNode).name
                : key.type === 'Literal' && typeof (key as LiteralNode).value === 'string' ? (key as LiteralNode).value as string
                : null;
            if (keyName && (val?.type === 'FunctionExpression' || val?.type === 'ArrowFunctionExpression')) {
                found = { objName, methodName: keyName };
                return true;
            }
        }
        return false;
    };
    const visit = (node: AstNode): void => {
        if (found || !node || typeof node !== 'object' || typeof node.type !== 'string') return;
        if (node.type === 'VariableDeclaration') {
            for (const d of (node as VariableDeclarationNode).declarations || []) {
                if (d?.id?.type === 'Identifier' && check((d.id as IdentifierNode).name, d.init)) return;
            }
        }
        if (node.type === 'AssignmentExpression') {
            const asn = node as { operator?: string; left?: AstNode; right?: AstNode };
            if (asn.operator === '=' && asn.left?.type === 'Identifier'
                && check((asn.left as IdentifierNode).name, asn.right)) return;
        }
        for (const k of Object.keys(node)) {
            if (k === 'leadingJsDoc') continue;
            const v = asWalkable(node)[k];
            if (Array.isArray(v)) { for (const it of v) visit(it as AstNode); }
            else if (v && typeof v === 'object' && typeof (v as AstNode).type === 'string') visit(v as AstNode);
        }
    };
    if (ast) visit(ast);
    return found;
}

/** Find-references for a plain local object's method (`let o = { run: fn }; o.run()`):
 *  the definition key + every `o.run` call-site. Fires on a call-site member click OR
 *  the object-literal key click; null when the receiver isn't a local object literal
 *  with this function-valued member (so real module/factory/import cases fall through). */
function collectLocalObjectMethodReferences(uri: string, position: { line: number; character: number }): Location[] | null {
    const entry = analysisCache.get(uri);
    const document = documents.get(uri);
    if (!entry || !document) return null;
    const ast = entry.result.ast;
    if (!ast) return null;
    const offset = document.offsetAt(position);

    let objName: string | undefined;
    let methodName: string | undefined;
    const member = findMemberPropertyAt(ast, offset);
    if (member && member.object.type === 'Identifier') {
        objName = (member.object as IdentifierNode).name;
        methodName = member.property.name;
    } else {
        const hit = findObjectMethodKeyBinding(ast, offset);
        if (hit) { objName = hit.objName; methodName = hit.methodName; }
    }
    if (!objName || !methodName) return null;

    const objSym: Symbol | null | undefined = entry.result.symbolTable?.lookupAtPosition?.(objName, offset)
        ?? entry.result.symbolTable?.lookup?.(objName);
    const keySpan = objectLiteralMethodKey(objSym?.initNode, methodName);
    if (!keySpan) return null;

    const out: Location[] = [];
    const seen = new Set<string>();
    const add = (start: number, end: number) => {
        const range = { start: document.positionAt(start), end: document.positionAt(end) };
        const key = `${range.start.line}:${range.start.character}:${range.end.line}:${range.end.character}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push(Location.create(uri, range));
    };
    add(keySpan.start, keySpan.end); // definition (the `run:` key)
    for (const r of findNamespaceMemberReferences(ast, objName, methodName)) add(r.start, r.end);
    return out;
}

function collectReferences(uri: string, position: { line: number; character: number }, includeDeclaration: boolean): Location[] {
    const entry = analysisCache.get(uri);
    const document = documents.get(uri);
    if (!entry || !document) return [];

    // Plain local object method (`let o = { run: fn }; o.run()`): resolve it against the
    // object literal directly — the definition key plus every `o.run` call-site. Tried
    // FIRST because a local object may also carry propertyDefinitionLocations, which would
    // otherwise route the resolveMemberCanonical branch below to a name-only fan-out that
    // finds nothing. This branch only fires for a genuine object-literal receiver.
    const localObjRefs = collectLocalObjectMethodReferences(uri, position);
    if (localObjRefs) {
        if (!includeDeclaration && localObjRefs.length > 1) return localObjRefs.slice(1);
        return localObjRefs;
    }

    // Member-property click on an importer side (`lib.foo` / `sh.exec`): route to the
    // file that declares it, then fan out. The bare property name isn't an imported
    // symbol, so without this it would resolve to nothing.
    const memberCanon = resolveMemberCanonical(uri, position);
    if (memberCanon) {
        const out: Location[] = [];
        const seenM = new Set<string>();
        const addM = (u: string, range: Range) => {
            const key = `${u}:${range.start.line}:${range.start.character}:${range.end.line}:${range.end.character}`;
            if (seenM.has(key)) return;
            seenM.add(key);
            out.push(Location.create(u, range));
        };
        for (const r of collectInFileRefsByName(memberCanon.canonicalUri, memberCanon.canonicalName)) addM(r.uri, r.range as Range);
        for (const r of findCrossFileReferences(memberCanon.canonicalUri, memberCanon.canonicalName)) addM(r.uri, r.range as Range);
        return out;
    }

    const resolved = resolveSymbolAt(uri, position);
    if (!resolved) return [];
    const { name, declaredAt, isReference } = resolved;

    const spans = findFunctionReferences(entry.result.ast, name, null, isReference);
    const locs: Location[] = [];
    const seen = new Set<string>();
    const add = (u: string, range: Range) => {
        const key = `${u}:${range.start.line}:${range.start.character}:${range.end.line}:${range.end.character}`;
        if (seen.has(key)) return;
        seen.add(key);
        locs.push(Location.create(u, range));
    };

    for (const s of spans) {
        // findFunctionReferences may include a variable's own declaration id (it
        // only excludes function/param decl ids). Normalize via includeDeclaration.
        if (!includeDeclaration && declaredAt !== undefined && s.start === declaredAt) continue;
        add(uri, { start: document.positionAt(s.start), end: document.positionAt(s.end) });
    }
    if (includeDeclaration && declaredAt !== undefined) {
        add(uri, { start: document.positionAt(declaredAt), end: document.positionAt(declaredAt + name.length) });
    }
    // Cross-file. If the cursor is on an IMPORTED symbol, route to its source file
    // and fan out from there (the exporter's own refs + every importer). Otherwise
    // treat THIS file as the potential exporter (findCrossFileReferences returns []
    // when it doesn't export `name`).
    const sym: Symbol | null | undefined = entry.result.symbolTable?.lookupAtPosition?.(name, declaredAt ?? document.offsetAt(position))
        ?? entry.result.symbolTable?.lookup?.(name);
    const canon = sym?.type === SymbolType.IMPORTED ? resolveImportedCanonical(uri, name) : null;
    if (canon) {
        for (const r of collectInFileRefsByName(canon.canonicalUri, canon.canonicalName)) add(r.uri, r.range as Range);
        for (const r of findCrossFileReferences(canon.canonicalUri, canon.canonicalName)) add(r.uri, r.range as Range);
    } else {
        for (const r of findCrossFileReferences(uri, name)) add(r.uri, r.range as Range);
        // If `name` is a function-valued GLOBAL defined in THIS file (`global.X = fn` /
        // bare `X = fn`), its references also live in loadfile()() callers — follow those.
        if (collectCodeLensFunctions(entry.result.ast).some(f => f.isGlobal && f.name === name)) {
            for (const r of findLoadfileCallerReferences(uri, name)) add(r.uri, r.range as Range);
        }
    }
    return locs;
}

connection.onReferences((params: ReferenceParams): Location[] => {
    return collectReferences(params.textDocument.uri, params.position, params.context?.includeDeclaration ?? true);
});

connection.onDidChangeConfiguration(async () => {
    // Re-pull settings (e.g. ucode.inlayHints.enable) and ask the editor to
    // re-request hints so toggling the setting takes effect immediately.
    await refreshInlayHintSetting();
    requestInlayHintRefresh();
    // If the target ucode version changed, re-validate every open document so
    // version-gated diagnostics update immediately.
    const { targetChanged, strictChanged } = await refreshTargetVersion();
    if (targetChanged || strictChanged) {
        // Version gates fire in the always-run scope pass, so they re-evaluate with a
        // normal re-validate. strictUnknownArguments governs a TYPE-CHECKER diagnostic,
        // and the incremental cache skips unchanged function bodies' type-check results —
        // so a strict-setting change needs forceFull to re-run the type checker.
        for (const doc of documents.all()) validateAndAnalyzeDocument(doc, strictChanged);
    }
});

connection.languages.inlayHint.on((params: InlayHintParams): InlayHint[] => {
    if (!inlayHintsEnabled) return [];
    const cached = inlayCache.get(params.textDocument.uri);
    const document = documents.get(params.textDocument.uri);
    if (!cached || !document) return [];
    // The cached hint offsets are valid against the version they were computed from.
    // Analysis is debounced behind edits, so the buffer may have advanced since. When
    // it has, remap the offsets through the text delta (optimistic position-shift) so
    // the hints stay glued to the code instead of overlapping it or blanking; the
    // post-analysis inlayHint.refresh() then swaps in exact positions.
    const raw = cached.version === document.version
        ? cached.raw
        : shiftRawHints(cached.raw, cached.text, document.getText());
    const start = document.offsetAt(params.range.start);
    const end = document.offsetAt(params.range.end);
    return materializeRawHints(raw, start, end, (offset: number) => document.positionAt(offset));
});

connection.onFoldingRanges((params: FoldingRangeParams): FoldingRange[] => {
    const entry = analysisCache.get(params.textDocument.uri);
    const document = documents.get(params.textDocument.uri);
    if (!entry || !document) return [];
    return provideFoldingRanges(
        entry.result.ast, entry.comments ?? [], document.getText(),
        (offset: number) => document.positionAt(offset).line,
    );
});

connection.onDocumentLinks((params): DocumentLink[] => {
    const entry = analysisCache.get(params.textDocument.uri);
    const document = documents.get(params.textDocument.uri);
    if (!entry || !document) return [];
    return provideDocumentLinks(entry.result.ast, document, getCrossRefResolver(), params.textDocument.uri);
});

/** Find a function node (expression/decl) starting exactly at `start` in `ast`. */
function findFunctionNodeAt(ast: AstNode | null | undefined, start: number): FunctionLikeNode | null {
    let found: FunctionLikeNode | null = null;
    const visit = (node: AstNode): void => {
        if (found || !node || typeof node !== 'object' || typeof node.type !== 'string') return;
        if ((node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression' || node.type === 'FunctionDeclaration')
            && node.start === start) { found = node as FunctionLikeNode; return; }
        for (const k of Object.keys(node)) {
            if (k === 'leadingJsDoc') continue;
            const v = asWalkable(node)[k];
            if (Array.isArray(v)) { for (const it of v) visit(it as AstNode); }
            else if (v && typeof v === 'object' && typeof (v as AstNode).type === 'string') visit(v as AstNode);
        }
    };
    if (ast) visit(ast);
    return found;
}

/** Params of a factory-returned method, read from its source-file definition — so
 *  signature help works for `sh.exec(…)` where `sh = create_sys(…)`. */
function resolveMemberParamsAt(uri: string, fnStart: number): Array<{ name: string; label: string; isRest: boolean }> | null {
    const ad = astAndDocFor(uri);
    if (!ad) return null;
    const fn = findFunctionNodeAt(ad.ast, fnStart);
    if (!fn) return null;
    // ucode function params are plain Identifiers; rest params are NOT in `params` (they
    // live on the separate `restParam` field, handled just below).
    const out = (fn.params ?? []).map((param: AstNode) => {
        const name = (param as IdentifierNode).name ?? '';
        return { name, label: name, isRest: false };
    });
    // Rest params are parsed onto a separate `restParam` field, not into `params`.
    if (fn.restParam?.name) out.push({ name: fn.restParam.name, label: '...' + fn.restParam.name, isRest: true });
    return out;
}

connection.onSignatureHelp(async (params: SignatureHelpParams): Promise<SignatureHelp | null> => {
    await ensureFullAnalysis(params.textDocument.uri); // full types inside unchanged bodies
    const entry = analysisCache.get(params.textDocument.uri);
    const document = documents.get(params.textDocument.uri);
    if (!entry || !document) return null;
    const offset = document.offsetAt(params.position);
    return provideSignatureHelp(entry.result.ast, entry.result.symbolTable, allBuiltinFunctions, offset, resolveMemberParamsAt);
});

/**
 * Start offsets of every identifier that is a WRITE target — a declaration id, a
 * function/rest/catch parameter binding, an assignment LHS, a `++`/`--` operand, or
 * a `for (x in …)` loop binding. Used to tag document highlights Write vs Read
 * (ticket 87). AST-derived so it's independent of the surface text.
 */
function collectWriteTargetOffsets(ast: AstNode | null | undefined): Set<number> {
    const writes = new Set<number>();
    const markIfIdent = (n: unknown): void => {
        const node = n as WalkableNode | null | undefined;
        if (node && typeof node === 'object' && node.type === 'Identifier' && typeof node.start === 'number') {
            writes.add(node.start);
        }
    };
    const walk = (nodeArg: unknown): void => {
        const node = nodeArg as WalkableNode | null | undefined;
        if (!node || typeof node !== 'object' || typeof node.type !== 'string') return;
        switch (node.type) {
            case 'VariableDeclarator': markIfIdent(node.id); break;
            case 'AssignmentExpression': markIfIdent(node.left); break;
            case 'UnaryExpression':
                if (node.operator === '++' || node.operator === '--') markIfIdent(node.argument);
                break;
            case 'ForInStatement': markIfIdent(node.left); break;
            case 'FunctionDeclaration':
            case 'FunctionExpression':
            case 'ArrowFunctionExpression':
                if (Array.isArray(node.params)) node.params.forEach(markIfIdent);
                markIfIdent(node.restParam);
                break;
            case 'CatchClause':
                // catch (e) — the bound exception identifier.
                markIfIdent(node.param);
                break;
        }
        for (const key of Object.keys(node)) {
            if (key === 'leadingJsDoc') continue;
            const v = node[key];
            if (Array.isArray(v)) v.forEach(walk);
            else if (v && typeof v === 'object') walk(v);
        }
    };
    if (ast) walk(ast);
    return writes;
}

connection.onDocumentHighlight((params: DocumentHighlightParams): DocumentHighlight[] => {
    // Same-file occurrences of the symbol under the cursor (scope-aware), for the
    // editor's "highlight all occurrences". Reuses the in-file reference set.
    const locs = collectReferences(params.textDocument.uri, params.position, true)
        .filter(loc => loc.uri === params.textDocument.uri);
    // Tag each occurrence Write (declaration / assignment target) or Read (ticket 87).
    const entry = analysisCache.get(params.textDocument.uri);
    const document = documents.get(params.textDocument.uri);
    const writeOffsets = entry && document ? collectWriteTargetOffsets(entry.result.ast) : new Set<number>();
    return locs.map(loc => {
        const kind = document && writeOffsets.has(document.offsetAt(loc.range.start))
            ? DocumentHighlightKind.Write
            : DocumentHighlightKind.Read;
        return DocumentHighlight.create(loc.range, kind);
    });
});

connection.onDocumentSymbol((params: DocumentSymbolParams): DocumentSymbol[] => {
    const entry = analysisCache.get(params.textDocument.uri);
    const document = documents.get(params.textDocument.uri);
    if (!entry || !document) return [];
    return buildDocumentSymbols(entry.result.ast, (offset: number) => document.positionAt(offset));
});

connection.onWorkspaceSymbol((params: WorkspaceSymbolParams): SymbolInformation[] => {
    // Index every workspace .uc file's symbols, filtered by the query (case-
    // insensitive substring). Open documents use their live AST (unsaved edits);
    // the rest come from the mtime-cached on-disk parse. Reuses buildDocumentSymbols.
    const query = params.query.toLowerCase();
    const results: SymbolInformation[] = [];
    const seenPaths = new Set<string>();

    const flatten = (syms: DocumentSymbol[], uri: string, container: string | undefined): void => {
        for (const s of syms) {
            if (results.length >= 1000) return;
            if (query === '' || s.name.toLowerCase().includes(query)) {
                const info: SymbolInformation = { name: s.name, kind: s.kind, location: Location.create(uri, s.selectionRange) };
                if (container !== undefined) info.containerName = container;
                results.push(info);
            }
            if (s.children && s.children.length) flatten(s.children, uri, s.name);
        }
    };

    // Open documents first (live content).
    for (const [uri, entry] of analysisCache.entries()) {
        const document = documents.get(uri);
        if (!document) continue;
        try { seenPaths.add(path.resolve(uriToFilePath(uri))); } catch { /* ignore */ }
        flatten(buildDocumentSymbols(entry.result.ast, (o: number) => document.positionAt(o)), uri, undefined);
    }
    // Then on-disk workspace files not currently open.
    for (const filePath of listWorkspaceUcodeFiles()) {
        if (results.length >= 1000) break;
        if (seenPaths.has(path.resolve(filePath))) continue;
        const wf = getWorkspaceFile(filePath);
        if (!wf) continue;
        const uri = filePathToUri(filePath);
        flatten(buildDocumentSymbols(wf.ast, (o: number) => wf.doc.positionAt(o)), uri, undefined);
    }
    return results;
});

// ── Rename ──────────────────────────────────────────────────────────────────
// Safe scope: rename only PURELY-LOCAL bindings (locals, params, non-exported
// functions) so we never emit a broken edit. A name that is imported, exported,
// or used cross-file crosses the module boundary — renaming it in one file alone
// would desync the others — so we refuse it (the editor shows "can't rename").

/** Is `name` exported from this file (inline `export function/let`, an
 *  `export { name }` specifier, or `export default name`)? */
function isExportedName(ast: AstNode | null | undefined, name: string): boolean {
    const body = ast ? asWalkable(ast).body : undefined;
    if (!Array.isArray(body)) return false;
    for (const stmt of body as WalkableNode[]) {
        const t = stmt?.type;
        if (t === 'ExportNamedDeclaration') {
            const decl = stmt.declaration as WalkableNode | undefined;
            const declId = decl?.id as WalkableNode | undefined;
            if (decl?.type === 'FunctionDeclaration' && declId?.name === name) return true;
            if (decl?.type === 'VariableDeclaration'
                && ((decl.declarations as WalkableNode[] | undefined) || []).some((d) => (d?.id as WalkableNode | undefined)?.name === name)) return true;
            for (const spec of ((stmt.specifiers as WalkableNode[] | undefined) || [])) {
                if ((spec?.local as WalkableNode | undefined)?.name === name || (spec?.exported as WalkableNode | undefined)?.name === name) return true;
            }
        } else if (t && t.startsWith('ExportDefault')) {
            const d = stmt.declaration as WalkableNode | undefined;
            if (d?.type === 'Identifier' && d.name === name) return true;
            if ((d?.id as WalkableNode | undefined)?.name === name) return true;
        }
    }
    return false;
}

/** AST + position-mapper for any URI — the open scope-aware analysis if available,
 *  else the parse-only workspace cache. */
function astAndDocFor(uri: string): { ast: AstNode | null | undefined; doc: TextDocument } | null {
    const open = analysisCache.get(uri);
    const openDoc = documents.get(uri);
    if (open && openDoc) return { ast: open.result.ast, doc: openDoc };
    const wf = getWorkspaceFile(uriToFilePath(uri));
    return wf ? { ast: wf.ast, doc: wf.doc } : null;
}

/** Does any file import `canonicalName` from `canonicalUri` under an ALIAS
 *  (`import { foo as f }`)? Aliased imports decouple the local name from the export,
 *  so a single-name cross-file rename can't handle them — we refuse instead. */
function hasAliasedImporter(canonicalUri: string, canonicalName: string): boolean {
    const resolver = getCrossRefResolver();
    const targetPath = path.resolve(uriToFilePath(canonicalUri));
    for (const fp of listWorkspaceUcodeFiles()) {
        if (path.resolve(fp) === targetPath) continue;
        const uri = filePathToUri(fp);
        const ad = astAndDocFor(uri);
        if (!ad) continue;
        for (const stmt of (astBody(ad.ast))) {
            if (stmt?.type !== 'ImportDeclaration') continue;
            const sourceValue = (stmt.source as WalkableNode | undefined)?.value as string | undefined;
            if (sourceValue === undefined) continue;
            const resolved = resolver.resolveImportPath(sourceValue, uri);
            if (!resolved || path.resolve(uriToFilePath(resolved)) !== targetPath) continue;
            for (const spec of ((stmt.specifiers as WalkableNode[] | undefined) ?? [])) {
                const imported = spec.imported as WalkableNode | undefined;
                const local = spec.local as WalkableNode | undefined;
                if (spec.type === 'ImportSpecifier' && imported?.name === canonicalName
                    && local?.name !== canonicalName) return true;
            }
        }
    }
    return false;
}

/** Import/export SPECIFIER occurrences of `canonicalName` (e.g. `import { foo }`,
 *  `export { foo }`) across the source file and every importer. findFunctionReferences
 *  intentionally omits these, but a rename MUST update them or the import breaks. */
function collectSpecifierSpansForRename(canonicalUri: string, canonicalName: string): Array<{ uri: string; range: Range }> {
    const out: Array<{ uri: string; range: Range }> = [];
    const resolver = getCrossRefResolver();
    const targetPath = path.resolve(uriToFilePath(canonicalUri));
    const rangeOf = (n: { start: number; end: number }, doc: TextDocument): Range => ({ start: doc.positionAt(n.start), end: doc.positionAt(n.end) });

    // Source: `export { foo }` / `export { foo as x }` specifiers (rename the local `foo`).
    const src = astAndDocFor(canonicalUri);
    if (src) {
        for (const stmt of (astBody(src.ast))) {
            if (stmt?.type === 'ExportNamedDeclaration' && !stmt.declaration) {
                for (const spec of ((stmt.specifiers as WalkableNode[] | undefined) ?? [])) {
                    const local = spec.local as WalkableNode | undefined;
                    if (local?.name === canonicalName) out.push({ uri: canonicalUri, range: rangeOf(local, src.doc) });
                }
            }
        }
    }
    // Importers: `import { foo }` specifiers (non-aliased — local shares the range).
    for (const fp of listWorkspaceUcodeFiles()) {
        if (path.resolve(fp) === targetPath) continue;
        const uri = filePathToUri(fp);
        const ad = astAndDocFor(uri);
        if (!ad) continue;
        for (const stmt of (astBody(ad.ast))) {
            if (stmt?.type !== 'ImportDeclaration') continue;
            const source = stmt.source as WalkableNode | undefined;
            const sourceValue = source?.value as string | undefined;
            if (sourceValue === undefined) continue;
            const resolved = resolver.resolveImportPath(sourceValue, uri);
            if (!resolved || path.resolve(uriToFilePath(resolved)) !== targetPath) continue;
            for (const spec of ((stmt.specifiers as WalkableNode[] | undefined) ?? [])) {
                const imported = spec.imported as WalkableNode | undefined;
                if (spec.type === 'ImportSpecifier' && imported?.name === canonicalName) {
                    out.push({ uri, range: rangeOf(imported, ad.doc) });
                }
            }
        }
    }
    return out;
}

/** Does a NESTED scope in `ast` declare `name` (a param, or a local var/function
 *  inside a function body)? Such a shadow is a DIFFERENT binding, but the parse-only
 *  cross-file walk matches by name and would wrongly rewrite it — so we refuse the
 *  rename when one exists. (Top-level redeclarations are already errors.) */
function hasNestedShadow(ast: AstNode | null | undefined, name: string): boolean {
    let found = false;
    const visit = (node: AstNode, depth: number): void => {
        if (found || !node || typeof node !== 'object' || typeof node.type !== 'string') return;
        const n = asWalkable(node);
        const isFn = node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression';
        if (depth > 0) {
            const id = n.id as WalkableNode | undefined;
            if (node.type === 'FunctionDeclaration' && id?.name === name) { found = true; return; }
            if (node.type === 'VariableDeclarator' && id?.type === 'Identifier' && id.name === name) { found = true; return; }
        }
        if (isFn) {
            for (const p of ((n.params as WalkableNode[] | undefined) ?? [])) {
                if ((p?.name ?? (p?.argument as WalkableNode | undefined)?.name) === name) { found = true; return; }
            }
            if ((n.restParam as WalkableNode | undefined)?.name === name) { found = true; return; }
        }
        const childDepth = isFn ? depth + 1 : depth;
        for (const k of Object.keys(node)) {
            if (k === 'leadingJsDoc') continue;
            const v = n[k];
            if (Array.isArray(v)) { for (const it of v) visit(it as AstNode, childDepth); }
            else if (v && typeof v === 'object' && typeof (v as AstNode).type === 'string') visit(v as AstNode, childDepth);
        }
    };
    if (ast) visit(ast, 0);
    return found;
}

/** True if `canonicalName` is shadowed by a nested local in the source file or in
 *  any importer of it — in which case a name-based cross-file rename is unsafe. */
function renameHasShadowingConflict(canonicalUri: string, canonicalName: string): boolean {
    const src = astAndDocFor(canonicalUri);
    if (src && hasNestedShadow(src.ast, canonicalName)) return true;
    const resolver = getCrossRefResolver();
    const targetPath = path.resolve(uriToFilePath(canonicalUri));
    for (const fp of listWorkspaceUcodeFiles()) {
        if (path.resolve(fp) === targetPath) continue;
        const uri = filePathToUri(fp);
        const ad = astAndDocFor(uri);
        if (!ad) continue;
        let importsTarget = false;
        for (const stmt of (astBody(ad.ast))) {
            if (stmt?.type !== 'ImportDeclaration') continue;
            const sourceValue = (stmt.source as WalkableNode | undefined)?.value as string | undefined;
            if (sourceValue === undefined) continue;
            const r = resolver.resolveImportPath(sourceValue, uri);
            if (r && path.resolve(uriToFilePath(r)) === targetPath) { importsTarget = true; break; }
        }
        if (importsTarget && hasNestedShadow(ad.ast, canonicalName)) return true;
    }
    return false;
}

type RenameTarget =
    | { kind: 'local' }
    | { kind: 'crossfile'; canonicalUri: string; canonicalName: string }
    | { kind: 'blocked'; reason: string };

/** Classify a rename request: a purely-local binding (in-file rename), a safe
 *  cross-file named export (multi-file rename), or blocked (with a reason). */
function analyzeRenameTarget(uri: string, position: { line: number; character: number }): RenameTarget {
    const entry = analysisCache.get(uri);
    if (!entry) return { kind: 'blocked', reason: 'no analysis for this document' };
    const resolved = resolveSymbolAt(uri, position);
    if (!resolved) return { kind: 'blocked', reason: 'not an identifier' };
    if (resolved.declaredAt === undefined) {
        return { kind: 'blocked', reason: `'${resolved.name}' has no local declaration to rename (builtin or unresolved)` };
    }
    const name = resolved.name;
    const sym: Symbol | null | undefined = entry.result.symbolTable?.lookupAtPosition?.(name, resolved.declaredAt)
        ?? entry.result.symbolTable?.lookup?.(name);
    // Builtins are seeded into global scope with a synthetic declaration — never renameable.
    if (sym?.type === SymbolType.BUILTIN) return { kind: 'blocked', reason: `'${name}' is a builtin function` };

    // Canonical (declaring file, export name) for a cross-file symbol.
    let canonical: { canonicalUri: string; canonicalName: string } | null = null;
    if (sym?.type === SymbolType.IMPORTED) {
        canonical = resolveImportedCanonical(uri, name);
        if (!canonical) return { kind: 'blocked', reason: `'${name}' is imported but its source module couldn't be resolved` };
    } else if (isExportedName(entry.result.ast, name)) {
        canonical = { canonicalUri: uri, canonicalName: name };
    }
    if (!canonical) return { kind: 'local' };

    // Cross-file safety: only NAMED exports with no aliased importers.
    const resolver = getCrossRefResolver();
    const exps = resolver.getModuleExports(canonical.canonicalUri);
    const isNamed = !!exps?.some(e => e.type === 'named' && e.name === canonical!.canonicalName);
    const isDefault = !!exps?.some(e => e.type === 'default' && e.exportedName === canonical!.canonicalName);
    if (!isNamed) {
        return isDefault
            ? { kind: 'blocked', reason: `'${name}' is a default export — importers bind it positionally; rename each import's local name individually` }
            : { kind: 'blocked', reason: `'${name}' isn't a resolvable named export` };
    }
    if (hasAliasedImporter(canonical.canonicalUri, canonical.canonicalName)) {
        return { kind: 'blocked', reason: `'${name}' is imported under an alias elsewhere — cross-file rename of aliased imports isn't supported` };
    }
    // The export must correspond to a top-level declaration with the SAME name —
    // otherwise it's an export alias (`export { foo as bar }`) or re-export, where a
    // single-name rename would leave the source out of sync with importers.
    const srcAst = astAndDocFor(canonical.canonicalUri)?.ast;
    if (!srcAst || !findTopLevelDeclId(srcAst, canonical.canonicalName)) {
        return { kind: 'blocked', reason: `'${name}' is exported under a different name (export alias/re-export) — rename its local declaration instead` };
    }
    // A nested local of the same name in the source or any importer would be wrongly
    // rewritten by the name-based cross-file walk — refuse rather than corrupt it.
    if (renameHasShadowingConflict(canonical.canonicalUri, canonical.canonicalName)) {
        return { kind: 'blocked', reason: `'${name}' is shadowed by a same-named local in another scope — cross-file rename could corrupt it` };
    }
    return { kind: 'crossfile', canonicalUri: canonical.canonicalUri, canonicalName: canonical.canonicalName };
}

/** Why a symbol can't be renamed, or null if it can (local OR safe cross-file). */
function renameBlockedReason(uri: string, position: { line: number; character: number }): string | null {
    const target = analyzeRenameTarget(uri, position);
    return target.kind === 'blocked' ? target.reason : null;
}

connection.onPrepareRename((params: PrepareRenameParams): { range: Range; placeholder: string } | null => {
    const entry = analysisCache.get(params.textDocument.uri);
    const document = documents.get(params.textDocument.uri);
    if (!entry || !document) return null;
    if (renameBlockedReason(params.textDocument.uri, params.position)) return null;
    const offset = document.offsetAt(params.position);
    const ident = identifierNameAt(entry.tokens, offset);
    if (!ident) return null;
    return {
        range: { start: document.positionAt(ident.start), end: document.positionAt(ident.end) },
        placeholder: ident.name,
    };
});

connection.onRenameRequest((params: RenameParams): WorkspaceEdit | null => {
    const newName = params.newName;
    // Reject invalid identifiers (the editor usually pre-validates, but be safe).
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(newName)) return null;
    const target = analyzeRenameTarget(params.textDocument.uri, params.position);
    if (target.kind === 'blocked') return null;

    // The reference set (declaration + usages across files, includeDeclaration=true).
    const spans: Array<{ uri: string; range: Range }> =
        collectReferences(params.textDocument.uri, params.position, true).map(l => ({ uri: l.uri, range: l.range }));
    // Cross-file renames also need the import/export specifiers, which references omit.
    if (target.kind === 'crossfile') {
        spans.push(...collectSpecifierSpansForRename(target.canonicalUri, target.canonicalName));
    }
    if (spans.length === 0) return null;

    // Dedup and group edits per file.
    const changes: { [uri: string]: TextEdit[] } = {};
    const seen = new Set<string>();
    for (const { uri, range } of spans) {
        const key = `${uri}:${range.start.line}:${range.start.character}:${range.end.line}:${range.end.character}`;
        if (seen.has(key)) continue;
        seen.add(key);
        (changes[uri] ??= []).push(TextEdit.replace(range, newName));
    }
    return { changes };
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
    enclosingControl: AstNode | null;
    /** The body node of the enclosing control statement */
    enclosingControlBody: AstNode | null;
    /** Line of the nearest enclosing statement. If this differs from the diagnostic line,
     *  the diagnostic is inside a multi-line expression (object literal, array, nested call, etc.)
     *  and guards must be inserted before this line instead. */
    enclosingStatementLine: number;
    /** Line of the nearest enclosing function declaration/expression */
    enclosingFunctionLine: number;
    /** The nearest enclosing function node (declaration/expression/arrow) */
    enclosingFunction: FunctionLikeNode | null;
    /** The nearest enclosing statement node (used to source verbatim text / detect declarations) */
    enclosingStatement: AstNode | null;
}

/**
 * Walk the AST top-down to determine if a position is inside a function body,
 * a loop body, or top-level code. When entering a nested function, loop context
 * is reset (continue inside a callback doesn't apply to the outer loop).
 */
function findEnclosingContext(ast: AstNode | null | undefined, document: TextDocument, position: { line: number; character: number }): EnclosingContext {
    const result: EnclosingContext = {
        inFunction: false, inLoop: false, inLoopHeader: false,
        inCondition: false, conditionOwnerLine: -1,
        enclosingControl: null, enclosingControlBody: null,
        enclosingStatementLine: -1,
        enclosingFunctionLine: -1,
        enclosingFunction: null,
        enclosingStatement: null
    };
    if (!ast) return result;

    const offset = document.offsetAt(position);

    function walk(nodeArg: AstNode, inFunc: boolean, inLoop: boolean, inLoopHeader: boolean, inCondition: boolean, condOwner: AstNode | null): void {
        const node = asWalkable(nodeArg);
        if (!node || typeof node !== 'object' || typeof node.start !== 'number') return;
        if (offset < node.start || offset > node.end) return;

        const isFunc = node.type === 'FunctionDeclaration' ||
                       node.type === 'FunctionExpression' ||
                       node.type === 'ArrowFunctionExpression';
        const isLoop = node.type === 'ForStatement' ||
                       node.type === 'ForInStatement' ||
                       node.type === 'WhileStatement';
        const isControl = isLoop || node.type === 'IfStatement';

        const newInFunc = isFunc || inFunc;
        // Reset loop flag when entering nested function
        const newInLoop = isFunc ? false : (isLoop || inLoop);

        result.inFunction = newInFunc;
        if (isFunc) {
            result.enclosingFunctionLine = document.positionAt(node.start).line;
            result.enclosingFunction = node as unknown as FunctionLikeNode;
        }
        result.inLoop = newInLoop;
        result.inLoopHeader = inLoopHeader;
        result.inCondition = inCondition;
        if (condOwner) {
            result.conditionOwnerLine = document.positionAt(condOwner.start).line;
        }

        // Track enclosing control structure for body-position diagnostics
        if (isControl) {
            const bodyNode = (node.type === 'IfStatement' ? node.consequent : node.body) as AstNode | undefined;
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
            node.type === 'SwitchStatement' ||
            node.type === 'TryStatement' ||
            node.type === 'ThrowStatement' ||
            node.type === 'BreakStatement' ||
            node.type === 'ContinueStatement';
        if (isStatement) {
            const stmtLine = document.positionAt(node.start).line;
            // An `else if` / `else` / `catch` / `finally` continuation begins on a
            // line whose first token is `}` — a guard statement can't be inserted
            // before it (it would land inside the PREVIOUS branch and dangle the
            // chain). The outer statement (the chain-start `if`) was already set as
            // we descended top-down; keep it so the guard hoists above the whole
            // chain (valid, and narrows the variable for every branch).
            const lineText = document.getText({
                start: { line: stmtLine, character: 0 },
                end: { line: stmtLine + 1, character: 0 },
            });
            if (!/^\s*\}/.test(lineText)) {
                result.enclosingStatementLine = stmtLine;
                result.enclosingStatement = node;
            }
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
            const childCondOwner: AstNode | null = isCondKey ? (node as AstNode) : (isControl && !isCondKey ? null : condOwner);
            if (Array.isArray(val)) {
                for (const item of val as unknown[]) {
                    if (item && typeof item === 'object' && typeof (item as AstNode).start === 'number') {
                        walk(item as AstNode, newInFunc, childInLoop, childInLoopHeader, childInCondition, childCondOwner);
                    }
                }
            } else if (val && typeof val === 'object' && typeof (val as AstNode).start === 'number') {
                walk(val as AstNode, newInFunc, childInLoop, childInLoopHeader, childInCondition, childCondOwner);
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
function guardAlreadyExists(document: TextDocument, beforeLine: number, guardCondition: string, afterLine: number = -1): boolean {
    const searchStart = afterLine >= 0 ? afterLine : Math.max(0, beforeLine - 50);
    for (let i = searchStart; i < beforeLine; i++) {
        const lineText = document.getText({
            start: { line: i, character: 0 },
            end: { line: i + 1, character: 0 }
        });
        if (lineText.includes(guardCondition)) {
            // Don't match if the guard is part of a compound condition (&&/||).
            // e.g., `if (type(x) != "string" && type(x) != "array")` narrows to
            // string|array, NOT just string — so the individual guard doesn't apply.
            const condMatch = lineText.match(/if\s*\((.+)\)/);
            if (condMatch && condMatch[1]!.includes('&&') || condMatch && condMatch[1]!.includes('||')) {
                continue;
            }
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
function isNullProblem(data: DiagnosticData): boolean {
    if (!data.actualType) return true;
    const actualStr = typeof data.actualType === 'string' ? data.actualType : '';
    const types = actualStr.split(' | ').map((t: string) => t.trim());
    return types.includes('null');
}

/** Create a code action that inserts text before a given line */
function makeInsertBeforeAction(
    title: string, insertText: string, line: number,
    uri: string, diagnostic: Diagnostic, document?: TextDocument
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

/**
 * Determine whether the enclosing function is "inline" — i.e. a guard inserted
 * before the diagnostic LINE would land OUTSIDE the function body. This is the
 * case for an expression-body arrow (`x => expr`, no block at all) and for any
 * function whose block `{` opens on or after the diagnostic line (single-line
 * arrow / function expression / object method / callback). In those cases the
 * guard must be placed INSIDE the function body instead.
 */
function isInlineFunctionBody(fn: FunctionLikeNode | null, document: TextDocument, diagLine: number): boolean {
    if (!fn || !fn.body || typeof fn.body.start !== 'number') return false;
    if (fn.body.type !== 'BlockStatement') return true; // expression-body arrow
    return document.positionAt(fn.body.start).line >= diagLine;
}

/**
 * Create a code action that inserts a guard statement INSIDE the enclosing
 * function's body. For a block body the guard is inserted right after `{`; for
 * an expression-body arrow the body is rewritten to a block that early-returns
 * on the guard and then returns the original expression.
 */
function makeInlineFunctionGuardAction(
    title: string, fn: FunctionLikeNode, guardStmt: string,
    uri: string, diagnostic: Diagnostic, document: TextDocument
): CodeAction {
    if (fn.body.type === 'BlockStatement') {
        const afterBrace = document.positionAt(fn.body.start + 1);
        return {
            title,
            kind: CodeActionKind.QuickFix,
            diagnostics: [diagnostic],
            edit: { changes: { [uri]: [TextEdit.insert(afterBrace, ` ${guardStmt}`)] } }
        };
    }
    // Expression-body arrow: `=> EXPR` becomes `=> { GUARD return EXPR; }`
    const start = document.positionAt(fn.body.start);
    const end = document.positionAt(fn.body.end);
    const exprText = document.getText({ start, end });
    return {
        title,
        kind: CodeActionKind.QuickFix,
        diagnostics: [diagnostic],
        edit: { changes: { [uri]: [TextEdit.replace({ start, end }, `{ ${guardStmt} return ${exprText}; }`)] } }
    };
}

// Builtin arg-type constraints, mirroring the validateArgumentType() calls in
// src/analysis/checkers/builtinValidation.ts. Keyed on funcName → per-arg
// allowed-type sets. An entry of null means "any type accepted here".
// Keep this in sync when new builtins gain argument-type validation.
const BUILTIN_ARG_CONSTRAINTS: Record<string, (string[] | null)[]> = {
    // String operations
    substr:   [['string'], ['integer'], ['integer']],
    lc:       [['string']],
    uc:       [['string']],
    trim:     [['string'], ['string']],
    ltrim:    [['string'], ['string']],
    rtrim:    [['string'], ['string']],
    ord:      [['string']],
    chr:      [['integer']],
    uchr:     [['integer']],
    // Search / match
    match:    [['string'], ['regex', 'string']],
    replace:  [['string'], ['regex', 'string'], ['string', 'function']],
    split:    [['string'], ['regex', 'string'], ['integer']],
    join:     [['string'], ['array']],
    index:    [['string', 'array'], null],
    rindex:   [['string', 'array'], null],
    length:   [['string', 'array', 'object']],
    // Collections
    keys:     [['object']],
    values:   [['object']],
    push:     [['array']],
    pop:      [['array']],
    shift:    [['array']],
    unshift:  [['array']],
    uniq:     [['array']],
    slice:    [['array'], ['integer'], ['integer']],
    splice:   [['array'], ['integer']],
    sort:     [['array'], ['function']],
    reverse:  [['array', 'string']],
    filter:   [['array'], ['function']],
    map:      [['array'], ['function']],
    // Encodings
    b64enc:   [['string']],
    b64dec:   [['string']],
    hexenc:   [['string']],
    hexdec:   [['string']],
    hex:      [['string']],
    // Misc
    exists:   [['object'], ['string']],
    regexp:   [['string'], ['string']],
    iptoarr:  [['string']],
    arrtoip:  [['array']],
    timelocal:[['object']],
    timegm:   [['object']],
    loadstring:[['string']],
    loadfile: [['string']],
    wildcard: [['string'], ['string']],
    proto:    [['object']],
    sprintf:  [['string']],
    printf:   [['string']],
    render:   [['string']],
    getenv:   [['string']],
    sleep:    [['integer']],
    localtime:[['integer']],
    gmtime:   [['integer']],
};

// Builtin-MODULE functions (fs, uci, ubus, math, nl80211, rtnl, …) are frequently
// aliased to locals (`let popen = fs_mod.popen; … popen(cmd, 'r')`), so a param
// flowing into one should infer the same way a global builtin does. Derived
// generically from MODULE_REGISTRIES (the single source of truth for every
// builtin module) so nothing is hardcoded and it can't drift: each parameter
// typed as a concrete primitive becomes a constraint; non-primitive params
// (object handles like fs.proc, `number`, unions) contribute none.
//
// Because the inference matches a call by its bare callee name, a name defined by
// MULTIPLE modules with DIFFERENT signatures is ambiguous — we drop it rather than
// guess. Global builtins (BUILTIN_ARG_CONSTRAINTS) always take precedence at lookup.
const MODULE_ARG_CONSTRAINTS: Record<string, (string[] | null)[]> = (() => {
    const PRIM: Record<string, string> = {
        string: 'string', integer: 'integer', int: 'integer', double: 'double',
        float: 'double', boolean: 'boolean', bool: 'boolean', array: 'array', object: 'object',
    };
    const toConstraints = (params: ReadonlyArray<{ type: string }>): (string[] | null)[] =>
        params.map(p => (PRIM[p.type] ? [PRIM[p.type]!] : null));
    const sameShape = (a: (string[] | null)[], b: (string[] | null)[]) =>
        JSON.stringify(a) === JSON.stringify(b);

    const out: Record<string, (string[] | null)[]> = {};
    const ambiguous = new Set<string>();
    for (const reg of Object.values(MODULE_REGISTRIES)) {
        for (const name of reg.getFunctionNames()) {
            if (ambiguous.has(name)) continue;
            const sig = reg.getFunction(name);
            if (!Option.isSome(sig)) continue;
            const c = toConstraints(sig.value.parameters || []);
            if (!c.some(x => x)) continue; // no concrete constraint anywhere
            if (name in out) {
                if (!sameShape(out[name]!, c)) { delete out[name]; ambiguous.add(name); }
            } else {
                out[name] = c;
            }
        }
    }
    return out;
})();

type ParamInference = Map<string, string>;
type AllInferences = Map<FunctionLikeNode, ParamInference>;

/** JSDoc `@param` names already documented in a JSDoc block's raw text. */
function documentedParamNames(jsDocValue: string): Set<string> {
    const names = new Set<string>();
    // @param {type} name  |  @param name  |  @param {type} [name]  |  @param [name=default]
    const re = /@param\s+(?:\{[^}]*\}\s*)?\[?\s*([A-Za-z_$][\w$]*)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(jsDocValue)) !== null) names.add(m[1]!);
    return names;
}

/** Params of a function-like node that its leading JSDoc (if any) does not document. */
function undocumentedParams(fn: FunctionLikeNode): IdentifierNode[] {
    const params = (fn.params as IdentifierNode[] | undefined) ?? [];
    const jsDoc = (fn as { leadingJsDoc?: { value: string } }).leadingJsDoc;
    if (!jsDoc) return params;
    const documented = documentedParamNames(jsDoc.value);
    return params.filter(p => !documented.has(p.name));
}

/** DFS-collect every function declaration/expression that has at least one UNDOCUMENTED
 *  parameter — including partially-documented functions (ticket 95), so cross-function
 *  param-usage inference still sees them. */
function collectUnannotatedFunctions(ast: AstNode | null | undefined): FunctionLikeNode[] {
    const out: FunctionLikeNode[] = [];
    const walk = (node: AstNode): void => {
        if (!node || typeof node !== 'object' || typeof node.type !== 'string') return;
        const n = asWalkable(node);
        if ((node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression')
            && n.params && (n.params as unknown[]).length > 0
            && undocumentedParams(node as FunctionLikeNode).length > 0) {
            out.push(node as FunctionLikeNode);
        }
        for (const k of Object.keys(node)) {
            if (k === 'leadingJsDoc') continue;
            const v = n[k];
            if (Array.isArray(v)) { for (const it of v) walk(it as AstNode); }
            else if (v && typeof v === 'object' && typeof (v as AstNode).type === 'string') walk(v as AstNode);
        }
    };
    if (ast) walk(ast);
    return out;
}

/** Parse a type string like "array | string" into its atomic members. */
function splitTypeUnion(t: string): string[] {
    return t.split(' | ').map(s => s.trim()).filter(s => s.length > 0);
}

/**
 * Walk a function body to collect type constraints on each parameter. Sources:
 *
 *   1. Diagnostics that fired on param usages (`incompatible-function-argument`,
 *      `nullable-argument`). These carry the validator's precise `expectedTypes`.
 *   2. Direct builtin arg positions — `push(arr, ...)` doesn't fire a diagnostic
 *      when `arr` is UNKNOWN-param-typed if strict-mode is off OR the validator
 *      doesn't emit for UNKNOWN; walking the AST and consulting
 *      BUILTIN_ARG_CONSTRAINTS catches the constraint anyway.
 *   3. (Cross-function propagation) Calls to user functions whose own params
 *      we've already inferred in a previous pass — if `inner(s: string)` was
 *      inferred, then `outer(x) { inner(x); }` inherits `x: string`. Requires
 *      callerInferences + funcsByName from the fixpoint driver.
 *
 * Per param, we intersect all collected constraint sets. Empty intersection or
 * no constraints → "unknown".
 */
/** The ucode type name of a literal AST node used as a value (e.g. a switch case
 *  label), or null if it isn't a plain literal we can classify. Accepts a unary
 *  +/- on a numeric literal (`case -1:`). `null` literals return null — they
 *  don't constrain a type. */
function literalTypeName(node: AstNode | null | undefined): string | null {
    let n = node as WalkableNode | null | undefined;
    if (n?.type === 'UnaryExpression' && (n.operator === '-' || n.operator === '+') && (n.argument as WalkableNode | undefined)?.type === 'Literal') {
        n = n.argument as WalkableNode;
    }
    if (n?.type !== 'Literal') return null;
    const v = n.value;
    if (typeof v === 'string') return 'string';
    if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'double';
    if (typeof v === 'boolean') return 'boolean';
    return null;
}

function inferParamTypesFromUsage(
    funcNode: FunctionLikeNode,
    allDiagnostics: Diagnostic[],
    callerInferences?: AllInferences,
    funcsByName?: Map<string, FunctionLikeNode>,
    symbolTable?: SymbolTable,
): ParamInference {
    const paramNames = new Set<string>(funcNode.params.map((p: IdentifierNode) => p.name));
    const bodyStart = funcNode.body?.start ?? funcNode.start;
    const bodyEnd = funcNode.body?.end ?? funcNode.end;

    const constraintsPerParam = new Map<string, Set<string>[]>();
    const addConstraint = (paramName: string, allowed: string[]) => {
        if (allowed.length === 0) return;
        let list = constraintsPerParam.get(paramName);
        if (!list) { list = []; constraintsPerParam.set(paramName, list); }
        list.push(new Set(allowed));
    };

    // Source 1: diagnostics within this function's body.
    for (const d of allDiagnostics) {
        if (d.code !== 'incompatible-function-argument' && d.code !== 'nullable-argument') continue;
        const data = diagData(d);
        if (!data || typeof data.variableName !== 'string') continue;
        if (!paramNames.has(data.variableName)) continue;
        if (typeof data.argumentOffset === 'number'
            && (data.argumentOffset < bodyStart || data.argumentOffset > bodyEnd)) continue;
        const expected: string[] = Array.isArray(data.expectedTypes)
            ? data.expectedTypes
            : (typeof data.expectedType === 'string'
                ? splitTypeUnion(data.expectedType)
                : []);
        addConstraint(data.variableName, expected);
    }

    // Sources 2, 3, 4: walk the body.
    //
    // We deliberately omit two seductive-looking rules that are NOT provable
    // under ucode's runtime semantics:
    //
    //   - String concatenation (`"prefix" + x` → string). ucode auto-stringifies
    //     EVERY type during `+` ("a"+42 = "a42", "a"+[1,2] = "a[ 1, 2 ]"), so
    //     this proves nothing about x.
    //
    //   - Arithmetic (`x * 2`, `x - 1`, etc. → numeric). ucode coerces any type
    //     to number; non-numerics yield the string "NaN" without erroring.
    //     `[1,2] * 2` returns "NaN", `null * 2` returns 0.
    //
    // Both expressed user *intent*, not type proof. Removed.
    const walk = (nodeArg: AstNode): void => {
        const node = asWalkable(nodeArg);
        if (!node || typeof node !== 'object' || typeof node.type !== 'string') return;

        const callee = node.callee as WalkableNode | undefined;
        if (node.type === 'CallExpression' && callee?.type === 'Identifier') {
            const fname = callee.name as string;
            const args = node.arguments as WalkableNode[] | undefined;

            // Source 2: direct builtin arg positions. Sound because the validator
            // already fires diagnostics on type mismatches, and at runtime each
            // builtin returns null when given the wrong argument type — so for
            // the user's code to mean anything, the param must be the
            // constrained type.
            const builtinConstraints = BUILTIN_ARG_CONSTRAINTS[fname] ?? MODULE_ARG_CONSTRAINTS[fname];
            if (builtinConstraints && Array.isArray(args)) {
                for (let i = 0; i < args.length && i < builtinConstraints.length; i++) {
                    const arg = args[i];
                    const allowed = builtinConstraints[i];
                    if (!arg || !allowed) continue;
                    if (arg.type === 'Identifier' && paramNames.has(arg.name as string)) {
                        addConstraint(arg.name as string, allowed);
                    }
                }
            }

            // Source 3: user function with a previously-inferred param at that position.
            if (callerInferences && funcsByName && Array.isArray(args)) {
                const calleeFn = funcsByName.get(fname);
                if (calleeFn) {
                    const calleeInferences = callerInferences.get(calleeFn);
                    if (calleeInferences) {
                        for (let i = 0; i < args.length; i++) {
                            const arg = args[i];
                            if (!arg || arg.type !== 'Identifier' || !paramNames.has(arg.name as string)) continue;
                            const calleeParamName = calleeFn.params[i]?.name;
                            if (!calleeParamName) continue;
                            const calleeType = calleeInferences.get(calleeParamName);
                            if (!calleeType || calleeType === 'unknown') continue;
                            addConstraint(arg.name as string, splitTypeUnion(calleeType));
                        }
                    }
                }
            }
        }

        // Source 4: member access. Indexing string/int/bool/null errors at
        // runtime, so any member access proves the param is array-or-object. We
        // narrow further by the KEY, applying the same "returns-null-on-wrong-
        // type → must be the meaningful type" logic used for builtins above:
        //   - A NAMED key — `x.prop` (dot) or `x["nonNumeric"]` — is meaningful
        //     only on an object: ucode arrays have no named properties, so
        //     `arr.prop` / `arr["prop"]` are always null. → `object`.
        //   - A NUMERIC key — `x[0]`, `x[i]`, or even `x["0"]` (ucode coerces a
        //     numeric-looking string to an array index, and a numeric index to
        //     an object's string key) — is genuinely ambiguous. → `array | object`.
        const memberObject = node.object as WalkableNode | undefined;
        if (node.type === 'MemberExpression'
            && memberObject?.type === 'Identifier'
            && paramNames.has(memberObject.name as string)) {
            const prop = node.property as WalkableNode | undefined;
            const namedKey = !node.computed // dot access — always a non-numeric identifier
                || (prop?.type === 'Literal' && typeof prop.value === 'string' && !/^-?\d+$/.test(prop.value));
            addConstraint(memberObject.name as string, namedKey ? ['object'] : ['array', 'object']);
        }

        // Source 5: switch discriminant matched against literal case labels —
        // `switch (target) { case 'main': case 'netifd': }` → the labels' type(s).
        // Unlike the runtime-provable rules above this is an INTENT heuristic
        // (switch tolerates a non-matching discriminant of any type), but it is a
        // strong, reviewable signal and this inference only ever produces an
        // editable JSDoc suggestion — never a live diagnostic. Conservative: if
        // ANY non-default label isn't a literal (e.g. `case SOME_CONST:`), the
        // discriminant's type is unprovable, so we add nothing.
        const discriminant = node.discriminant as WalkableNode | undefined;
        if (node.type === 'SwitchStatement'
            && discriminant?.type === 'Identifier'
            && paramNames.has(discriminant.name as string)
            && Array.isArray(node.cases)) {
            const labelTypes = new Set<string>();
            let allLiteral = true;
            let hasLabel = false;
            for (const c of node.cases as WalkableNode[]) {
                if (!c || c.test == null) continue; // default clause
                hasLabel = true;
                const t = literalTypeName(c.test as AstNode);
                if (!t) { allLiteral = false; break; }
                labelTypes.add(t);
            }
            if (hasLabel && allLiteral && labelTypes.size > 0) {
                addConstraint(discriminant.name as string, [...labelTypes]);
            }
        }

        // Source 7: a param passed to a MEMBER call `recv.method(arg)` where recv is
        // a module namespace (`struct.unpack(fmt, x)`) or an object handle
        // (`inst.unpack(x)`). Source 2 only reads Identifier-callee builtins/imports;
        // member calls were invisible. We resolve the method's parameter TYPES (the
        // same receiver resolution hover/signature-help use) and constrain each
        // param-identifier arg — e.g. unpack's `input: string` ⟹ x is string. Sound
        // as a suggestion: the method errors at runtime on the wrong type.
        if (node.type === 'CallExpression' && callee?.type === 'MemberExpression'
            && symbolTable && Array.isArray(node.arguments)) {
            const memberArgs = node.arguments as WalkableNode[];
            const params = resolveMemberCallParameterTypes(callee, symbolTable);
            if (params) {
                for (let i = 0; i < memberArgs.length && i < params.length; i++) {
                    const arg = memberArgs[i];
                    const ptype = params[i]?.type;
                    if (!arg || arg.type !== 'Identifier' || !paramNames.has(arg.name as string) || !ptype) continue;
                    const allowed = splitTypeUnion(ptype).filter(t => t !== 'unknown' && t !== 'any');
                    if (allowed.length > 0) addConstraint(arg.name as string, allowed);
                }
            }
        }

        // Source 6: spreading a param. Same "runtime errors on the wrong type"
        // basis as the builtins, verified against the ucode interpreter:
        //   - call / array-literal spread (`f(...p)`, `[...p]`) only accept an
        //     array (everything else is "not iterable"). → `array`.
        //   - object-literal spread (`{...p}`) accepts an array OR an object (an
        //     array spreads as index→value keys). → `array | object`.
        if (node.type === 'CallExpression' || node.type === 'ArrayExpression' || node.type === 'ObjectExpression') {
            const items = (node.type === 'CallExpression' ? node.arguments
                : node.type === 'ArrayExpression' ? node.elements
                : node.properties) as WalkableNode[] | undefined;
            if (Array.isArray(items)) {
                const allowed = node.type === 'ObjectExpression' ? ['array', 'object'] : ['array'];
                for (const it of items) {
                    const itArg = it?.argument as WalkableNode | undefined;
                    if (it?.type === 'SpreadElement' && itArg?.type === 'Identifier' && paramNames.has(itArg.name as string)) {
                        addConstraint(itArg.name as string, allowed);
                    }
                }
            }
        }

        for (const key of Object.keys(node)) {
            if (key === 'leadingJsDoc' || key === '_fullType' || key === '_specCache') continue;
            const v = node[key];
            if (Array.isArray(v)) { for (const it of v) walk(it as AstNode); }
            else if (v && typeof v === 'object' && typeof (v as AstNode).type === 'string') { walk(v as AstNode); }
        }
    };
    walk(funcNode.body);

    const result: ParamInference = new Map();
    for (const paramName of paramNames) {
        const lists = constraintsPerParam.get(paramName);
        if (!lists || lists.length === 0) {
            result.set(paramName, 'unknown');
            continue;
        }
        let intersection = new Set(lists[0]);
        for (let i = 1; i < lists.length; i++) {
            const next = lists[i]!;
            intersection = new Set([...intersection].filter(t => next.has(t)));
        }
        if (intersection.size === 0) result.set(paramName, 'unknown');
        else if (intersection.size === 1) result.set(paramName, [...intersection][0]!);
        else result.set(paramName, [...intersection].sort().join(' | '));
    }
    return result;
}

/**
 * Fixpoint over `inferParamTypesFromUsage` across every unannotated function in
 * the AST. Each iteration's per-function inferences feed the next iteration's
 * Source 3 (cross-function propagation), so a type inferred at a leaf function
 * propagates back up the call graph. Converges because intersection is monotonic
 * (types only get narrower) and types are finite.
 *
 * Returns a map from each unannotated function AST node to its inferred param
 * types. Callers (the quick-fix handler, the preview tool) look up per-function
 * results from this single computation.
 *
 * Cached on the AST via a WeakMap so repeat calls within the same request don't
 * re-run.
 */
const inferenceCache = new WeakMap<object, { diagVersion: unknown, result: AllInferences }>();

function inferAllParamTypesFromUsage(ast: AstNode, allDiagnostics: Diagnostic[], symbolTable?: SymbolTable): AllInferences {
    // Cache keyed on the AST; invalidate if the diagnostic set changed.
    const cached = inferenceCache.get(ast);
    if (cached && cached.diagVersion === allDiagnostics) return cached.result;

    const funcs = collectUnannotatedFunctions(ast);
    const result: AllInferences = new Map();

    // funcsByName: only function DECLARATIONS get called by name. Arrow/function
    // expressions are passed around, not called via their (usually absent) ID.
    const funcsByName = new Map<string, FunctionLikeNode>();
    for (const fn of funcs) {
        if (fn.type === 'FunctionDeclaration' && fn.id?.name) {
            funcsByName.set(fn.id.name, fn);
        }
    }

    // Initialize every function's inference to all-unknown.
    for (const fn of funcs) {
        const init: ParamInference = new Map();
        for (const p of fn.params) init.set(p.name, 'unknown');
        result.set(fn, init);
    }

    // Iterate to fixpoint. Bound the pass count as a safety net; in practice
    // 2–4 iterations settle the typical call graph.
    const MAX_ITERATIONS = 10;
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
        let changed = false;
        for (const fn of funcs) {
            const next = inferParamTypesFromUsage(fn, allDiagnostics, result, funcsByName, symbolTable);
            const cur = result.get(fn)!;
            for (const [paramName, newType] of next) {
                if (cur.get(paramName) !== newType) {
                    cur.set(paramName, newType);
                    changed = true;
                }
            }
        }
        if (!changed) break;
    }

    inferenceCache.set(ast, { diagVersion: allDiagnostics, result });
    return result;
}

// Generate JSDoc annotation quick fix for functions with unknown-typed parameters.
// Uses diagnostic-driven inference to emit concrete types where possible instead
// of every param stubbed as `{unknown}`.
/** UC6015 quick-fix: a colon-block keyword (`elif`/`endif`/`endfor`/`endwhile`/`endfunction`)
 *  reached statement position because its opener is missing the `:`. Scan back to the nearest
 *  matching opener (`if`/`elif` for elif/endif, `for`/`while`/`function` for the rest) whose
 *  condition `)` isn't already `:`-terminated, and insert `:` after it. (Raw-lex positions map
 *  to the source, so a `{% %}` template's inner keywords resolve too.) */
function generateColonBlockQuickFix(diagnostic: Diagnostic, document: TextDocument, uri: string): CodeAction | null {
    const tokens: Token[] = new UcodeLexer(document.getText(), { rawMode: true }).tokenize();
    const kwOffset = document.offsetAt(diagnostic.range.start);
    const kwIdx = tokens.findIndex(t => t.pos === kwOffset);
    if (kwIdx < 0) return null;
    // Search backward for the nearest colon-block opener whose condition isn't yet `:`-terminated.
    // Anchor-agnostic (works whether the diagnostic sits on a stray terminator `endif`, a stray
    // `elif`, or the `)` of an in-block `elif` that lost its own colon).
    const OPENER_TYPES = [TokenType.TK_IF, TokenType.TK_ELIF, TokenType.TK_FOR, TokenType.TK_WHILE, TokenType.TK_FUNC];
    const NAME: Partial<Record<TokenType, string>> = {
        [TokenType.TK_IF]: 'if', [TokenType.TK_ELIF]: 'elif', [TokenType.TK_FOR]: 'for',
        [TokenType.TK_WHILE]: 'while', [TokenType.TK_FUNC]: 'function',
    };
    for (let j = kwIdx - 1; j >= 0; j--) {
        if (!OPENER_TYPES.includes(tokens[j]!.type)) continue;
        // Find the opener's first `(` and match it to its closing `)`.
        let k = j + 1;
        while (k < kwIdx && tokens[k]!.type !== TokenType.TK_LPAREN) k++;
        if (k >= kwIdx) continue;
        let depth = 0, close = -1;
        for (; k < tokens.length; k++) {
            if (tokens[k]!.type === TokenType.TK_LPAREN) depth++;
            else if (tokens[k]!.type === TokenType.TK_RPAREN && --depth === 0) { close = k; break; }
        }
        if (close < 0) continue;
        if (tokens[close + 1]?.type === TokenType.TK_COLON) continue; // already colon-terminated
        const name = NAME[tokens[j]!.type] ?? 'if';
        return {
            title: `Add ':' after the '${name}' condition (colon-block form)`,
            kind: CodeActionKind.QuickFix,
            diagnostics: [diagnostic],
            isPreferred: true,
            edit: { changes: { [uri]: [TextEdit.insert(document.positionAt(tokens[close]!.end), ':')] } },
        };
    }
    return null;
}

function generateJsDocQuickFix(
    ast: AstNode, cursorOffset: number, document: TextDocument, uri: string,
    analysisResult: SemanticAnalysisResult
): CodeAction | null {
    // Walk AST to find the innermost function at the cursor AND its parent — the
    // parent decides whether a leading JSDoc block can actually attach.
    const found = findFunctionWithParentAtOffset(ast, cursorOffset);
    if (!found) return null;
    const funcNode = found.fn;
    const parent = found.parent;
    if (!funcNode.params || funcNode.params.length === 0) return null;

    // Shared param-type inference (cross-function usage, with single-shot fallback).
    const inferredTypes = (): Map<string, string> =>
        inferAllParamTypesFromUsage(ast, analysisResult.diagnostics || [], analysisResult.symbolTable).get(funcNode)
        ?? inferParamTypesFromUsage(funcNode, analysisResult.diagnostics || [], undefined, undefined, analysisResult.symbolTable);

    // ── Partial JSDoc: append the missing @param lines into the EXISTING block ──
    // (ticket 95 — the fix used to bail whenever any leading JSDoc was present).
    const existingJsDoc = (funcNode as { leadingJsDoc?: JsDocCommentNode }).leadingJsDoc;
    if (existingJsDoc) {
        const missing = undocumentedParams(funcNode);
        if (missing.length === 0) return null; // fully documented — nothing to add
        const inferred = inferredTypes();

        // Insert new ` * @param` lines just before the block's closing `*/`, matching the
        // block's own indentation. AST-offset based (block range), never line-string surgery.
        const blockStart = existingJsDoc.start;
        const blockText = document.getText({ start: document.positionAt(blockStart), end: document.positionAt(existingJsDoc.end) });
        const closeIdx = blockText.lastIndexOf('*/');
        if (closeIdx < 0) return null;
        const closeOffset = blockStart + closeIdx;
        const startLine = document.positionAt(blockStart).line;
        const closePos = document.positionAt(closeOffset);
        const indentText = (document.getText({ start: { line: startLine, character: 0 }, end: { line: startLine + 1, character: 0 } }).match(/^[ \t]*/) || [''])[0];
        const paramLines = missing.map(p => `${indentText} * @param {${inferred.get(p.name) || 'unknown'}} ${p.name}`);

        let edit: TextEdit;
        if (closePos.line !== startLine) {
            // Multi-line block: insert whole lines before the `*/` line.
            const lineStartOffset = document.offsetAt({ line: closePos.line, character: 0 });
            edit = TextEdit.insert(document.positionAt(lineStartOffset), paramLines.join('\n') + '\n');
        } else {
            // Single-line `/** … */`: promote to multi-line by inserting before `*/`.
            edit = TextEdit.insert(document.positionAt(closeOffset), `\n${paramLines.join('\n')}\n${indentText} `);
        }
        const n = missing.length;
        return {
            title: `Complete JSDoc (add ${n} missing @param${n > 1 ? 's' : ''})`,
            kind: CodeActionKind.QuickFix,
            edit: { changes: { [uri]: [edit] } },
        };
    }

    // A leading JSDoc block only binds to a function in a statement-leading position:
    // a `function foo()` declaration, or a function expression that's the value of a
    // variable declaration / assignment / object property. An anonymous function used
    // inline (e.g. a `replace(s, re, function(ip){…})` callback argument) has no clean
    // attachment point — inserting the block before the enclosing statement detaches it
    // and never annotates the param. Don't offer the fix there.
    if (funcNode.type !== 'FunctionDeclaration') {
        const p = parent ? asWalkable(parent) : null;
        const attachable = !!p && (
            (p.type === 'VariableDeclarator' && p.init === funcNode) ||
            (p.type === 'AssignmentExpression' && p.right === funcNode) ||
            (p.type === 'Property' && p.value === funcNode) ||
            (typeof p.type === 'string' && p.type.startsWith('ExportDefault'))
        );
        if (!attachable) return null;
    }

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

    const inferred = inferredTypes();
    const inferredCount = [...inferred.values()].filter(t => t !== 'unknown').length;

    // Build JSDoc comment text. Indent with the line's LEADING WHITESPACE only —
    // not the text up to the function's column. For a function-expression value
    // (e.g. `call: function () {}`) the function starts mid-line, so the old
    // "up to start column" approach prefixed every JSDoc line with `call: `.
    const funcStartPos = document.positionAt(funcNode.start);
    const funcLine = funcStartPos.line;
    const lineText = document.getText({
        start: { line: funcLine, character: 0 },
        end: { line: funcLine + 1, character: 0 }
    });
    const indentText = (lineText.match(/^[ \t]*/) || [''])[0];

    const jsDocLines = [`${indentText}/**`];
    for (const paramName of funcNode.params.map((p: IdentifierNode) => p.name)) {
        const t = inferred.get(paramName) || 'unknown';
        jsDocLines.push(`${indentText} * @param {${t}} ${paramName}`);
    }
    jsDocLines.push(`${indentText} */`);
    const finalJsDoc = jsDocLines.join('\n') + '\n';

    const totalParams = unknownParams.length;
    const title = inferredCount > 0
        ? `Add JSDoc (${inferredCount}/${totalParams} type${totalParams > 1 ? 's' : ''} inferred)`
        : `Add JSDoc type annotations for ${totalParams} parameter${totalParams > 1 ? 's' : ''}`;

    return {
        title,
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
/** The innermost function (decl/expr/arrow) containing `offset`, plus its parent
 *  node — so callers can tell a declaration / assigned expression (JSDoc attaches)
 *  from an inline callback argument (it doesn't). */
function findFunctionWithParentAtOffset(ast: AstNode, offset: number): { fn: FunctionLikeNode; parent: AstNode | null } | null {
    let best: { fn: FunctionLikeNode; parent: AstNode | null } | null = null;
    const visit = (nodeArg: AstNode, parent: AstNode | null): void => {
        const node = asWalkable(nodeArg);
        if (!node || typeof node !== 'object' || typeof node.type !== 'string') return;
        if ((node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression')
            && typeof node.start === 'number' && offset >= node.start && offset <= node.end) {
            best = { fn: nodeArg as FunctionLikeNode, parent }; // keep descending → innermost wins
        }
        for (const k of Object.keys(node)) {
            if (k === 'leadingJsDoc') continue;
            const v = node[k];
            if (Array.isArray(v)) { for (const it of v) visit(it as AstNode, nodeArg); }
            else if (v && typeof v === 'object' && typeof (v as AstNode).type === 'string') visit(v as AstNode, nodeArg);
        }
    };
    visit(ast, null);
    return best;
}

function findFunctionAtOffset(nodeArg: AstNode, offset: number): FunctionLikeNode | null {
    const node = asWalkable(nodeArg);
    if (!node || typeof node !== 'object') return null;
    if (node.start > offset || node.end < offset) return null;

    // Check if this node is a function
    const isFunctionNode = node.type === 'FunctionDeclaration' ||
                           node.type === 'FunctionExpression' ||
                           node.type === 'ArrowFunctionExpression';

    let deepest: FunctionLikeNode | null = isFunctionNode ? (nodeArg as FunctionLikeNode) : null;

    // Recurse into children
    for (const key of Object.keys(node)) {
        if (key === 'leadingJsDoc') continue;
        const child = node[key];
        if (Array.isArray(child)) {
            for (const item of child) {
                if (item && typeof item === 'object' && 'type' in item) {
                    const found = findFunctionAtOffset(item as AstNode, offset);
                    if (found) deepest = found;
                }
            }
        } else if (child && typeof child === 'object' && 'type' in child) {
            const found = findFunctionAtOffset(child as AstNode, offset);
            if (found) deepest = found;
        }
    }

    return deepest;
}

/**
 * Generate quick fix for UC7001 (unknown type in @param annotation).
 * If the unknown type name matches a resolvable module, offer import() replacement.
 */
// Quick fix for UC3006 (a known module used without importing): insert an import
// at the top of the file (after any existing imports / 'use strict'). Offers a
// named import of the accessed method and a namespace import.
function generateAddImportQuickFix(
    diagnostic: Diagnostic, document: TextDocument, ast: ProgramNode, uri: string
): CodeAction[] {
    const moduleName = document.getText(diagnostic.range);
    if (!/^[A-Za-z_]\w*$/.test(moduleName)) return [];
    // The method accessed: the identifier after the `.` following the receiver.
    const tailStart = document.offsetAt(diagnostic.range.end);
    const tail = document.getText({ start: diagnostic.range.end, end: document.positionAt(tailStart + 64) });
    const m = /^\s*\.\s*([A-Za-z_]\w*)/.exec(tail);
    const methodName = m ? m[1] : null;

    const mkAction = (title: string, edit: TextEdit, preferred: boolean, extraEdits: TextEdit[] = []): CodeAction => {
        return {
            title,
            kind: CodeActionKind.QuickFix,
            diagnostics: [diagnostic],
            isPreferred: preferred,
            edit: { changes: { [uri]: [edit, ...extraEdits] } },
        };
    };
    const actions: CodeAction[] = [];
    const nsImport = `import * as ${moduleName} from '${moduleName}';`;
    // Namespace import is always a fresh line (it isn't a named-list form to merge into).
    const nsEdit = computeImportInsertEdit(ast, document, nsImport);
    if (methodName) {
        // `module.method(...)` form. The namespace import makes `module.method()` work as-is
        // (and covers every other `module.x` use), so it's the safe default. (#92)
        actions.push(mkAction(`Add ${nsImport}`, nsEdit, true));
        // Named-import alternative: ALSO rewrite this call `module.method(` → `method(`, so it
        // doesn't reference an unbound `module` (the old preferred fix left the call broken).
        // Merge into an existing `import { … } from '${moduleName}'` when present (ticket 93).
        const methodNameStart = tailStart + m![0].length - methodName.length;
        const dropReceiver = TextEdit.del({ start: diagnostic.range.start, end: document.positionAt(methodNameStart) });
        const namedEdit = computeNamedImportEdit(ast, document, moduleName, methodName)
            ?? computeImportInsertEdit(ast, document, `import { ${methodName} } from '${moduleName}';`);
        actions.push(mkAction(
            `Add import { ${methodName} } from '${moduleName}' and use ${methodName}()`,
            namedEdit, false, [dropReceiver]));
    } else {
        actions.push(mkAction(`Add ${nsImport}`, nsEdit, true));
    }
    return actions;
}

function generateImportTypeQuickFix(
    diagnostic: Diagnostic, document: TextDocument, uri: string
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

/** Leading-whitespace indentation of the line containing `offset`. */
function indentOf(document: TextDocument, offset: number): string {
    const lineNum = document.positionAt(offset).line;
    const text = document.getText({ start: { line: lineNum, character: 0 }, end: { line: lineNum + 1, character: 0 } });
    return text.match(/^([ \t]*)/)?.[1] || '';
}

/**
 * One indentation level for `document`, inferred from the file's own style so
 * generated code (guard bodies, wrapped statements) matches it instead of a
 * hardcoded tab (ticket 45). The first indented line decides: a leading tab →
 * `'\t'`; otherwise that line's leading space run (2/4/8…); default 4 spaces.
 */
function indentUnit(document: TextDocument): string {
    const lines = document.getText().split(/\r?\n/);
    for (const line of lines) {
        if (line.startsWith('\t')) return '\t';
        const m = line.match(/^( +)\S/);
        if (m) return m[1]!;
    }
    return '    ';
}

/** Verbatim source text of an AST node. */
function nodeSource(document: TextDocument, node: { start: number; end: number }): string {
    return document.getText({ start: document.positionAt(node.start), end: document.positionAt(node.end) });
}

/**
 * Deepest control statement (if/while/for/for-in) whose NON-block body contains
 * `offset` — i.e. a braceless body that must be wrapped in `{ }` to host a guard.
 * `else if` chains are followed into the inner `if` (its consequent is the real
 * braceless body). AST-derived, so it covers one-liner and multi-line braceless
 * forms uniformly: the caller replaces the body node's range, leaving the header,
 * any `else`, and trailing comments untouched.
 */
function findBracelessControlBody(ast: AstNode | null | undefined, offset: number): { control: AstNode; body: AstNode } | null {
    let found: { control: AstNode; body: AstNode } | null = null;
    function walk(nodeArg: AstNode): void {
        const node = asWalkable(nodeArg);
        if (!node || typeof node !== 'object' || typeof node.start !== 'number') return;
        if (offset < node.start || offset > node.end) return;
        const bodies: (AstNode | null | undefined)[] =
            node.type === 'IfStatement' ? [node.consequent as AstNode, node.alternate as AstNode]
            : (node.type === 'WhileStatement' || node.type === 'ForStatement' || node.type === 'ForInStatement') ? [node.body as AstNode]
            : [];
        for (const b of bodies) {
            // `else if` → alternate is an IfStatement; skip it here and let the walk
            // descend into it so we land on the inner consequent instead.
            if (b && b.type !== 'BlockStatement' && b.type !== 'IfStatement'
                && offset >= b.start && offset <= b.end) {
                found = { control: nodeArg, body: b }; // deepest match wins as we descend
            }
        }
        for (const key of Object.keys(node)) {
            const v = node[key];
            if (Array.isArray(v)) v.forEach((c) => walk(c as AstNode));
            else if (v && typeof v === 'object') walk(v as AstNode);
        }
    }
    if (ast) walk(ast);
    return found;
}

/**
 * Wrap a braceless control body in a `{ }` block that hosts `guardStmt` before the
 * original body. Replaces ONLY the body node's range, so the header / `else` /
 * trailing comments are preserved verbatim — no line surgery, no comment hazards.
 */
function makeBracelessGuardAction(
    title: string, body: AstNode, guardStmt: string,
    bodyTransform: ((src: string) => string) | null, prelude: string,
    uri: string, diagnostic: Diagnostic, document: TextDocument
): CodeAction {
    // Indent off the body's line: for a one-liner this is the control's indent;
    // for a multi-line braceless body it's the (deeper) body indent — either way
    // the block's contents and closing `}` line up with where the body was.
    const base = indentOf(document, body.start);
    const unit = indentUnit(document);
    const bodySrc = nodeSource(document, body);
    const bodyText = bodyTransform ? bodyTransform(bodySrc) : bodySrc;
    const inner = `${prelude}${base}${unit}${guardStmt}\n${base}${unit}${bodyText}`;
    const newText = `{\n${inner}\n${base}}`;
    return {
        title,
        kind: CodeActionKind.QuickFix,
        diagnostics: [diagnostic],
        edit: { changes: { [uri]: [TextEdit.replace(
            { start: document.positionAt(body.start), end: document.positionAt(body.end) }, newText)] } }
    };
}

/**
 * End offset of a `let/const NAME = …;` declaration of `name` that sits before
 * `diagOffset` on the same line (the single-line-function-body case, where a guard
 * must be inserted after the declaration rather than before the line — which would
 * land outside the function). AST-derived; returns the nearest such declaration end.
 */
function findSameLineDeclEnd(ast: AstNode | null | undefined, name: string, diagOffset: number, document: TextDocument, diagLine: number): number | null {
    let res: number | null = null;
    function walk(nodeArg: AstNode): void {
        const node = asWalkable(nodeArg);
        if (!node || typeof node !== 'object') return;
        if (node.type === 'VariableDeclaration' && Array.isArray(node.declarations)
            && typeof node.end === 'number' && node.end <= diagOffset
            && document.positionAt(node.start).line === diagLine
            && (node.declarations as WalkableNode[]).some((d) => (d?.id as WalkableNode | undefined)?.name === name)) {
            if (res == null || node.end > res) res = node.end;
        }
        for (const key of Object.keys(node)) {
            const v = node[key];
            if (Array.isArray(v)) v.forEach((c) => walk(c as AstNode));
            else if (v && typeof v === 'object') walk(v as AstNode);
        }
    }
    if (ast) walk(ast);
    return res;
}

/** Verbatim source of `node` with the sub-range `[start,end)` replaced by `repl`. */
function nodeSourceWith(document: TextDocument, node: { start: number; end: number }, start: number, end: number, repl: string): string {
    const src = nodeSource(document, node);
    return src.slice(0, start - node.start) + repl + src.slice(end - node.start);
}

// Generate quick fixes for type narrowing diagnostics
function generateTypeNarrowingQuickFixes(
    diagnostic: Diagnostic, document: TextDocument, uri: string, ast?: ProgramNode, symbolTable?: SymbolTable
): CodeAction[] {
    const actions: CodeAction[] = [];

    if (!diagnostic.code || !diagnostic.data) {
        return actions;
    }

    const { code, data } = diagnostic;
    const line = diagnostic.range.start.line;
    const diagOffset = document.offsetAt(diagnostic.range.start);

    // Enclosing context — every structural decision below is read from these AST
    // nodes, never re-parsed from the line text.
    const ctx = findEnclosingContext(ast, document, diagnostic.range.start);

    const varName: string | null = data.variableName || null;
    const expectedType: string = data.expectedType || data.expectedTypes?.[0] || '';

    // Indentation = the leading whitespace of the diagnostic's line (whitespace only).
    const indent = indentOf(document, diagOffset);
    // One indent level in the FILE's style, for the extra nesting inside guard bodies
    // (ticket 45 — was a hardcoded tab regardless of the file's indent style).
    const unit = indentUnit(document);

    // Diagnostic on a later line than its enclosing statement → it sits inside a
    // multi-line expression (object literal, array, nested call); guards go before
    // the statement, not before the diagnostic line.
    const stmtLine = ctx.enclosingStatementLine;
    const needsStatementRedirect = stmtLine >= 0 && stmtLine < line;

    // The braceless control body (if/while/for, one-liner OR multi-line) that holds
    // the diagnostic. Its body node gets wrapped in a `{ }` block to host the guard —
    // header, `else`, and trailing comments are left untouched. Not applied when the
    // diagnostic is in the control's CONDITION (guard goes before the control then).
    const braceless = ctx.inCondition || !ast ? null : findBracelessControlBody(ast, diagOffset);
    const needsBlockExpansion = braceless != null;

    const nullish = isNullProblem(data);

    // A parameter of an "inline" function (expression-body arrow, or a single-line
    // arrow / function-expression / object method / callback) can't host a guard
    // inserted before the diagnostic LINE — that lands outside the function. The
    // guard goes inside the function body instead.
    const inlineFn = !needsStatementRedirect && !ctx.inCondition && !braceless &&
        isInlineFunctionBody(ctx.enclosingFunction, document, line)
        ? ctx.enclosingFunction
        : null;

    // Handle all three diagnostic codes uniformly
    if (code !== 'nullable-argument' && code !== 'incompatible-function-argument' && code !== 'nullable-in-operator') {
        return actions;
    }

    // A coercion diagnostic (uc/lc/match subject) is not a narrowing problem — the value is
    // valid, just stringified; its own "Coerce to string" fix is offered elsewhere. Never a guard.
    if (data.coerceToString) {
        return actions;
    }

    // A type guard can only rescue the call when the actual type is a UNION (narrow to the valid
    // arm) or UNKNOWN (assert the type). A single concrete wrong type — boolean, integer, array —
    // cannot be narrowed to a *different* type (`type(true) == "string"` is always false), so a
    // guard would just create dead code. Honor an explicit `narrowable`; when a producer didn't
    // set it, derive it from the actual type (a union string contains ' | '; unknown qualifies).
    // Null is its own case (`nullish`), handled by the null-guard / optional-chaining fixes below.
    const narrowable = data.narrowable !== undefined
        ? data.narrowable
        : (typeof data.actualType === 'string' && (data.actualType.includes(' | ') || data.actualType === 'unknown'));
    if (!narrowable && !nullish) {
        return actions;
    }

    // Does the enclosing statement declare a variable used later? (Wrapping it in an
    // if-block would scope it inside.) Read from the AST, not a line regex.
    const declStmt = ctx.enclosingStatement;
    const declStmtW = declStmt ? asWalkable(declStmt) : null;
    const declaredVar: string | undefined = declStmtW && declStmtW.type === 'VariableDeclaration'
        ? ((declStmtW.declarations as WalkableNode[] | undefined)?.[0]?.id as WalkableNode | undefined)?.name as string | undefined : undefined;
    const varUsedLater = declaredVar ? isVariableUsedAfterLine(document, line, declaredVar) : false;

    // A same-line `let NAME = …;` declaration of the guard subject (single-line
    // function body) — the guard is inserted after it, not before the line.
    const declCase1End = varName && ast && !needsStatementRedirect && !ctx.inCondition
        ? findSameLineDeclEnd(ast, varName, diagOffset, document, line)
        : null;

    // Emit an early-return / continue guard at the right place for the context. All
    // placements are offset-anchored (comment-safe); none parse line text. Returns
    // false only at module top level (no enclosing fn/loop/control), where the caller
    // offers a "Wrap" action instead.
    const keyword = ctx.inLoop ? 'continue' : 'return';
    const pushEarlyGuard = (title: string, guardCond: string): boolean => {
        const guardStmt = `if (${guardCond}) ${keyword};`;
        if (needsStatementRedirect) {
            const tlIndent = indentOf(document, document.offsetAt({ line: stmtLine, character: 0 }));
            actions.push(makeInsertBeforeAction(title,
                `${tlIndent}if (${guardCond})\n${tlIndent}${unit}${keyword};\n`, stmtLine, uri, diagnostic, document));
        } else if (ctx.inCondition) {
            const targetLine = ctx.conditionOwnerLine >= 0 ? ctx.conditionOwnerLine : line;
            const targetIndent = indentOf(document, document.offsetAt({ line: targetLine, character: 0 }));
            actions.push(makeInsertBeforeAction(title,
                `${targetIndent}if (${guardCond})\n${targetIndent}${unit}${keyword};\n`, targetLine, uri, diagnostic, document));
        } else if (declCase1End != null) {
            actions.push({
                title, kind: CodeActionKind.QuickFix, diagnostics: [diagnostic],
                edit: { changes: { [uri]: [TextEdit.insert(document.positionAt(declCase1End), ` ${guardStmt}`)] } }
            });
        } else if (braceless) {
            actions.push(makeBracelessGuardAction(title, braceless.body, guardStmt, null, '', uri, diagnostic, document));
        } else if (inlineFn) {
            actions.push(makeInlineFunctionGuardAction(title, inlineFn, guardStmt, uri, diagnostic, document));
        } else if (ctx.inLoop || ctx.inFunction) {
            actions.push(makeInsertBeforeAction(title,
                `${indent}if (${guardCond})\n${indent}${unit}${keyword};\n`, line, uri, diagnostic, document));
        } else {
            return false;
        }
        return true;
    };

    // Offer "Wrap in guard" — replaces the enclosing statement's node range with
    // `if (cond) { <stmt> }`. Only valid at the same scope as the statement, so it's
    // gated by the caller. Node-range based → preserves indent and trailing comments.
    const pushWrap = (title: string, cond: string): void => {
        if (!declStmt) return;
        const base = indentOf(document, declStmt.start);
        actions.push({
            title, kind: CodeActionKind.QuickFix, diagnostics: [diagnostic],
            edit: { changes: { [uri]: [TextEdit.replace(
                { start: document.positionAt(declStmt.start), end: document.positionAt(declStmt.end) },
                `if (${cond}) {\n${base}${unit}${nodeSource(document, declStmt)}\n${base}}`)] } }
        });
    };
    // Wrap is offered only at the statement's own scope (not redirected, not in a
    // condition/loop-header, not needing block expansion, not a same-line decl, not
    // an inline-fn param) and when the declared var isn't used after the line.
    const wrapAllowed = !needsStatementRedirect && !varUsedLater && !ctx.inLoopHeader
        && !ctx.inCondition && !needsBlockExpansion && declCase1End == null && !inlineFn;

    // Split-declaration guard: `let cfg = json(raw);` → `let cfg;\nif (raw != null)\n\tcfg =
    // json(raw);`. Preserves `cfg`'s scope (so it works even when it's used later) and needs
    // no enclosing function — it fills the gap where a wrap would scope the var out AND there's
    // no return/continue to hang an early guard on (e.g. top-level code). `let` only (a `const`
    // must be initialised at its declaration).
    const pushSplitDecl = (title: string, cond: string): void => {
        if (!declStmt || !declStmtW || declStmtW.type !== 'VariableDeclaration') return;
        if ((declStmtW.kind as string) === 'const') return;
        const decls = declStmtW.declarations as WalkableNode[] | undefined;
        if (!decls || decls.length !== 1) return;
        const id = (decls[0]!.id as WalkableNode | undefined)?.name as string | undefined;
        const init = decls[0]!.init as WalkableNode | undefined;
        if (!id || !init || typeof init.start !== 'number' || typeof init.end !== 'number') return;
        const base = indentOf(document, declStmt.start);
        const kw = (declStmtW.kind as string) || 'let';
        const initSrc = document.getText({ start: document.positionAt(init.start), end: document.positionAt(init.end) });
        const replacement = `${kw} ${id};\n${base}if (${cond})\n${base}${unit}${id} = ${initSrc};`;
        actions.push({
            title, kind: CodeActionKind.QuickFix, diagnostics: [diagnostic],
            edit: { changes: { [uri]: [TextEdit.replace(
                { start: document.positionAt(declStmt.start), end: document.positionAt(declStmt.end) }, replacement)] } },
        });
    };

    if (varName) {
        // === SIMPLE IDENTIFIER ===
        if (nullish) {
            const guardCond = `${varName} == null`;
            if (guardAlreadyExists(document, line, guardCond, ctx.enclosingFunctionLine)) return actions;
            const earlyGuarded = pushEarlyGuard(`Add null guard for \`${varName}\``, guardCond);
            if (wrapAllowed) pushWrap(`Wrap in null guard for \`${varName}\``, `${varName} != null`);
            // Neither an early-return guard nor a scope-safe wrap was possible (e.g. top-level
            // `let x = call(nullable)` whose result is used later) → offer the split-declaration
            // guard, which narrows the argument while keeping the declared variable in scope.
            if (!earlyGuarded && !wrapAllowed) {
                pushSplitDecl(`Guard the assignment (only call when \`${varName}\` is non-null)`, `${varName} != null`);
            }
        } else {
            // Type mismatch — filter "null" (type(x) never returns "null", so a guard
            // can't test for it). e.g. expected "object | null" → guard only on "object".
            let expectedTypes: string[] = (data.expectedTypes || expectedType.split(' | ').map((s: string) => s.trim()))
                .filter((t: string) => t !== 'null');
            if (expectedTypes.length === 0) return actions;

            // Tighten via downstream usages: length(x) wants string|array|object, but a
            // later join('\n', x) wants array → intersect to a single clean guard.
            if (ast) {
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

            if (guardAlreadyExists(document, line, earlyReturnGuard, ctx.enclosingFunctionLine)) return actions;
            pushEarlyGuard(`Add type guard for \`${varName}\``, earlyReturnGuard);

            // "Type guard with default" — the arg is `expr || fallback`: extract expr to
            // a temp, assign the fallback when its type is wrong, then use the temp. Two
            // offset-anchored edits (prelude before the statement + replace the `expr ||
            // fallback` node with the temp) — comment-safe, no line reconstruction.
            if (data.fallbackStart != null && data.fullExprStart != null) {
                const leftExprText = varName || document.getText(diagnostic.range).trim();
                const fallbackText = document.getText({ start: document.positionAt(data.fallbackStart), end: document.positionAt(data.fallbackEnd) });
                const vn = uniqueValName(document, line);
                const guardCond = isUnionExpected
                    ? expectedTypes.map((t: string) => `type(${vn}) != "${t}"`).join(' && ')
                    : `type(${vn}) != "${expectedTypes[0]}"`;
                const tl = needsStatementRedirect ? stmtLine : line;
                const tlIndent = indentOf(document, document.offsetAt({ line: tl, character: 0 }));
                actions.push({
                    title: `Add type guard with default`,
                    kind: CodeActionKind.QuickFix, diagnostics: [diagnostic],
                    edit: { changes: { [uri]: [
                        TextEdit.insert({ line: tl, character: 0 },
                            `${tlIndent}let ${vn} = ${leftExprText};\n${tlIndent}if (${guardCond})\n${tlIndent}${unit}${vn} = ${fallbackText};\n`),
                        TextEdit.replace(
                            { start: document.positionAt(data.fullExprStart), end: document.positionAt(data.fullExprEnd) }, vn)
                    ] } }
                });
            }

            if (wrapAllowed) pushWrap(`Wrap in type guard for \`${varName}\``, wrapGuard);
        }
    } else if (!ctx.inLoopHeader) {
        // === COMPLEX EXPRESSION (no variable name) ===
        // Skip extract-and-replace actions in loop headers — replacing the for-in
        // line would break the loop structure.
        const exprText = document.getText(diagnostic.range);
        if (!exprText) return actions;

        // For nullable call results like keys(env.netifd_mark), trace into the AST to
        // find the inner argument that needs the guard.
        if (!needsBlockExpansion && ast && data.argumentOffset != null) {
            const innerInfo = findInnerGuardTarget(ast, data.argumentOffset);
            if (innerInfo) {
                const innerExpectedTypes = innerInfo.expectedTypes.filter((t: string) => t !== 'null');
                if (innerExpectedTypes.length === 0) return actions;
                const innerIsUnion = innerExpectedTypes.length > 1;
                const innerEarlyGuard = innerIsUnion
                    ? innerExpectedTypes.map((t: string) => `type(${innerInfo.varName}) != "${t}"`).join(' && ')
                    : `type(${innerInfo.varName}) != "${innerExpectedTypes.join(' | ')}"`;
                if (!guardAlreadyExists(document, line, innerEarlyGuard, ctx.enclosingFunctionLine)) {
                    pushEarlyGuard(`Add type guard for \`${innerInfo.varName}\``, innerEarlyGuard);
                    return actions;
                }
                // Guard already exists — fall through to extract-to-variable.
            }
        }

        // Prefer a readable singular name for `parts[0]` → `part`; `_val` otherwise.
        const vn = suggestExtractName(document, exprText, symbolTable, diagOffset);

        // Guard condition (filter "null" — type(x) never returns "null").
        const exExpectedTypes: string[] = (data.expectedTypes || expectedType.split(' | ').map((s: string) => s.trim()))
            .filter((t: string) => t !== 'null');
        if (!nullish && exExpectedTypes.length === 0) return actions;
        const exIsUnion = exExpectedTypes.length > 1;
        const exEarlyGuard = nullish ? `${vn} == null`
            : (exIsUnion ? exExpectedTypes.map((t: string) => `type(${vn}) != "${t}"`).join(' && ') : `type(${vn}) != "${expectedType}"`);
        const wrapCond = nullish ? `${vn} != null`
            : (exIsUnion ? exExpectedTypes.map((t: string) => `type(${vn}) == "${t}"`).join(' || ') : `type(${vn}) == "${expectedType}"`);
        const shortExpr = exprText.length > 30 ? exprText.substring(0, 27) + '...' : exprText;
        const actionLabel = nullish ? `Extract \`${shortExpr}\` and add null guard` : `Extract \`${shortExpr}\` and add type guard`;

        // The flagged expression's offset range (replacing this node range — not a
        // line substring — is exact and comment-safe).
        const flagStart = document.offsetAt(diagnostic.range.start);
        const flagEnd = document.offsetAt(diagnostic.range.end);

        if (needsStatementRedirect) {
            const tlIndent = indentOf(document, document.offsetAt({ line: stmtLine, character: 0 }));
            // With a `|| fallback`, the whole `expr || fallback` node is what gets
            // replaced by the temp; otherwise just the flagged expression.
            const hasFallback = data.fullExprStart != null && data.fullExprEnd != null;
            const rRange = hasFallback
                ? { start: document.positionAt(data.fullExprStart), end: document.positionAt(data.fullExprEnd) }
                : diagnostic.range;
            if (data.fallbackStart != null) {
                const fallbackText = document.getText({ start: document.positionAt(data.fallbackStart), end: document.positionAt(data.fallbackEnd) });
                const defaultGuardCond = nullish ? `${vn} == null`
                    : (exIsUnion ? exExpectedTypes.map((t: string) => `type(${vn}) != "${t}"`).join(' && ') : `type(${vn}) != "${expectedType}"`);
                actions.push({
                    title: `Add type guard with default`, kind: CodeActionKind.QuickFix, diagnostics: [diagnostic],
                    edit: { changes: { [uri]: [
                        TextEdit.insert({ line: stmtLine, character: 0 }, `${tlIndent}let ${vn} = ${exprText};\n${tlIndent}if (${defaultGuardCond})\n${tlIndent}${unit}${vn} = ${fallbackText};\n`),
                        TextEdit.replace(rRange, vn)
                    ] } }
                });
            }
            actions.push({
                title: actionLabel, kind: CodeActionKind.QuickFix, diagnostics: [diagnostic],
                edit: { changes: { [uri]: [
                    TextEdit.insert({ line: stmtLine, character: 0 }, `${tlIndent}let ${vn} = ${exprText};\n${tlIndent}if (${exEarlyGuard})\n${tlIndent}${unit}${keyword};\n`),
                    TextEdit.replace(rRange, vn)
                ] } }
            });
        } else if (braceless) {
            // Wrap the braceless body in a block: extract + guard, then the body with
            // the flagged expression swapped for the temp.
            const base = indentOf(document, braceless.body.start);
            actions.push(makeBracelessGuardAction(actionLabel, braceless.body,
                `if (${exEarlyGuard}) ${keyword};`,
                () => nodeSourceWith(document, braceless.body, flagStart, flagEnd, vn),
                `${base}${unit}let ${vn} = ${exprText};\n`,
                uri, diagnostic, document));
        } else if (inlineFn) {
            // The flagged expression sits in an inline function body; extracting to a
            // `let` before the line would hoist it out of the function. Offer nothing.
        } else if (ctx.inLoop || ctx.inFunction) {
            actions.push({
                title: actionLabel, kind: CodeActionKind.QuickFix, diagnostics: [diagnostic],
                edit: { changes: { [uri]: [
                    TextEdit.insert({ line, character: 0 }, `${indent}let ${vn} = ${exprText};\n${indent}if (${exEarlyGuard})\n${indent}${unit}${keyword};\n`),
                    TextEdit.replace(diagnostic.range, vn)
                ] } }
            });
        } else if (declStmt) {
            // Top level — no early return. If the declared var is used later, wrap the
            // declaration's value in a scope-preserving ternary; otherwise wrap the
            // whole statement in an if-block. A SINGLE replace of the statement node
            // range (the extracted `let` is part of the new text) — at top level the
            // statement starts at column 0, so a separate insert there would overlap.
            const base = indentOf(document, declStmt.start);
            const stmtRange = { start: document.positionAt(declStmt.start), end: document.positionAt(declStmt.end) };
            const prelude = `let ${vn} = ${exprText};\n${base}`;
            let newText: string;
            if (varUsedLater && declaredVar && declStmt.type === 'VariableDeclaration') {
                const declStmtNode = asWalkable(declStmt);
                const declr = (declStmtNode.declarations as WalkableNode[])[0]!;
                const declrInit = declr.init as (WalkableNode & { start: number; end: number }) | undefined;
                const declrId = declr.id as WalkableNode;
                const initSrc = declrInit ? nodeSourceWith(document, declrInit, flagStart, flagEnd, vn) : vn;
                newText = `${prelude}${declStmtNode.kind as string} ${declrId.name as string} = ${wrapCond} ? ${initSrc} : null;`;
            } else {
                const stmtSrc = nodeSourceWith(document, declStmt, flagStart, flagEnd, vn);
                newText = `${prelude}if (${wrapCond}) {\n${base}${unit}${stmtSrc}\n${base}}`;
            }
            actions.push({
                title: actionLabel, kind: CodeActionKind.QuickFix, diagnostics: [diagnostic],
                edit: { changes: { [uri]: [TextEdit.replace(stmtRange, newText)] } }
            });
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
function findTightestTypeConstraint(ast: AstNode | null | undefined, varName: string, afterOffset: number, expectedTypes: string[]): string[] | null {
    if (!ast || !varName) return null;
    // Simple variable names only (not member expressions)
    if (varName.includes('.')) return null;

    const constraints: string[][] = [];

    function walk(nodeArg: AstNode): void {
        const node = asWalkable(nodeArg);
        if (!node || typeof node !== 'object') return;
        if (typeof node.start === 'number' && node.start < afterOffset) {
            // Skip nodes entirely before the diagnostic — but still descend
            // into container nodes that may span past afterOffset
            if (typeof node.end === 'number' && node.end < afterOffset) return;
        }

        // Track whether we're inside the function containing the diagnostic.
        // Don't collect constraints from other functions with same-named params.
        const isFunc = node.type === 'FunctionDeclaration' ||
                       node.type === 'FunctionExpression' ||
                       node.type === 'ArrowFunctionExpression';
        if (isFunc) {
            if (afterOffset >= node.start && afterOffset <= node.end) {
                // This is the function containing the diagnostic — descend into it
            } else {
                // Different function — skip entirely
                return;
            }
        }

        const callee = node.callee as WalkableNode | undefined;
        if (node.type === 'CallExpression' && callee?.type === 'Identifier') {
            const funcName = callee.name as string;
            const argTypes = builtinArgTypesByPos[funcName];
            const callArgs = node.arguments as WalkableNode[] | undefined;
            if (argTypes && callArgs) {
                for (let i = 0; i < callArgs.length; i++) {
                    const arg = callArgs[i];
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
                for (const item of val) walk(item as AstNode);
            } else if (val && typeof val === 'object' && typeof (val as AstNode).type === 'string') {
                walk(val as AstNode);
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
function findInnerGuardTarget(ast: AstNode | null | undefined, offset: number): { varName: string; expectedTypes: string[] } | null {
    const node = findCallExpressionAtOffset(ast, offset);
    if (!node) return null;
    return traceCallToGuardTarget(node);
}

function traceCallToGuardTarget(nodeArg: AstNode): { varName: string; expectedTypes: string[] } | null {
    const node = asWalkable(nodeArg);
    if (node.type !== 'CallExpression') return null;
    const callee = node.callee as WalkableNode | undefined;
    if (callee?.type !== 'Identifier') return null;

    const funcName = callee.name as string;
    const arg = (node.arguments as WalkableNode[] | undefined)?.[0];
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
        const leftName = getDottedPath(arg.left as AstNode);
        if (leftName) {
            const expectedTypes = builtinArgTypes[funcName];
            if (expectedTypes) {
                return { varName: leftName, expectedTypes };
            }
        }
    }

    return null;
}

function getDottedPath(nodeArg: AstNode): string | null {
    const node = asWalkable(nodeArg);
    if (node.type === 'Identifier') return node.name as string;
    if (node.type === 'MemberExpression' && !node.computed) {
        const objPath = getDottedPath(node.object as AstNode);
        const property = node.property as WalkableNode | undefined;
        if (objPath && property?.type === 'Identifier') {
            return `${objPath}.${property.name}`;
        }
    }
    return null;
}

/** Find the innermost CallExpression at or containing the given offset */
function findCallExpressionAtOffset(nodeArg: AstNode | null | undefined, offset: number): AstNode | null {
    const node = nodeArg ? asWalkable(nodeArg) : null;
    if (!node || typeof node !== 'object' || typeof node.start !== 'number') return null;
    if (offset < node.start || offset > node.end) return null;

    // If this is a computed MemberExpression wrapping a CallExpression (e.g., match(...)[1]),
    // don't recurse into the call — the null comes from the member access, not the call's args.
    // Guarding the inner call's argument won't fix the nullable result of indexing.
    if (node.type === 'MemberExpression' && node.computed &&
        (node.object as WalkableNode | undefined)?.type === 'CallExpression') {
        return null;
    }

    // Try to find a more specific CallExpression in children
    for (const key of Object.keys(node)) {
        if (key === 'type' || key === 'start' || key === 'end') continue;
        const val = node[key];
        if (Array.isArray(val)) {
            for (const item of val) {
                const found = findCallExpressionAtOffset(item as AstNode, offset);
                if (found) return found;
            }
        } else if (val && typeof val === 'object' && typeof (val as AstNode).start === 'number') {
            const found = findCallExpressionAtOffset(val as AstNode, offset);
            if (found) return found;
        }
    }

    // No child CallExpression found — return this node if it's a CallExpression
    return node.type === 'CallExpression' ? nodeArg! : null;
}

// ucode reserved words — never emit one as a generated variable name (e.g. a
// `returns[i]` access must not produce `let return = ...`).
const UCODE_RESERVED = new Set([
    'let', 'const', 'function', 'if', 'else', 'for', 'while', 'return', 'break',
    'continue', 'try', 'catch', 'switch', 'case', 'default', 'import', 'export',
    'in', 'delete', 'this', 'true', 'false', 'null'
]);

/** Find a unique name based on `base` (base, base2, base3, …) not already
 *  declared anywhere in the document. Word-boundary match so `base` doesn't
 *  spuriously match `base2`. */
function uniqueName(document: TextDocument, base: string): string {
    const fullText = document.getText();
    let name = base;
    let suffix = 2;
    while (new RegExp(`(?:let|const|var)\\s+${name}\\b`).test(fullText)) {
        name = `${base}${suffix}`;
        suffix++;
    }
    return name;
}

/** Find a unique variable name like _val, _val2, _val3… that isn't already used nearby */
function uniqueValName(document: TextDocument, _line: number): string {
    return uniqueName(document, '_val');
}

/** Suggest a readable name for a variable extracted from `exprText`. For an
 *  element access on a plural identifier — `parts[0]`, `obj.lines[i]` — use the
 *  singular (`part`, `line`) for readability; otherwise fall back to the generic
 *  `_val` scheme. Always returns a name not already declared in the document. */
function suggestExtractName(document: TextDocument, exprText: string, symbolTable?: SymbolTable, offset?: number): string {
    // Trailing element access on an identifier (optionally after a `.` chain).
    const m = /(?:^|\.)([A-Za-z_$][\w$]*)\s*\[[^\]]*\]\s*$/.exec((exprText || '').trim());
    if (m && m[1] && m[1].length > 1 && /s$/.test(m[1])) {
        const singular = m[1].slice(0, -1); // literal trailing-'s' removal: parts→part, lines→line
        if (singular && !UCODE_RESERVED.has(singular) && !nameInUse(singular, document, symbolTable, offset)) {
            return singular;
        }
    }
    return uniqueName(document, '_val');
}

/** Is `name` already a binding visible at `offset`? Prefer the symbol table
 *  (scope-aware: catches params, locals, loop/index vars; ignores comments,
 *  strings, and out-of-scope declarations — so `parts[0]` → `part` succeeds
 *  even when "part" appears in a comment, while `targets[target]` → `target`
 *  is correctly rejected because the index/param is in scope). Falls back to a
 *  conservative document-wide word scan only when no symbol table is available. */
function nameInUse(name: string, document: TextDocument, symbolTable?: SymbolTable, offset?: number): boolean {
    // Precise, scope-aware: catches params, in-scope locals, and the index/loop
    // var (e.g. the `target` in `targets[target]`). Ignores comments/strings.
    if (symbolTable && typeof symbolTable.lookupAtPosition === 'function' && offset !== undefined) {
        try { if (symbolTable.lookupAtPosition(name, offset)) return true; } catch { /* fall through */ }
    }
    // Also reject if the name is explicitly DECLARED anywhere (let/const/var) —
    // catches a same-name declaration whose position the scope check would miss
    // (e.g. declared later in the scope). Declarations only, so a mere mention
    // in a comment or string does NOT count (that was the over-conservative bug).
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b(?:let|const|var)\\s+${esc}\\b`).test(document.getText());
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