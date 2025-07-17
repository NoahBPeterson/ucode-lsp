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
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';
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

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;

connection.onInitialize((params: InitializeParams) => {
    connection.console.log('ucode language server initializing...');
    const capabilities = params.capabilities;

    hasConfigurationCapability = !!(
        capabilities.workspace && !!capabilities.workspace.configuration
    );
    hasWorkspaceFolderCapability = !!(
        capabilities.workspace && !!capabilities.workspace.workspaceFolders
    );

    const result: InitializeResult = {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,
            completionProvider: {
                resolveProvider: true,
                triggerCharacters: ['.'],
                allCommitCharacters: ['.', '(', '['],
                completionItem: {
                    labelDetailsSupport: true
                }
            },
            hoverProvider: true,
            definitionProvider: true
        }
    };
    if (hasWorkspaceFolderCapability) {
        result.capabilities.workspace = {
            workspaceFolders: {
                supported: true
            }
        };
    }
    return result;
});

connection.onInitialized(() => {
    if (hasConfigurationCapability) {
        connection.client.register(DidChangeConfigurationNotification.type, undefined);
    }
    if (hasWorkspaceFolderCapability) {
        connection.workspace.onDidChangeWorkspaceFolders((_event: WorkspaceFoldersChangeEvent) => {
            connection.console.log('Workspace folder change event received.');
        });
    }
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

async function validateAndAnalyzeDocument(textDocument: TextDocument): Promise<void> {
    const text = textDocument.getText();
    const lexer = new UcodeLexer(text, { rawMode: true });
    const tokens = lexer.tokenize();
    const parser = new UcodeParser(tokens, text);
    const parseResult = parser.parse();

    let diagnostics: Diagnostic[] = parseResult.errors.map(err => ({
        severity: DiagnosticSeverity.Error,
        range: {
            start: textDocument.positionAt(err.start),
            end: textDocument.positionAt(err.end),
        },
        message: err.message,
        source: 'ucode-parser'
    }));

    if (parseResult.ast) {
        const analyzer = new SemanticAnalyzer(textDocument, {
            enableTypeChecking: true,
            enableScopeAnalysis: true,
            enableControlFlowAnalysis: true,
            enableUnusedVariableDetection: true,
            enableShadowingWarnings: true,
        });
        const analysisResult = analyzer.analyze(parseResult.ast);
        analysisCache.set(textDocument.uri, {result: analysisResult, timestamp: Date.now()});
        connection.console.log(`[ANALYSIS] Cached analysis result for: ${textDocument.uri}`);
        diagnostics.push(...analysisResult.diagnostics);
    } else {
        analysisCache.delete(textDocument.uri);
        connection.console.log(`[ANALYSIS] Removed analysis cache for: ${textDocument.uri} (no AST)`);
    }
    
    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

connection.onDidChangeWatchedFiles((_change: DidChangeWatchedFilesParams) => {
    connection.console.log('We received an file change event');
});

connection.onHover((params) => {
    const cacheEntry = analysisCache.get(params.textDocument.uri);
    const analysisResult = cacheEntry?.result;
    return handleHover(params, documents, connection, analysisResult);
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

connection.onDefinition((params) => {
    // Convert cache format for definition handler
    const legacyCache = new Map<string, SemanticAnalysisResult>();
    for (const [uri, entry] of analysisCache.entries()) {
        legacyCache.set(uri, entry.result);
    }
    return handleDefinition(params, documents, legacyCache);
});

documents.listen(connection);

connection.listen();