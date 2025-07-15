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
    TextDocumentChangeEvent
} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';
import { validateDocument, createValidationConfig } from './validations/hybrid-validator';
import { handleHover } from './hover';
import { handleCompletion, handleCompletionResolve } from './completion';

const connection = createConnection(ProposedFeatures.all);

const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

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
                resolveProvider: true
            },
            hoverProvider: true
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

documents.onDidChangeContent((change: TextDocumentChangeEvent<TextDocument>) => {
    validateTextDocument(change.document);
});

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
    // Use the hybrid validation system - Testing AST basic validation with fixed error recovery
    // Change to 'lexer' to disable AST, 'ast-full' for complete analysis
    const config = createValidationConfig('ast-basic');
    
    const diagnostics = validateDocument(textDocument, connection, {
        ...config,
        enablePerformanceLogging: true // Enable for development
    });
    
    connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

connection.onDidChangeWatchedFiles((_change: DidChangeWatchedFilesParams) => {
    connection.console.log('We received an file change event');
});

connection.onHover((params) => {
    return handleHover(params, documents, connection);
});

connection.onCompletion((params) => {
    return handleCompletion(params);
});

connection.onCompletionResolve((item) => {
    return handleCompletionResolve(item);
});

documents.listen(connection);

connection.listen();