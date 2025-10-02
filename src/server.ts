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

const connection = createConnection(ProposedFeatures.all);

const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

// Analysis cache for storing semantic analysis results with timestamps
const analysisCache = new Map<string, {result: SemanticAnalysisResult, timestamp: number}>();

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
    connection.console.log(`Analyzing ${filePaths.length} discovered .uc files...`);
    
    for (const filePath of filePaths) {
        try {
            const uri = filePathToUri(filePath);
            const content = await fs.promises.readFile(filePath, 'utf8');
            
            // Create a virtual text document for analysis
            const textDocument = TextDocument.create(uri, 'ucode', 1, content);
            
            // Analyze the document and cache the results
            await validateAndAnalyzeDocument(textDocument);
            
        } catch (error) {
            connection.console.warn(`Error analyzing file ${filePath}: ${error}`);
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
                triggerCharacters: ['.', "'", '"', ','],
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

    // Perform initial workspace scan
    connection.console.log('Performing initial workspace scan...');
    await scanAndAnalyzeWorkspace();
});

documents.onDidClose((_e: TextDocumentChangeEvent<TextDocument>) => {
    // Document closed - could clean up any document-specific data here
});

documents.onDidChangeContent(async (change: TextDocumentChangeEvent<TextDocument>) => {
    await validateAndAnalyzeDocument(change.document);
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
        analysisCache.set(textDocument.uri, {result: analysisResult, timestamp: Date.now()});
        connection.console.log(`[ANALYSIS] Cached analysis result for: ${textDocument.uri}`);
        
        // Semantic analysis diagnostics are already filtered by the SemanticAnalyzer itself
        diagnostics.push(...analysisResult.diagnostics);
    } else {
        analysisCache.delete(textDocument.uri);
        connection.console.log(`[ANALYSIS] Removed analysis cache for: ${textDocument.uri} (no AST)`);
    }
    
    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

connection.onDidChangeWatchedFiles(async (params: DidChangeWatchedFilesParams) => {
    connection.console.log(`Received ${params.changes.length} file change events`);
    
    for (const change of params.changes) {
        const filePath = uriToFilePath(change.uri);
        
        if (!filePath.endsWith('.uc')) {
            continue;
        }
        
        const changeTypeString = change.type === FileChangeType.Created ? 'Created' :
                                change.type === FileChangeType.Changed ? 'Changed' : 'Deleted';
        connection.console.log(`File ${changeTypeString}: ${filePath}`);
        
        switch (change.type) {
            case FileChangeType.Created:
            case FileChangeType.Changed:
                try {
                    // Re-analyze the changed/created file
                    const content = await fs.promises.readFile(filePath, 'utf8');
                    const textDocument = TextDocument.create(change.uri, 'ucode', 1, content);
                    await validateAndAnalyzeDocument(textDocument);
                    connection.console.log(`Re-analyzed file: ${filePath}`);
                } catch (error) {
                    connection.console.warn(`Error re-analyzing file ${filePath}: ${error}`);
                    // If file doesn't exist, remove from cache
                    analysisCache.delete(change.uri);
                }
                break;
                
            case FileChangeType.Deleted:
                // Remove from analysis cache
                if (analysisCache.has(change.uri)) {
                    analysisCache.delete(change.uri);
                    connection.console.log(`Removed deleted file from cache: ${filePath}`);
                }
                break;
        }
    }
});

connection.onHover((params) => {
    const cacheEntry = analysisCache.get(params.textDocument.uri);
    const analysisResult = cacheEntry?.result;
    
    if (!analysisResult) {
        console.error(`[SERVER_DEBUG] No analysis result available for hover`);
        return null;
    }
    
    return handleHover(params, documents, analysisResult);
});

connection.onCompletion(async (params) => {
    let cacheEntry = analysisCache.get(params.textDocument.uri);
    let analysisResult = cacheEntry?.result;
    connection.console.log(`[COMPLETION] URI: ${params.textDocument.uri}, Analysis cached: ${!!analysisResult}, Position: ${params.position.line}:${params.position.character}`);
    
    // If no analysis result is cached, force a fresh analysis
    if (!analysisResult) {
        connection.console.log(`[COMPLETION] WARNING: No analysis result in cache, forcing fresh analysis`);
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

    // Get diagnostics for the current range
    const diagnostics = params.context.diagnostics;

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
                    diagnostic, document, params.textDocument.uri
                );
                codeActions.push(...typeNarrowingActions);
            }

            // Check if line already has disable comment
            if (lineText.includes('// ucode-lsp disable')) {
                continue; // Skip if already has disable comment
            }

            // Create code action to add disable comment
            const codeAction: CodeAction = {
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
            };

            codeActions.push(codeAction);
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

// Generate quick fixes for type narrowing diagnostics
function generateTypeNarrowingQuickFixes(diagnostic: any, document: any, uri: string): CodeAction[] {
    const actions: CodeAction[] = [];
    
    if (!diagnostic.code || !diagnostic.data) {
        return actions;
    }

    const { code, data } = diagnostic;
    
    if (code === 'nullable-in-operator' && data.variableName) {
        // Quick fix for null safety in 'in' operator
        const nullGuardAction: CodeAction = {
            title: `Wrap ${data.variableName} in null guard`,
            kind: CodeActionKind.QuickFix,
            diagnostics: [diagnostic],
            edit: {
                changes: {
                    [uri]: [
                        TextEdit.replace(
                            diagnostic.range,
                            `if (${data.variableName} != null) {\n    ${document.getText(diagnostic.range)}\n}`
                        )
                    ]
                }
            }
        };
        actions.push(nullGuardAction);
    }
    
    if (code === 'incompatible-function-argument' && data.variableName && data.expectedType) {
        // Quick fix for function argument type mismatch
        const typeGuardAction: CodeAction = {
            title: `Wrap ${data.variableName} in ${data.expectedType} guard`,
            kind: CodeActionKind.QuickFix,
            diagnostics: [diagnostic],
            edit: {
                changes: {
                    [uri]: [
                        TextEdit.replace(
                            diagnostic.range,
                            `if (type(${data.variableName}) == '${data.expectedType}') {\n    ${document.getText(diagnostic.range)}\n}`
                        )
                    ]
                }
            }
        };
        actions.push(typeGuardAction);
        
        // Also offer assertion option
        const assertionAction: CodeAction = {
            title: `Add ${data.expectedType} assertion to ${data.variableName}`,
            kind: CodeActionKind.QuickFix,
            diagnostics: [diagnostic],
            edit: {
                changes: {
                    [uri]: [
                        TextEdit.replace(
                            diagnostic.range,
                            document.getText(diagnostic.range).replace(
                                data.variableName,
                                `(${data.variableName} as ${data.expectedType})`
                            )
                        )
                    ]
                }
            }
        };
        actions.push(assertionAction);
    }
    
    return actions;
}

documents.listen(connection);

connection.listen();